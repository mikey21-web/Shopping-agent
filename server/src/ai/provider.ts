/**
 * LLM provider abstraction.
 *
 * SahiPick must work with no API key at all, so the interface is small and the
 * default implementation is deterministic and grounded rather than generative.
 *
 * A provider is responsible only for turning messages into text or tool calls.
 * It is never responsible for facts, money or hard constraints — those live in
 * deterministic code.
 */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** For tool results: the id of the call being answered. */
  toolCallId?: string;
  /** For tool results: the tool name. */
  name?: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  provider: string;
  model: string;
}

export interface LlmToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  /** Hard cap on generated tokens. */
  maxTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  id: string;
  name: string;
  /** Whether this provider can currently serve requests. */
  isAvailable(): boolean;
  /** Why it is unavailable, for the health endpoint. */
  unavailableReason(): string | null;
  chat(request: LlmRequest): Promise<LlmResponse>;
}

const emptyUsage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * The deterministic, no-key provider.
 *
 * It does not generate prose from a model. Instead the agent gathers facts
 * with tools and this provider renders them into a grounded answer. That means
 * SahiPick's conversational surface works on a fresh install with no
 * credentials, and it can never hallucinate a price.
 */
export class GroundedLocalProvider implements LlmProvider {
  id = 'local';
  name = 'Grounded local composer';

  isAvailable(): boolean {
    return true;
  }

  unavailableReason(): string | null {
    return null;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    // The local provider never requests tools; the agent runs a deterministic
    // plan instead and hands the facts to the renderer.
    const last = request.messages[request.messages.length - 1];
    const content = last?.content ?? '';
    return {
      content,
      toolCalls: [],
      usage: emptyUsage,
      provider: this.id,
      model: 'deterministic-grounded-composer',
    };
  }
}

/**
 * A client for any OpenAI-compatible Chat Completions endpoint.
 *
 * Works with OpenAI, OpenRouter, Together, Groq, Ollama, LM Studio, vLLM and
 * any other server that speaks the same protocol. Nothing here requires a
 * particular vendor.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  id = 'openai_compatible';
  name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; apiKey: string; model: string; name?: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.name = options.name ?? `OpenAI-compatible (${options.model})`;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  isAvailable(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.model);
  }

  unavailableReason(): string | null {
    if (!this.baseUrl) return 'AI_BASE_URL is not set.';
    if (!this.apiKey) return 'AI_API_KEY is not set.';
    if (!this.model) return 'AI_MODEL is not set.';
    return null;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((message) => {
        if (message.role === 'tool') {
          return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
        }
        return { role: message.role, content: message.content };
      }),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 900,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 400)}`);
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: unknown[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const choice = payload.choices?.[0]?.message;
      const toolCalls: LlmToolCall[] = [];

      if (Array.isArray(choice?.tool_calls)) {
        for (const [index, raw] of choice.tool_calls.entries()) {
          const call = raw as {
            id?: string;
            function?: { name?: string; arguments?: string };
          };
          if (!call.function?.name) continue;
          let args: Record<string, unknown> = {};
          if (call.function.arguments) {
            try {
              args = JSON.parse(call.function.arguments) as Record<string, unknown>;
            } catch {
              args = {};
            }
          }
          toolCalls.push({
            id: call.id ?? `call_${index}`,
            name: call.function.name,
            arguments: args,
          });
        }
      }

      return {
        content: choice?.content ?? null,
        toolCalls,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens: payload.usage?.total_tokens ?? 0,
        },
        provider: this.id,
        model: this.model,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

let activeProvider: LlmProvider | null = null;

export function setActiveProvider(provider: LlmProvider | null): void {
  activeProvider = provider;
}

export function getActiveProvider(): LlmProvider {
  if (activeProvider) return activeProvider;
  activeProvider = new GroundedLocalProvider();
  return activeProvider;
}

export function listProviders(): { id: string; name: string; available: boolean; reason: string | null }[] {
  return [getActiveProvider()].map((provider) => ({
    id: provider.id,
    name: provider.name,
    available: provider.isAvailable(),
    reason: provider.unavailableReason(),
  }));
}

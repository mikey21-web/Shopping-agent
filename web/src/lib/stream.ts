/**
 * Streaming chat client.
 *
 * Uses Server-Sent Events so the UI can show *real* progress — the stages the
 * pipeline actually executed — rather than a fake percentage bar. Each stage
 * carries its own measured duration.
 */

import { api, type ChatResponse } from './api.ts';

export type StreamStage =
  | 'understand'
  | 'discover'
  | 'match'
  | 'compare'
  | 'reviews'
  | 'prices'
  | 'recommend'
  | 'research';

export interface StreamProgress {
  stage: StreamStage;
  status: 'started' | 'completed' | 'skipped' | 'failed';
  message: string;
  elapsedMs: number;
  sinceStartMs: number;
}

export interface StreamResult {
  reply: string;
  citations: ChatResponse['citations'];
  requirements: ChatResponse['requirements'];
  requirementSummary: string;
  followUpQuestions: string[];
  recommendations: ChatResponse['recommendations'];
  toolsUsed: { name: string; ok: boolean; error?: string }[];
  steps: number;
  provider: string;
  degraded: boolean;
  notes: string[];
  violations: ChatResponse['violations'];
  timings: Record<string, number>;
  profileSummary?: string;
  questions?: ChatResponse['questions'];
  trace?: ChatResponse['trace'];
  dimensions?: ChatResponse['dimensions'];
  decisionLimitations?: string[];
}

export interface StreamCallbacks {
  sessionId?: string;
  onProgress?: (progress: StreamProgress) => void;
  onResult?: (result: StreamResult) => void;
  onError?: (message: string) => void;
}

/**
 * Run a streaming chat turn.
 *
 * Falls back to the plain `/api/chat` endpoint when the server does not
 * support streaming, so the feature degrades rather than breaks.
 */
export async function streamChat(
  message: string,
  callbacks: StreamCallbacks = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, sessionId: callbacks.sessionId ?? 'default' }),
    });
  } catch (error) {
    callbacks.onError?.(error instanceof Error ? error.message : 'Network error');
    return;
  }

  if (!response.ok || !response.body) {
    // Fall back to the non-streaming endpoint.
    try {
      const result = await api.chat(message, callbacks.sessionId ?? 'default');
      callbacks.onResult?.(result as unknown as StreamResult);
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error.message : 'Request failed');
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const eventName = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
        const dataLine = /^data:\s*([\s\S]+)$/m.exec(frame)?.[1];
        if (eventName && dataLine) {
          try {
            const parsed = JSON.parse(dataLine) as StreamProgress | StreamResult & { message?: string };
            if (eventName === 'progress') {
              callbacks.onProgress?.(parsed as StreamProgress);
            } else if (eventName === 'result') {
              callbacks.onResult?.(parsed as StreamResult);
            } else if (eventName === 'error') {
              callbacks.onError?.(
                (parsed as { message?: string }).message ?? 'The shopping agent failed.',
              );
            }
          } catch {
            /* ignore a malformed frame rather than breaking the stream */
          }
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    callbacks.onError?.(error instanceof Error ? error.message : 'The stream ended unexpectedly.');
  }
}

/** Human-readable label for a pipeline stage. */
export const STAGE_LABELS: Record<StreamStage, string> = {
  understand: 'Understanding your requirements',
  discover: 'Finding matching products',
  match: 'Checking exact variants and prices',
  compare: 'Comparing specifications',
  reviews: 'Analysing customer experiences',
  prices: 'Verifying prices and offers',
  recommend: 'Building your recommendation',
  research: 'Researching the open web for evidence',
};

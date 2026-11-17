import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, type ChatResponse, type ConversationState, type FollowUpQuestion } from '../lib/api.ts';
import { streamChat, type StreamProgress, STAGE_LABELS } from '../lib/stream.ts';
import { renderSimpleMarkdown } from '../lib/format.ts';
import { Badge, Button, Card, SectionTitle, Skeleton } from '../components/ui.tsx';
import { RecommendationCard } from '../components/ProductCard.tsx';
import { DecisionTraceView } from '../components/DecisionTraceView.tsx';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  response?: ChatResponse;
  /** The conditional questions that came from this turn. */
  questions?: FollowUpQuestion[];
}

interface StageState {
  stage: string;
  status: 'started' | 'completed' | 'skipped' | 'failed';
  message: string;
  elapsedMs: number;
}

const SUGGESTIONS = [
  'I want to buy a good pair of shoes.',
  'Laptop under ₹70,000 for programming and local AI models',
  'Phone under ₹25,000 with a great camera and good battery',
  'Washing machine under ₹30,000 for a family of four',
];

/**
 * The Ask page.
 *
 * The conversation is owned by the buyer-intelligence engine. The first
 * message starts a session; the engine then asks only the questions whose
 * answers change the shortlist. Each question is shown as a chip with its
 * options, and the shopper can answer in their own words, pick an option,
 * skip, or say "you decide".
 *
 * Once the brief is sufficient, the research pipeline runs and the
 * decision trace is shown alongside the recommendation.
 */
export function Ask() {
  const location = useLocation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<StageState[]>([]);
  const [conversation, setConversation] = useState<ConversationState | null>(null);
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const seeded = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = (): void => {
    window.setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 30);
  };

  const onProgress = (progress: StreamProgress): void => {
    setStages((current) => {
      const existing = current.findIndex((stage) => stage.stage === progress.stage);
      const next = [...current];
      const entry: StageState = {
        stage: progress.stage,
        status: progress.status,
        message: progress.message,
        elapsedMs: progress.elapsedMs,
      };
      if (existing === -1) next.push(entry);
      else next[existing] = entry;
      return next;
    });
  };

  /** Start the conversation with the shopper's opening message. */
  async function start(text: string): Promise<void> {
    const state = await api.startConversation(text);
    setConversation(state);

    if (state.questions.length > 0) {
      setAwaitingAnswer(true);
      setTurns((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text:
            `Got it — ${state.profileSummary}. Before I start researching, a few things that will change the shortlist:\n\n` +
            state.questions.map((question) => `• ${question.prompt}`).join('\n'),
          questions: state.questions,
        },
      ]);
      return;
    }

    // The brief was complete on the first message.
    await research(text, state.sessionId);
  }

  /** Answer or skip a follow-up question. */
  async function answer(question: FollowUpQuestion, value: string, skip = false): Promise<void> {
    if (!conversation || busy) return;

    setTurns((current) => [
      ...current,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        text: skip ? `Skip: ${question.prompt}` : value,
      },
    ]);
    setBusy(true);

    try {
      const state = skip
        ? await api.skipQuestion(conversation.sessionId, question.id)
        : await api.answerQuestion(conversation.sessionId, question.id, value);

      setConversation(state);

      if (state.questions.length > 0 && !state.delegated) {
        setAwaitingAnswer(true);
        setTurns((current) => [
          ...current,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: `Thanks. ${state.profileSummary}.\n\nA couple more things:\n\n` +
              state.questions.map((item) => `• ${item.prompt}`).join('\n'),
            questions: state.questions,
          },
        ]);
      } else {
        setAwaitingAnswer(false);
        setTurns((current) => [
          ...current,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: state.delegated
              ? `Understood — I'll decide from what I know. Brief: ${state.profileSummary}.`
              : `Brief complete: ${state.profileSummary}. Starting research.`,
          },
        ]);
        await research('Recommend the best options for my brief.', state.sessionId);
      }
    } catch (error) {
      setTurns((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }

  /** Run the deep research pipeline with the completed brief. */
  async function research(text: string, sessionId: string): Promise<void> {
    setBusy(true);
    setStages([]);
    setAwaitingAnswer(false);

    await streamChat(text, {
      sessionId,
      onProgress,
      onResult: (result) => {
        setTurns((current) => [
          ...current,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: result.reply,
            response: result as unknown as ChatResponse,
            questions: result.questions ?? [],
          },
        ]);
      },
      onError: (errorMessage) => {
        setTurns((current) => [
          ...current,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: `Something went wrong: ${errorMessage}`,
          },
        ]);
      },
    });

    setBusy(false);
    scrollToEnd();
  }

  /** The input box: starts a conversation or continues an existing one. */
  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setTurns((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: 'user', text: trimmed },
    ]);
    setMessage('');

    try {
      if (!conversation) {
        await start(trimmed);
      } else {
        await research(trimmed, conversation.sessionId);
      }
    } catch (error) {
      setTurns((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      scrollToEnd();
    }
  }

  // A suggestion clicked on the landing page arrives as router state.
  if (!seeded.current) {
    const state = location.state as { message?: string } | null;
    if (state?.message) {
      seeded.current = true;
      window.setTimeout(() => void start(state.message ?? ''), 0);
    }
  }

  const lastResponse = [...turns].reverse().find((turn) => turn.role === 'assistant')?.response;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Ask SahiPick</h1>
        <p className="mt-1 text-xs leading-relaxed text-mist-500">
          Describe what you need. SahiPick asks only what matters, researches the open web,
          checks the evidence and explains the decision.
        </p>
      </div>

      {conversation ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-jade-500/20 bg-jade-500/5 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wide text-jade-300">Buyer profile</span>
          <span className="text-[11px] text-mist-300">{conversation.profileSummary}</span>
          {conversation.delegated ? (
            <Badge tone="saffron" className="ml-auto text-[9px]">you decide</Badge>
          ) : null}
        </div>
      ) : null}

      {turns.length === 0 ? (
        <Card className="p-4">
          <SectionTitle title="Try one of these" />
          <div className="flex flex-col gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => void send(suggestion)}
                className="rounded-xl border border-ink-700 bg-ink-850/60 px-3.5 py-2.5 text-left text-xs text-mist-200 transition hover:border-saffron-400/40 hover:text-saffron-200"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {turns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-saffron-400 px-3.5 py-2.5 text-xs font-medium text-ink-950 sm:max-w-[70%]">
                  {turn.text}
                </div>
              </div>
            ) : (
              <div key={turn.id} className="rise space-y-3">
                <Card className="p-4">
                  <div
                    className="answer-body text-xs leading-relaxed text-mist-200"
                    dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(turn.text) }}
                  />
                </Card>

                {/* Conditional follow-up questions as interactive chips. */}
                {awaitingAnswer && turn.questions && turn.questions.length > 0 && turn === turns[turns.length - 1] ? (
                  <Card className="border-saffron-500/25 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-saffron-300">
                      Answer any of these
                    </p>
                    <div className="mt-2 flex flex-col gap-2">
                      {turn.questions.map((question) => (
                        <div key={question.id} className="rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2">
                          <p className="text-[11px] text-mist-200">{question.prompt}</p>
                          <p className="mt-0.5 text-[10px] text-mist-500">{question.why}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {question.options.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => void answer(question, option.value)}
                                className="rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-[10px] text-mist-300 transition hover:border-saffron-400/40 hover:text-saffron-200"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div className="mt-2 flex gap-3">
                            <button
                              onClick={() => void answer(question, 'you decide')}
                              className="text-[10px] text-saffron-300 hover:underline"
                            >
                              You decide
                            </button>
                            <button
                              onClick={() => void answer(question, '', true)}
                              className="text-[10px] text-mist-500 hover:underline"
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : null}

                {turn.response ? (
                  <>
                    {turn.response.profileSummary ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-mist-500">
                          Parsed brief
                        </span>
                        <span className="text-[11px] text-mist-400">
                          {turn.response.profileSummary}
                        </span>
                      </div>
                    ) : null}

                    {turn.response.recommendations.length > 0 ? (
                      <div className="space-y-2.5">
                        {turn.response.recommendations.map((recommendation, index) => (
                          <RecommendationCard
                            key={recommendation.productId}
                            recommendation={recommendation}
                            rank={index + 1}
                          />
                        ))}
                      </div>
                    ) : null}

                    {turn.response.trace ? (
                      <DecisionTraceView trace={turn.response.trace} dimensions={turn.response.dimensions ?? []} />
                    ) : null}

                    {turn.response.citations.length > 0 ? (
                      <details className="rounded-xl border border-ink-700/70 bg-ink-900/50 px-3 py-2">
                        <summary className="cursor-pointer text-[11px] text-mist-400">
                          {turn.response.citations.length} source
                          {turn.response.citations.length === 1 ? '' : 's'} behind this answer
                        </summary>
                        <ul className="mt-2 space-y-1.5">
                          {turn.response.citations.slice(0, 12).map((citation) => (
                            <li key={`${citation.kind}-${citation.id}`} className="text-[11px]">
                              <span className="text-mist-500">[{citation.kind}]</span>{' '}
                              {citation.url ? (
                                <a href={citation.url} target="_blank" rel="noreferrer noopener" className="text-sky-300 hover:text-sky-400">
                                  {citation.label}
                                </a>
                              ) : (
                                <span className="text-mist-300">{citation.label}</span>
                              )}
                              {citation.origin === 'sample' ? (
                                <Badge tone="saffron" className="ml-1.5 text-[9px]">sample</Badge>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}

                    {turn.response.notes.length > 0 ? (
                      <details className="rounded-xl border border-ink-700/70 bg-ink-900/50 px-3 py-2">
                        <summary className="cursor-pointer text-[11px] text-mist-400">
                          Research notes and limitations
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {turn.response.notes.map((note, index) => (
                            <li key={index} className="text-[11px] text-mist-400">• {note}</li>
                          ))}
                          {(turn.response.decisionLimitations ?? []).map((item, index) => (
                            <li key={`l-${index}`} className="text-[11px] text-rose-300">• {item}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}

                    {turn.response.violations.length > 0 ? (
                      <div className="rounded-xl border border-saffron-500/25 bg-saffron-500/8 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-saffron-300">
                          Integrity checks
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {turn.response.violations.map((violation) => (
                            <li key={violation.kind + violation.message} className="text-[11px] text-mist-300">
                              {violation.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ),
          )}

          {busy ? (
            <Card className="space-y-2 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-mist-500">
                Researching
              </p>
              <ul className="space-y-1.5">
                {stages.length === 0 ? (
                  <li className="flex items-center gap-2 text-[11px] text-mist-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-saffron-400" />
                    Starting…
                  </li>
                ) : (
                  stages.map((stage) => (
                    <li key={stage.stage} className="flex items-center gap-2 text-[11px]">
                      <span
                        className={
                          stage.status === 'completed'
                            ? 'text-jade-400'
                            : stage.status === 'failed'
                              ? 'text-rose-400'
                              : 'text-saffron-400'
                        }
                        aria-hidden
                      >
                        {stage.status === 'completed' ? '✔' : stage.status === 'failed' ? '✕' : '▸'}
                      </span>
                      <span className={stage.status === 'completed' ? 'text-mist-400' : 'text-mist-100'}>
                        {STAGE_LABELS[stage.stage as keyof typeof STAGE_LABELS] ?? stage.message}
                      </span>
                      {stage.status === 'completed' ? (
                        <span className="ml-auto tabular-nums text-mist-500">{stage.elapsedMs}ms</span>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
              {stages.length === 0 ? (
                <div className="space-y-2 pt-1">
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
              ) : null}
            </Card>
          ) : null}

          <div ref={endRef} />
        </div>
      )}

      {!awaitingAnswer && lastResponse?.questions && lastResponse.questions.length > 0 ? (
        <Card className="border-saffron-500/25 p-3">
          <p className="text-[10px] uppercase tracking-wide text-saffron-300">Sharpen the brief</p>
          <div className="mt-2 flex flex-col gap-2">
            {lastResponse.questions.map((question) => (
              <button
                key={question.id}
                onClick={() => conversation && void answer(question, question.options[0]?.value ?? '', false)}
                className="rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2 text-left text-[11px] text-mist-200 transition hover:border-saffron-400/40"
              >
                {question.prompt}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <form
        className="sticky bottom-16 z-20 flex gap-2 sm:bottom-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send(message);
        }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={awaitingAnswer ? 'Or answer in your own words…' : 'Describe what you need…'}
          aria-label="Message SahiPick"
          className="w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 py-3 text-sm text-mist-50 placeholder:text-mist-500 focus:border-saffron-400/60 focus:outline-none"
        />
        <Button type="submit" disabled={busy || !message.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}

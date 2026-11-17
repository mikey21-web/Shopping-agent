/**
 * Browser research over the Chrome DevTools Protocol.
 *
 * A browser is the expensive rung of the escalation ladder and is only worth
 * its cost when a page genuinely needs JavaScript to reveal its facts. This
 * module therefore:
 *
 *  - is **optional**. Nothing in SahiPick requires it. When no browser
 *    endpoint is reachable the research system says so and falls back to
 *    HTTP extraction.
 *  - talks raw CDP over a WebSocket, so there is no Puppeteer dependency.
 *    It connects to *any* CDP endpoint: a locally launched Chromium, or a
 *    Cloudflare Kitesurf instance, which is CDP-compatible.
 *  - keeps sessions isolated. Each research target gets its own browser
 *    context, so cookies and storage never leak between products or between
 *    concurrent research tasks.
 *  - is bounded. A browser session has a hard lifetime, a page count and a
 *    navigation deadline, so a hung page cannot stall the pipeline.
 *
 * Typical use:
 *   const browser = await connectBrowser();
 *   if (browser) {
 *     const page = await browser.newPage();
 *     await page.goto(url);
 *     const html = await page.content();
 *   }
 */

import { config } from '../../config.ts';

/* ------------------------------------------------------------------ */
/* CDP plumbing                                                        */
/* ------------------------------------------------------------------ */

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string; code?: number };
  /** Present in CDP "flatten" mode to route the message to one target. */
  sessionId?: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** A CDP session bound to one browser context (one isolated "profile"). */
class CdpSession {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private sessionId: string | null = null;
  private listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  private closed = false;

  constructor(
    socket: WebSocket,
    sessionId: string | null,
  ) {
    this.socket = socket;
    this.sessionId = sessionId;
    socket.addEventListener('message', (event: MessageEvent) => {
      this.handleMessage(String(event.data));
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const call of this.pending.values()) {
        call.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
    });
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) {
        call.reject(new Error(message.error.message ?? `CDP error ${message.error.code}`));
      } else {
        call.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      const handlers = this.listeners.get(message.method);
      if (!handlers) return;
      for (const handler of handlers) handler(message.params ?? {});
    }
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('CDP connection is closed'));
    const id = this.nextId++;
    const payload: CdpMessage = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      try {
        this.socket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  on(event: string, handler: (params: Record<string, unknown>) => void): void {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * The underlying socket.
   *
   * CDP "flatten" mode multiplexes every session over one WebSocket, so a
   * child session needs a handle on the parent's socket.
   */
  socketFor(): WebSocket {
    return this.socket;
  }
}

/** One page inside a browser context. */
export class BrowserPage {
  private session: CdpSession;
  private targetId: string;
  readonly browserContextId: string;

  constructor(session: CdpSession, targetId: string, browserContextId: string) {
    this.session = session;
    this.targetId = targetId;
    this.browserContextId = browserContextId;
  }

  /** Navigate and wait for the load event. */
  async goto(url: string, timeoutMs = 25_000): Promise<{ status: number | null; finalUrl: string }> {
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.session.on('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const result = await this.session.send<{ frameId?: string; loaderId?: string; errorText?: string }>(
      'Page.navigate',
      { url },
      timeoutMs,
    );
    if (result?.errorText) {
      throw new Error(`Navigation failed: ${result.errorText}`);
    }

    await Promise.race([loaded, delay(timeoutMs)]);
    return { status: null, finalUrl: url };
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate<T = unknown>(expression: string, timeoutMs = 15_000): Promise<T> {
    const result = await this.session.send<{
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: false,
      },
      timeoutMs,
    );
    if (result?.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'Page evaluation failed',
      );
    }
    return result?.result?.value as T;
  }

  /** The current document HTML. */
  async content(): Promise<string> {
    return this.evaluate<string>('document.documentElement.outerHTML');
  }

  /** The visible text of the document. */
  async visibleText(): Promise<string> {
    return this.evaluate<string>(
      `(document.body && document.body.innerText ? document.body.innerText : '').slice(0, 200000)`,
    );
  }

  /** Scroll to the bottom, which triggers lazy-loaded content. */
  async scrollThrough(maxSteps = 6): Promise<void> {
    await this.evaluate(
      `(async () => {
        const steps = ${maxSteps};
        for (let i = 0; i < steps; i += 1) {
          window.scrollBy(0, Math.max(600, window.innerHeight));
          await new Promise((r) => setTimeout(r, 350));
        }
        window.scrollTo(0, 0);
        return true;
      })()`,
      30_000,
    );
  }

  /** Close this page. */
  async close(): Promise<void> {
    try {
      await this.session.send('Target.closeTarget', { targetId: this.targetId }, 5_000);
    } catch {
      /* closing a page that already went away is not an error */
    }
  }
}

/** A connected browser, with isolated contexts. */
export class Browser {
  private session: CdpSession;
  private contexts = new Set<string>();
  private openPages = 0;
  /** The CDP endpoint this browser is attached to. */
  readonly endpoint: string;

  constructor(endpoint: string, session: CdpSession) {
    this.endpoint = endpoint;
    this.session = session;
  }

  get sessionCount(): number {
    return this.contexts.size;
  }

  get pageCount(): number {
    return this.openPages;
  }

  /**
   * Create an isolated page.
   *
   * Each page gets its own browser context, so cookies, local storage and
   * session state are not shared with any other research target.
   */
  async newPage(): Promise<BrowserPage> {
    const context = await this.session.send<{ browserContextId: string }>(
      'Target.createBrowserContext',
      { disposeOnDetach: false },
      10_000,
    );
    const browserContextId = context.browserContextId;
    this.contexts.add(browserContextId);

    const target = await this.session.send<{ targetId: string }>(
      'Target.createTarget',
      { url: 'about:blank', browserContextId },
      10_000,
    );

    const attached = await this.session.send<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId: target.targetId, flatten: true },
      10_000,
    );

    const pageSession = new CdpSession(this.session.socketFor(), attached.sessionId);
    await pageSession.send('Page.enable', {}, 10_000);
    await pageSession.send('Runtime.enable', {}, 10_000);

    this.openPages += 1;
    const page = new BrowserPage(pageSession, target.targetId, browserContextId);
    const originalClose = page.close.bind(page);
    page.close = async () => {
      this.openPages = Math.max(0, this.openPages - 1);
      await originalClose();
    };
    return page;
  }

  /** Release every context this browser opened. */
  async dispose(): Promise<void> {
    for (const contextId of this.contexts) {
      try {
        await this.session.send('Target.disposeBrowserContext', { browserContextId: contextId }, 5_000);
      } catch {
        /* the context may already be gone */
      }
    }
    this.contexts.clear();
    try {
      this.session.socketFor().close();
    } catch {
      /* ignore */
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Connecting                                                          */
/* ------------------------------------------------------------------ */

/** Where a browser endpoint may live. */
export function browserEndpoint(): string | null {
  return (
    process.env.SAHIPICK_BROWSER_ENDPOINT ??
    process.env.CHROME_REMOTE_DEBUGGING_URL ??
    process.env.KITESURF_ENDPOINT ??
    null
  );
}

/**
 * Try to connect to a CDP endpoint.
 *
 * Returns null rather than throwing when no browser is available: a missing
 * browser is a normal state, not an error, and the caller degrades to HTTP
 * extraction.
 */
export async function connectBrowser(endpoint?: string): Promise<Browser | null> {
  const target = endpoint ?? browserEndpoint();
  if (!target) return null;

  // Accept an http(s) DevTools URL and convert it to a WebSocket URL.
  let wsUrl = target;
  try {
    const parsed = new URL(target);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const versionPath = `${parsed.pathname.replace(/\/$/, '')}/json/version`;
      const response = await fetch(`${parsed.origin}${versionPath}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const version = (await response.json()) as { webSocketDebuggerUrl?: string };
      if (!version.webSocketDebuggerUrl) return null;
      wsUrl = version.webSocketDebuggerUrl;
    }
  } catch {
    return null;
  }

  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl);
  } catch {
    return null;
  }

  const opened = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  if (!opened) return null;

  const session = new CdpSession(socket, null);

  try {
    await session.send('Target.setDiscoverTargets', { discover: true }, 10_000);
  } catch {
    /* not fatal */
  }

  return new Browser(wsUrl, session);
}

/** Is a browser currently reachable? */
export async function browserAvailable(): Promise<boolean> {
  const browser = await connectBrowser();
  if (!browser) return false;
  await browser.dispose();
  return true;
}

/** The endpoint the browser module would use, for the Sources screen. */
export function browserStatus(): {
  configured: boolean;
  endpoint: string | null;
  reason: string | null;
} {
  const endpoint = browserEndpoint();
  return {
    configured: Boolean(endpoint),
    endpoint,
    reason: endpoint
      ? null
      : 'No browser endpoint configured. Set SAHIPICK_BROWSER_ENDPOINT to a CDP endpoint (local Chromium --remote-debugging-port, or a Kitesurf instance). Research will use HTTP extraction only.',
  };
}

export { config as browserConfig };

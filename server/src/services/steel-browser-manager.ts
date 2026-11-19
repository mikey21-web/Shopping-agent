import {
  type BrowserAdapter,
  type BrowserSession,
  type CreateTabResult,
  type NavigateResult,
  type ScreenshotResult,
  type SnapshotResult,
} from './browser-manager.ts';

export interface SteelBrowserManagerOptions {
  baseUrl?: string;
  allowedOrigins?: string[];
  idleTimeoutMs?: number;
  maxSessionMs?: number;
  navigationTimeoutMs?: number;
}

interface SteelSession {
  id: string;
  status: string;
  timeout: number;
}

interface SteelCommandResult {
  command: string;
  ok: boolean;
  effect?: string;
  tab?: string;
  url?: string;
  title?: string;
  snapshot?: string;
  screenshot?: string;
  data?: string;
  value?: unknown;
  what?: string;
  error?: { message?: string };
}

interface SteelCommandResponse {
  state: 'completed' | 'failed' | 'partial';
  ran: number;
  results: SteelCommandResult[];
  page?: { tab: string; url: string; title: string };
  session?: SteelSession;
}

function envNum(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export class SteelBrowserManager implements BrowserAdapter {
  private readonly baseUrl: string;
  private readonly allowedOrigins: Set<string>;
  private readonly maxSessionMs: number;
  private readonly navigationTimeoutMs: number;
  private session: BrowserSession | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(options: SteelBrowserManagerOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.SAHIPICK_STEEL_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.allowedOrigins = new Set(options.allowedOrigins ?? splitList(process.env.SAHIPICK_BROWSER_ALLOWED_ORIGINS));
    this.maxSessionMs = options.maxSessionMs ?? envNum('SAHIPICK_BROWSER_MAX_SESSION_MS', 1_800_000);
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? envNum('SAHIPICK_BROWSER_NAV_TIMEOUT_MS', 25_000);
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.busy;
    let release!: () => void;
    this.busy = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  private async request(path: string, method = 'POST', body?: unknown, headers: Record<string, string> = {}): Promise<SteelCommandResponse | SteelSession> {
    const apiKey = process.env.SAHIPICK_BROWSER_API_KEY;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: method === 'GET' ? undefined : body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let message = `Steel request failed: ${response.status} ${response.statusText}`;
      try {
        const payload = (await response.json()) as { error?: { message?: string } };
        message = payload.error?.message ?? message;
      } catch { /* keep default */ }
      throw new Error(message);
    }
    return response.json() as Promise<SteelCommandResponse | SteelSession>;
  }

  private async commands(sessionId: string, commands: Array<Record<string, unknown>>): Promise<SteelCommandResponse> {
    const payload = await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, 'POST', { commands });
    const response = payload as SteelCommandResponse;
    for (const result of response.results) {
      if (!result.ok) {
        throw new Error(`Steel command ${result.command} failed: ${result.error?.message ?? 'unknown error'}`);
      }
    }
    return response;
  }

  private first(response: SteelCommandResponse, command: string): SteelCommandResult | undefined {
    return response.results.find((result) => result.command === command);
  }

  async createSession(userId: string, taskId: string): Promise<BrowserSession> {
    return this.withLock(async () => {
      if (this.session) {
        const [response, inspect] = await Promise.all([
          this.commands(this.session.id, [{ command: 'snapshot', interactive: false }]),
          this.request(`/v1/sessions/${encodeURIComponent(this.session.id)}/live-details`, 'GET'),
        ]);
        void inspect;
        return this.touchSession(this.session, response);
      }
      const payload = (await this.request('/v1/sessions', 'POST', {})) as SteelSession;
      const now = Date.now();
      const session: BrowserSession = {
        id: payload.id,
        userId,
        taskId,
        context: null as unknown as BrowserSession['context'],
        tabs: new Map(),
        createdAt: now,
        lastUsedAt: now,
      };
      this.session = session;
      return session;
    });
  }

  private touchSession(session: BrowserSession, response: SteelCommandResponse): BrowserSession {
    session.lastUsedAt = Date.now();
    if (response.page) {
      // Steel reports the current tab; keep our tab bookkeeping aligned.
      if (!session.tabs.has(response.page.tab)) {
        session.tabs.set(response.page.tab, { id: response.page.tab, page: {} as unknown as never });
      }
    }
    return session;
  }

  async getSession(id: string): Promise<BrowserSession | null> {
    return this.session?.id === id ? (this.touchSession(this.session, { state: 'completed', ran: 0, results: [] }), this.session) : null;
  }

  async createTab(sessionId: string, url?: string): Promise<CreateTabResult> {
    return this.withLock(async () => {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error(`No browser session ${sessionId}.`);
      const response = await this.commands(session.id, [{ command: 'tab', action: 'new' }]);
      const tab = this.first(response, 'tab')?.tab ?? response.page?.tab;
      if (!tab) throw new Error(`Steel did not return a new tab for session ${sessionId}.`);
      session.tabs.set(tab, { id: tab, page: {} as unknown as never });
      session.lastUsedAt = Date.now();
      let finalUrl = 'about:blank';
      if (url) {
        const nav = await this.navigate(sessionId, tab, url);
        finalUrl = nav.url;
      }
      return { sessionId, tabId: tab, url: finalUrl };
    });
  }

  async navigate(sessionId: string, tabId: string, rawUrl: string): Promise<NavigateResult> {
    return this.withLock(async () => {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error(`No browser session ${sessionId}.`);
      if (!session.tabs.has(tabId)) throw new Error(`No tab ${tabId} in session ${sessionId}.`);
      const url = this.validateUrl(rawUrl);
      const response = await this.commands(sessionId, [{ command: 'navigate', url, tab: tabId }]);
      const page = response.page ?? { tab: tabId, url, title: '' };
      session.tabs.set(page.tab, { id: page.tab, page: session.tabs.get(page.tab)?.page ?? {} as never });
      return { sessionId, tabId: page.tab, url: page.url || url, status: 200 };
    });
  }

  async click(sessionId: string, tabId: string, elementRef: string): Promise<void> {
    await this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      await this.commands(sessionId, [{ command: 'click', target: elementRef, tab: tabId }]);
    });
  }

  async typeText(sessionId: string, tabId: string, elementRef: string, text: string, submit = false): Promise<void> {
    await this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      await this.commands(sessionId, [
        { command: 'type', target: elementRef, text, tab: tabId },
        ...(submit ? [{ command: 'press', key: 'Enter', tab: tabId } as const] : []),
      ]);
    });
  }

  async scroll(sessionId: string, tabId: string, direction: 'up' | 'down', amount = 600): Promise<void> {
    await this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      await this.commands(sessionId, [{ command: 'scroll', direction, amount, tab: tabId }]);
    });
  }

  async waitForRender(sessionId: string, tabId: string, settleMs = 600): Promise<void> {
    await this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      await this.commands(sessionId, [{ command: 'wait', duration: settleMs, tab: tabId }]);
    });
  }

  async getSnapshot(sessionId: string, tabId: string): Promise<SnapshotResult> {
    return this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      const response = await this.commands(sessionId, [
        { command: 'snapshot', interactive: true, tab: tabId },
        { command: 'get', what: 'title', tab: tabId },
        { command: 'get', what: 'url', tab: tabId },
      ]);
      const snapshot = this.first(response, 'snapshot')?.snapshot ?? '';
      const titleResult = response.results.find((result) => result.what === 'title' && result.value !== undefined);
      const urlResult = response.results.find((result) => result.what === 'url' && result.value !== undefined);
      const title = String(titleResult?.value ?? response.page?.title ?? '');
      const url = String(urlResult?.value ?? response.page?.url ?? '');
      return { sessionId, tabId, url, snapshot: String(snapshot).slice(0, 100_000), title };
    });
  }

  async getContent(sessionId: string, tabId: string): Promise<string> {
    return this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      const response = await this.commands(sessionId, [{ command: 'get', what: 'html', tab: tabId }]);
      const html = response.results.find((result) => result.command === 'get' && result.value !== undefined)?.value;
      return String(html ?? response.page?.url ?? '');
    });
  }

  async takeScreenshot(sessionId: string, tabId: string): Promise<ScreenshotResult> {
    return this.withLock(async () => {
      await this.assertTab(sessionId, tabId);
      const response = await this.commands(sessionId, [{ command: 'screenshot', tab: tabId }]);
      const screenshotResult = response.results.find((result) => result.command === 'screenshot');
      const screenshot = screenshotResult?.data ?? screenshotResult?.screenshot;
      if (!screenshot) throw new Error('Steel did not return a screenshot.');
      return { sessionId, tabId, mimeType: 'image/png', dataBase64: screenshot };
    });
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    await this.withLock(async () => {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error(`No browser session ${sessionId}.`);
      await this.commands(sessionId, [{ command: 'tab', action: 'close', tab: tabId }]);
      session.tabs.delete(tabId);
      session.lastUsedAt = Date.now();
    });
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const session = await this.getSession(sessionId);
      if (!session) return;
      await this.request(`/v1/sessions/${encodeURIComponent(session.id)}/release`, 'POST', {});
      if (this.session?.id === session.id) this.session = null;
    });
  }

  async dispose(): Promise<void> {
    if (!this.session) return;
    await this.releaseSession(this.session.id);
  }

  status(): { engine: string; executablePath: string | null; sessions: number } {
    return { engine: 'steel', executablePath: this.baseUrl, sessions: this.session ? 1 : 0 };
  }

  private async assertTab(sessionId: string, tabId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`No browser session ${sessionId}.`);
    if (!session.tabs.has(tabId)) throw new Error(`No tab ${tabId} in session ${sessionId}.`);
  }

  private validateUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) URLs may be navigated to.');
    if (this.allowedOrigins.size > 0 && !this.allowedOrigins.has(parsed.origin)) throw new Error(`URL origin ${parsed.origin} is not allowed.`);
    if (parsed.protocol === 'https:' || this.allowedOrigins.has(parsed.origin)) return parsed.toString();
    throw new Error('Plain HTTP navigation requires the origin to be allowlisted.');
  }

}

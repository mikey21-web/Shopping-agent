/**
 * Runtime configuration.
 *
 * A tiny .env reader is included deliberately: `dotenv` is unnecessary weight
 * for a handful of variables and this keeps the Termux install small.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..');

function loadDotEnv(): void {
  const envPath = resolve(REPO_ROOT, '.env');
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables always win over the .env file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  /** Serve the built web app from server (single-process production mode). */
  serveWebBuild: boolean;
  webDistPath: string;
  /** Log verbosity. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Which AI provider to use for conversational features. */
  aiProvider: 'local' | 'openai_compatible';
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiApiKey: string | null;
  /** Retailer adapters that may hit the network. Off by default until verified. */
  enableLiveRetailers: boolean;
  /**
   * Web research from the open web. Off by default: it needs network access
   * and a configured search provider, and an answer must never depend on it.
   */
  enableWebResearch: boolean;
  /** User-Agent used by any outbound retailer request. */
  userAgent: string;
}

export const config: AppConfig = {
  port: num('PORT', 4000),
  host: process.env.HOST ?? '0.0.0.0',
  databasePath: process.env.DATABASE_PATH ?? resolve(SERVER_ROOT, 'data/sahipick.db'),
  serveWebBuild: bool('SERVE_WEB_BUILD', true),
  webDistPath: resolve(REPO_ROOT, 'web/dist'),
  logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  aiProvider: (process.env.AI_PROVIDER as AppConfig['aiProvider']) ?? 'local',
  aiBaseUrl: process.env.AI_BASE_URL ?? null,
  aiModel: process.env.AI_MODEL ?? null,
  aiApiKey: process.env.AI_API_KEY ?? null,
  enableLiveRetailers: bool('ENABLE_LIVE_RETAILERS', false),
  enableWebResearch: bool('ENABLE_WEB_RESEARCH', false),
  userAgent:
    process.env.SAHIPICK_USER_AGENT ??
    'SahiPick/0.1 (+https://sahipick.example; shopping decision assistant)',
};

/** True when an LLM endpoint is configured and usable. */
export function hasRemoteLlm(): boolean {
  return Boolean(config.aiBaseUrl && config.aiModel && config.aiApiKey);
}

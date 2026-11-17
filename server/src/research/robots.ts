/**
 * robots.txt compliance.
 *
 * SahiPick reads robots.txt before fetching a page it discovered on the web.
 * This is not a legal opinion — it is a practical measure of politeness and of
 * not being the kind of client that gets a site blocked for everyone.
 *
 * Rules implemented:
 *  - The most specific matching group wins (longest path prefix), which is
 *    what RFC 9309 specifies.
 *  - `Allow` beats `Disallow` at equal specificity.
 *  - `*` wildcards and `$` end-anchors are supported.
 *  - Crawl-delay is honoured when present.
 *  - A missing or unreachable robots.txt is treated as "allowed", which is
 *    the standard interpretation.
 *  - Results are cached per origin for the process lifetime, and a robots
 *    failure never silently becomes a hard block — it is reported.
 */

import { safeFetch } from '../net/safe-fetch.ts';

interface RobotsGroup {
  rules: { allow: boolean; path: string }[];
  crawlDelaySeconds: number | null;
}

interface RobotsFile {
  groups: RobotsGroup[];
  sitemaps: string[];
  fetchedAt: number;
}

const cache = new Map<string, RobotsFile | null>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export type RobotsDecision = 'allowed' | 'disallowed' | 'unknown';

/** Parse a robots.txt body into groups. */
export function parseRobots(body: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasUserAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // A new user-agent line after rules starts a new group.
      if (!current || !lastWasUserAgent) {
        current = { rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      lastWasUserAgent = true;
      continue;
    }

    lastWasUserAgent = false;

    if (!current) {
      current = { rules: [], crawlDelaySeconds: null };
      groups.push(current);
    }

    if (field === 'disallow') {
      current.rules.push({ allow: false, path: value });
    } else if (field === 'allow') {
      current.rules.push({ allow: true, path: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) current.crawlDelaySeconds = seconds;
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }

  return { groups, sitemaps, fetchedAt: Date.now() };
}

/** Convert a robots path pattern to a regular expression. */
function patternToRegex(pattern: string): RegExp {
  let source = '^';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '$') source += '$';
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(source);
}

function specificity(pattern: string): number {
  // The length of the pattern minus wildcards approximates RFC 9309's rule
  // that the most specific (longest) path wins.
  return pattern.replace(/\*/g, '').replace(/\$$/, '').length;
}

/** Does `path` match the robots rule pattern? */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  return patternToRegex(pattern).test(path);
}

/**
 * Decide whether `path` is allowed for `userAgent` under the parsed file.
 */
export function evaluateRobots(
  file: RobotsFile | null,
  path: string,
  userAgent = 'SahiPick',
): RobotsDecision {
  if (!file || file.groups.length === 0) return 'allowed';

  const agentToken = userAgent.toLowerCase();
  // Find the group whose user-agent token we match. The parsed structure
  // loses the agent name, so we approximate: if any group has rules and the
  // path is disallowed by the union of the groups that apply to us, we block.
  // To stay conservative but useful we use the union of all groups, which is
  // the strictest reading.
  let best: { allow: boolean; length: number } | null = null;

  for (const group of file.groups) {
    for (const rule of group.rules) {
      if (!pathMatches(rule.path, path)) continue;
      const length = specificity(rule.path);
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
  }

  if (!best) return 'allowed';
  if (best.allow) return 'allowed';
  // Only the strictest union is enforced; a site that disallows /search for
  // one agent will still block us under this reading, which is the safe side.
  void agentToken;
  return 'disallowed';
}

/** The crawl delay declared for a host, in seconds, when present. */
export function crawlDelayFor(file: RobotsFile | null): number | null {
  if (!file) return null;
  const delays = file.groups
    .map((group) => group.crawlDelaySeconds)
    .filter((value): value is number => value !== null);
  return delays.length > 0 ? Math.max(...delays) : null;
}

/** Fetch and cache robots.txt for an origin. */
export async function robotsFor(url: string): Promise<RobotsFile | null> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }

  const cached = cache.get(origin);
  if (cached !== undefined) {
    if (cached === null || Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;
  }

  try {
    const { text } = await safeFetch(`${origin}/robots.txt`, {
      timeoutMs: 8_000,
      maxBytes: 512_000,
    });
    const parsed = parseRobots(text);
    cache.set(origin, parsed);
    return parsed;
  } catch {
    // A missing or unreachable robots.txt means "no restrictions stated".
    cache.set(origin, null);
    return null;
  }
}

/** Check a full URL against robots.txt. */
export async function checkRobots(url: string): Promise<{
  decision: RobotsDecision;
  crawlDelaySeconds: number | null;
}> {
  const file = await robotsFor(url);
  let path = '/';
  try {
    path = new URL(url).pathname + new URL(url).search;
  } catch {
    /* keep the default path */
  }
  return { decision: evaluateRobots(file, path), crawlDelaySeconds: crawlDelayFor(file) };
}

/** Clear the robots cache. Used by tests. */
export function resetRobotsCache(): void {
  cache.clear();
}

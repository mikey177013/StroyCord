/**
 * Small, dependency-free helpers used by the fallback-API and local-cache
 * pipelines. Every function in here is designed to NEVER throw at the call
 * site — failures are returned as `null` / `false` so the player can keep
 * the queue moving even when the network is hostile.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Parse a JSON string without throwing. Useful when we read a body that may
 * be HTML (Cloudflare interstitial), an empty string, or a partial response.
 */
export function safeJsonParse<T = unknown>(input: string | null | undefined): T | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

export interface FetchWithRetryOptions {
  retries?: number;
  timeoutMs?: number;
  /** Optional log tag so the same helper can be reused by different layers. */
  tag?: string;
  headers?: Record<string, string>;
}

/**
 * Fetch a URL with:
 *   - hard per-attempt timeout (AbortController)
 *   - exponential backoff retries on network/5xx failure
 *   - a "no throwing" contract — returns the parsed body text or `null`
 *
 * Up to `retries` attempts (default 3) are performed before giving up.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<{ body: string; status: number } | null> {
  const retries = Math.max(1, options.retries ?? DEFAULT_RETRIES);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tag = options.tag ?? 'fallback';

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'sano.music/1.0 (+discord-bot)',
          Accept: 'application/json,text/plain,*/*',
          ...(options.headers ?? {}),
        },
      });

      // Non-OK 4xx (except 429) is usually deterministic — don't waste retries.
      if (!res.ok && res.status !== 429 && res.status < 500) {
        const body = await res.text().catch(() => '');
        console.error(`[${tag}] HTTP ${res.status} on ${redactUrl(url)}`);
        return { body, status: res.status };
      }

      if (!res.ok) {
        // 429 / 5xx → retry with backoff
        console.error(`[${tag}] HTTP ${res.status} on ${redactUrl(url)} (attempt ${attempt}/${retries})`);
        if (attempt < retries) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        return null;
      }

      const body = await res.text();
      return { body, status: res.status };
    } catch (e) {
      const reason = (e as Error).message || 'unknown';
      console.error(`[${tag}] retrying fallback API (${attempt}/${retries}) — ${reason}`);
      if (attempt < retries) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Convenience wrapper: fetch + JSON-parse + null on any failure. Used by the
 * faa.my.id pipeline so each call site is a single line.
 */
export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<T | null> {
  const res = await fetchWithRetry(url, options);
  if (!res) return null;
  if (res.status < 200 || res.status >= 300) return null;
  const parsed = safeJsonParse<T>(res.body);
  if (!parsed) {
    console.error(`[${options.tag ?? 'fallback'}] API returned invalid response`);
    return null;
  }
  return parsed;
}

/**
 * Don't leak query strings (which can contain user-supplied search text and,
 * more importantly, signed CDN URLs) into logs.
 */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

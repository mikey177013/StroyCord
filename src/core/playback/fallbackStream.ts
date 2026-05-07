import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { PassThrough, type Readable } from 'node:stream';
import { URL } from 'node:url';

const API_BASE = 'https://api-faa.my.id/faa';
const API_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 30_000;

interface YtPlayResponse {
  status?: boolean;
  result?: {
    title?: string;
    url?: string;
    mp3?: string;
    thumbnail?: string;
    duration?: number;
  };
}

interface YtSearchResponse {
  status?: boolean;
  result?: Array<{
    title?: string;
    link?: string;
  }>;
}

interface YtMp3Response {
  status?: boolean;
  result?: {
    title?: string;
    mp3?: string;
  };
}

/**
 * Fetch JSON with a hard timeout. Returns `null` on any failure so callers
 * never need a try/catch — they can just check for `null`.
 */
async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  // AbortController gives us a clean timeout without leaking sockets.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'sano.music/1.0 (+discord-bot)' },
    });
    if (!res.ok) {
      console.error(`[fallback] ${url} → HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as T;
    return data;
  } catch (e) {
    console.error('[fallback] fetch failed:', (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a track's MP3 URL via the faa.my.id API, with a 3-step waterfall:
 *
 *   1. /faa/ytplay?query=<text or url>           → result.mp3        (fastest path)
 *   2. /faa/youtube?q=<text> → first result.link → /faa/ytmp3?url=…  (search + convert)
 *   3. give up
 *
 * `query` should be either the song title (preferred — the API handles search)
 * or a YouTube URL. Returns `null` if every step fails.
 */
export async function resolveFallbackMp3(query: string): Promise<{ mp3: string; title?: string } | null> {
  const safeQuery = encodeURIComponent(query);

  // Step 1 — direct ytplay
  const ytplay = await fetchJsonSafe<YtPlayResponse>(`${API_BASE}/ytplay?query=${safeQuery}`);
  if (ytplay?.status && ytplay.result?.mp3) {
    return { mp3: ytplay.result.mp3, title: ytplay.result.title };
  }

  // Step 2 — search for first result, then ytmp3
  const search = await fetchJsonSafe<YtSearchResponse>(`${API_BASE}/youtube?q=${safeQuery}`);
  const firstLink = search?.result?.[0]?.link;
  if (firstLink) {
    const ytmp3 = await fetchJsonSafe<YtMp3Response>(`${API_BASE}/ytmp3?url=${encodeURIComponent(firstLink)}`);
    if (ytmp3?.status && ytmp3.result?.mp3) {
      return { mp3: ytmp3.result.mp3, title: ytmp3.result.title };
    }
  }

  // Step 3 — also try ytmp3 directly if the caller passed a youtube URL
  if (/youtu(?:\.be|be\.com)/i.test(query)) {
    const ytmp3 = await fetchJsonSafe<YtMp3Response>(`${API_BASE}/ytmp3?url=${safeQuery}`);
    if (ytmp3?.status && ytmp3.result?.mp3) {
      return { mp3: ytmp3.result.mp3, title: ytmp3.result.title };
    }
  }

  console.error('[fallback] all API endpoints failed for query:', query);
  return null;
}

/**
 * Open an HTTP/HTTPS stream for the given MP3 URL with redirect following.
 * Returns a `Readable` (PassThrough) that stays alive even across 302 hops,
 * or `null` if the URL fails to open.
 */
export function streamMp3Url(mp3Url: string): Readable | null {
  const passthrough = new PassThrough();
  let settled = false;

  const open = (target: string, redirectsLeft: number) => {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      console.error('[fallback] invalid mp3 URL:', target);
      passthrough.destroy(new Error('invalid mp3 URL'));
      return;
    }

    const lib = parsed.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = lib(
      {
        method: 'GET',
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          'User-Agent': 'Mozilla/5.0 sano.music/1.0',
          Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        // follow redirects (301/302/307/308)
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, target).toString();
          res.resume(); // discard body
          open(next, redirectsLeft - 1);
          return;
        }

        if (status < 200 || status >= 300) {
          console.error(`[fallback] mp3 stream HTTP ${status} on ${target}`);
          res.resume();
          passthrough.destroy(new Error(`mp3 HTTP ${status}`));
          return;
        }

        settled = true;
        res.pipe(passthrough);
        res.on('error', (e) => passthrough.destroy(e));
      }
    );

    req.setTimeout(STREAM_TIMEOUT_MS, () => {
      console.error('[fallback] mp3 stream timeout on', target);
      req.destroy(new Error('stream timeout'));
    });

    req.on('error', (e) => {
      if (!settled) {
        console.error('[fallback] mp3 request error:', e.message);
        passthrough.destroy(e);
      }
    });

    req.end();
  };

  open(mp3Url, 5);
  return passthrough;
}

/**
 * High-level helper used by the player: given a song URL or title, ask the
 * faa.my.id API for an MP3, open it, and return a Readable ready for
 * `createAudioResource`.
 */
export async function createFallbackApiStream(query: string): Promise<{ stream: Readable; title?: string } | null> {
  const resolved = await resolveFallbackMp3(query);
  if (!resolved) return null;

  const stream = streamMp3Url(resolved.mp3);
  if (!stream) return null;

  return { stream, title: resolved.title };
}

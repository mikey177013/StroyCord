import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { PassThrough, type Readable } from 'node:stream';
import { URL } from 'node:url';
import { fetchJsonWithRetry } from 'src/core/playback/apiHelpers';

const API_BASE = 'https://api-faa.my.id/faa';
const STREAM_TIMEOUT_MS = 30_000;
const STREAM_MAX_REDIRECTS = 5;

/**
 * The faa.my.id endpoints we use have slightly different shapes depending
 * on the route — /ytplay returns a single result, /youtube returns an array,
 * /ytmp3 returns a single result. Be permissive on field names because the
 * API has been observed to return both `link` and `url` in different builds.
 */
interface YtPlayResponse {
  status?: boolean;
  result?: {
    title?: string;
    url?: string;
    mp3?: string;
    thumbnail?: string;
    duration?: number | string;
    author?: string;
  };
}

interface YtSearchResponse {
  status?: boolean;
  result?: Array<{
    title?: string;
    link?: string;
    url?: string;
  }>;
}

interface YtMp3Response {
  status?: boolean;
  result?: {
    title?: string;
    mp3?: string;
    thumbnail?: string;
  };
}

export interface ResolvedFallback {
  mp3: string;
  title?: string;
  thumbnail?: string;
  /** original YouTube URL when known — handy for downstream caching. */
  sourceUrl?: string;
}

/**
 * Resolve a track's MP3 URL via the faa.my.id API, with retries and a
 * three-step waterfall:
 *
 *   1. /faa/ytplay?query=<text>                   → result.mp3        (fastest path)
 *   2. /faa/youtube?q=<text> → first result.link  → /faa/ytmp3?url=…  (search + convert)
 *   3. /faa/ytmp3?url=<url>                       → result.mp3        (when caller passes a YT URL)
 *
 * `query` should preferably be the song title (the API search engine handles
 * free text best). Returns `null` only after every step has been exhausted.
 */
export async function resolveFallbackMp3(query: string): Promise<ResolvedFallback | null> {
  const trimmed = (query ?? '').trim();
  if (trimmed === '') {
    console.error('[fallback] empty query — refusing to call API');
    return null;
  }
  const safeQuery = encodeURIComponent(trimmed);

  // Step 1 — direct /ytplay (matches the example response in the spec)
  const ytplay = await fetchJsonWithRetry<YtPlayResponse>(`${API_BASE}/ytplay?query=${safeQuery}`, {
    tag: 'fallback:ytplay',
  });
  if (ytplay?.status && ytplay.result?.mp3) {
    return {
      mp3: ytplay.result.mp3,
      title: ytplay.result.title,
      thumbnail: ytplay.result.thumbnail,
      sourceUrl: ytplay.result.url,
    };
  }

  // Step 2 — /youtube search → /ytmp3
  const search = await fetchJsonWithRetry<YtSearchResponse>(`${API_BASE}/youtube?q=${safeQuery}`, {
    tag: 'fallback:search',
  });
  const firstHit = search?.result?.[0];
  const firstLink = firstHit?.link ?? firstHit?.url;
  if (search?.status && firstLink) {
    const ytmp3 = await fetchJsonWithRetry<YtMp3Response>(`${API_BASE}/ytmp3?url=${encodeURIComponent(firstLink)}`, {
      tag: 'fallback:ytmp3',
    });
    if (ytmp3?.status && ytmp3.result?.mp3) {
      return {
        mp3: ytmp3.result.mp3,
        title: ytmp3.result.title ?? firstHit?.title,
        thumbnail: ytmp3.result.thumbnail,
        sourceUrl: firstLink,
      };
    }
  }

  // Step 3 — caller passed a YT URL directly
  if (/youtu(?:\.be|be\.com)/i.test(trimmed)) {
    const ytmp3 = await fetchJsonWithRetry<YtMp3Response>(`${API_BASE}/ytmp3?url=${safeQuery}`, {
      tag: 'fallback:ytmp3-direct',
    });
    if (ytmp3?.status && ytmp3.result?.mp3) {
      return {
        mp3: ytmp3.result.mp3,
        title: ytmp3.result.title,
        thumbnail: ytmp3.result.thumbnail,
        sourceUrl: trimmed,
      };
    }
  }

  console.error('[fallback] API returned invalid response — all endpoints exhausted');
  return null;
}

/**
 * Open an HTTP/HTTPS stream for the given MP3 URL with redirect following.
 * Returns a `Readable` (PassThrough) that stays alive even across 302 hops,
 * or `null` if the target is malformed before we even try to dial.
 *
 * The PassThrough is destroyed on any network error so consumers see a
 * single failure event rather than a half-open stream.
 */
export function streamMp3Url(mp3Url: string): Readable | null {
  if (!mp3Url || typeof mp3Url !== 'string') {
    console.error('[fallback] streamMp3Url called with empty url');
    return null;
  }

  let parsedInitial: URL;
  try {
    parsedInitial = new URL(mp3Url);
  } catch {
    console.error('[fallback] invalid mp3 URL');
    return null;
  }
  if (parsedInitial.protocol !== 'http:' && parsedInitial.protocol !== 'https:') {
    console.error('[fallback] unsupported protocol on mp3 URL:', parsedInitial.protocol);
    return null;
  }

  const passthrough = new PassThrough();
  let settled = false;

  const open = (target: string, redirectsLeft: number) => {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
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

        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, target).toString();
          res.resume();
          open(next, redirectsLeft - 1);
          return;
        }

        if (status < 200 || status >= 300) {
          console.error(`[fallback] mp3 stream HTTP ${status}`);
          res.resume();
          passthrough.destroy(new Error(`mp3 HTTP ${status}`));
          return;
        }

        settled = true;
        res.pipe(passthrough);
        res.on('error', (e) => passthrough.destroy(e));
        res.on('aborted', () => passthrough.destroy(new Error('mp3 stream aborted')));
      }
    );

    req.setTimeout(STREAM_TIMEOUT_MS, () => {
      console.error('[fallback] mp3 stream timeout');
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

  open(mp3Url, STREAM_MAX_REDIRECTS);
  return passthrough;
}

/**
 * High-level helper used by the player: given a song URL or title, ask the
 * faa.my.id API for an MP3, open it, and return a Readable ready for
 * `createAudioResource` along with the resolved metadata (so the caller can
 * use `mp3` / `sourceUrl` when building cache filenames).
 */
export async function createFallbackApiStream(
  query: string
): Promise<{ stream: Readable; title?: string; mp3: string; sourceUrl?: string } | null> {
  const resolved = await resolveFallbackMp3(query);
  if (!resolved) return null;

  const stream = streamMp3Url(resolved.mp3);
  if (!stream) return null;

  console.log('[player] using fallback API');
  return {
    stream,
    title: resolved.title,
    mp3: resolved.mp3,
    sourceUrl: resolved.sourceUrl,
  };
}

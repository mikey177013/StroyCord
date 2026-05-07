import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// yt-dlp binary path managed by youtube-dl-exec (downloaded automatically on first use)
const YTDLP_BIN = join(
  dirname(require.resolve('youtube-dl-exec/package.json')),
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

// Format selection — prefer the small/medium opus webm streams (251/250/249),
// fall back to whatever bestaudio yields, and finally to "best" so a single
// missing itag never breaks playback. Mirrors what the user requested:
//   '251/250/249/bestaudio/best'
// This is what fixes the dreaded "Requested format is not available" error
// you get when YouTube starts rotating itags for an account/IP.
const YTDLP_FORMAT = '251/250/249/bestaudio/best';

/**
 * Resolve the cookies.txt path. Order:
 *   1. YOUTUBE_COOKIES_PATH env var (absolute or relative to cwd)
 *   2. ./cookies.txt at the project root
 * Returns `null` if no file exists, so we can skip the `--cookies` flag.
 *
 * Cookie *contents* are never logged — only the path and a "loaded" marker.
 */
export function resolveCookiesPath(): string | null {
  const envPath = process.env.YOUTUBE_COOKIES_PATH;
  if (envPath && envPath.trim() !== '') {
    const abs = isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
    if (existsSync(abs)) return abs;
  }
  const fallback = resolve(process.cwd(), 'cookies.txt');
  if (existsSync(fallback)) return fallback;
  return null;
}

let cookiesLoadedLogged = false;

/**
 * Build the canonical yt-dlp argv list used by both the live-stream path and
 * the local-download/cache fallback. Caller decides where stdout goes by
 * passing extra args (`-o -` to stdout, `-o <file>` for download).
 */
function baseYtdlpArgs(url: string, cookiesPath: string | null, extra: string[]): string[] {
  const args: string[] = [];
  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }
  args.push(
    url,
    '--format',
    YTDLP_FORMAT,
    '--extract-audio',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--no-progress',
    // realistic UA helps with anti-bot heuristics
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    // give yt-dlp a chance to recover from transient HTTP errors
    '--retries',
    '3',
    '--fragment-retries',
    '3'
  );
  args.push(...extra);
  return args;
}

/**
 * Log cookie state once per process. Never echoes file contents — only that
 * cookies were found and the absolute path.
 */
function logCookieState(cookiesPath: string | null): void {
  if (cookiesLoadedLogged) return;
  cookiesLoadedLogged = true;
  if (cookiesPath) {
    console.log('[player] yt-dlp using cookies');
    console.log('[player] cookies loaded');
  } else {
    console.log('[player] cookies.txt not found');
  }
}

/**
 * Spawns yt-dlp and pipes audio to stdout so the caller can hand it to
 * `createAudioResource`. Uses the priority format string and `--extract-audio`
 * to maximise the chance of getting a usable stream on the first try.
 */
export function createYtdlpStream(url: string): ChildProcessWithoutNullStreams {
  const cookies = resolveCookiesPath();
  logCookieState(cookies);

  const args = baseYtdlpArgs(url, cookies, ['--output', '-']);

  console.log('[player] yt-dlp stream started');
  return spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Spawn yt-dlp in *download* mode — produces an mp3 file at `outputPath`.
 * Used by the local-cache fallback when live streaming is impossible.
 *
 * Returns the child process so the caller can await the `close` event and
 * inspect the exit code / stderr.
 */
export function createYtdlpDownload(url: string, outputPath: string): ChildProcessWithoutNullStreams {
  const cookies = resolveCookiesPath();
  logCookieState(cookies);

  const args = baseYtdlpArgs(url, cookies, ['--audio-format', 'mp3', '--audio-quality', '0', '--output', outputPath]);

  console.log('[player] downloading fallback mp3');
  return spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export { YTDLP_BIN, YTDLP_FORMAT };

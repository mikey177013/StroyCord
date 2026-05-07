import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// yt-dlp binary path managed by youtube-dl-exec (downloaded automatically on first use)
const YTDLP_BIN = join(
  dirname(require.resolve('youtube-dl-exec/package.json')),
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

/**
 * Resolve the cookies.txt path. Order:
 *   1. YOUTUBE_COOKIES_PATH env var (absolute or relative to cwd)
 *   2. ./cookies.txt at the project root
 * Returns `null` if no file exists, so we can skip the `--cookies` flag.
 */
function resolveCookiesPath(): string | null {
  const envPath = process.env.YOUTUBE_COOKIES_PATH;
  if (envPath && envPath.trim() !== '') {
    const abs = isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
    if (existsSync(abs)) return abs;
  }
  const fallback = resolve(process.cwd(), 'cookies.txt');
  if (existsSync(fallback)) return fallback;
  return null;
}

/**
 * Spawns yt-dlp and returns the child process. Audio is piped to stdout so
 * the caller can hand it to `createAudioResource`.
 *
 * Uses `--cookies <cookies.txt>` when a cookies file is found — this is the
 * primary playback path and is what survives YouTube's anti-bot prompts.
 */
export function createYtdlpStream(url: string): ChildProcessWithoutNullStreams {
  const cookies = resolveCookiesPath();

  const args: string[] = [];
  if (cookies) {
    args.push('--cookies', cookies);
  }

  args.push(
    url,
    '--output',
    '-', // pipe audio to stdout
    '--format',
    'bestaudio',
    '--quiet',
    '--no-warnings'
  );

  if (cookies) {
    console.log(`[player] yt-dlp using cookies: ${cookies}`);
  } else {
    console.log('[player] yt-dlp running without cookies (cookies.txt not found)');
  }

  // spawn is safe: arguments are passed as an array (no shell, no injection)
  return spawn(YTDLP_BIN, args);
}

export { YTDLP_BIN };

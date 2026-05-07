import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream, existsSync, promises as fsp, mkdirSync, type Stats } from 'node:fs';
import { basename, join } from 'node:path';
import type { Readable } from 'node:stream';
import { cacheConfig } from 'src/core/playback/cacheConfig';
import { createYtdlpDownload } from 'src/core/playback/ytdlpStream';
import { extractVideoId } from 'src/utils/youtubeUtils';

/**
 * Local-cache / scrape-download fallback layer.
 *
 *   1. Build a deterministic filename from the YouTube videoId (when known)
 *      plus a normalised slug of the title, so re-requesting the same song
 *      reuses the cached mp3 instead of downloading again.
 *   2. Download to a temp `.part` file with yt-dlp, then atomically rename
 *      to the final `.mp3` on success — protects against half-written files.
 *   3. Concurrent download de-duplication: identical requests share the same
 *      Promise so we never spawn yt-dlp twice for the same track.
 *   4. Periodic cleanup honours `cacheConfig.maxSizeBytes` and `maxAgeMs`.
 *
 * This module is conceptually inspired by yt-music-scraper / yt_music_scrap
 * but written from scratch and adapted to discord.js / @discordjs/voice.
 */

const PART_SUFFIX = '.part';

let cleanupTimer: NodeJS.Timeout | null = null;
const inflightDownloads = new Map<string, Promise<string | null>>();

interface CachedTrackHints {
  title?: string;
  /** Original YouTube URL. Optional — we'll fall back to title-only naming. */
  url?: string;
}

/**
 * Initialise the on-disk cache directory and start the periodic cleanup tick.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initLocalCache(): void {
  if (!cacheConfig.enabled) return;

  try {
    if (!existsSync(cacheConfig.dir)) {
      mkdirSync(cacheConfig.dir, { recursive: true });
    }
  } catch (e) {
    console.error('[player] failed to create cache dir:', (e as Error).message);
    return;
  }

  if (cacheConfig.autoCleanup && !cleanupTimer) {
    // Kick off an immediate sweep, then schedule recurring ones.
    cleanupCache().catch((e) => console.error('[player] cache cleanup failed:', e));
    cleanupTimer = setInterval(() => {
      cleanupCache().catch((e) => console.error('[player] cache cleanup failed:', e));
    }, cacheConfig.cleanupIntervalMs);
    // Don't keep the event loop alive just for cleanup.
    cleanupTimer.unref?.();
  }
}

/**
 * Normalise a track title into a filesystem-safe slug. Conservative on
 * purpose: lowercase, ASCII alphanumerics + underscores only.
 *   "Imagine Dragons - Believer (Official Video)" → "imagine_dragons_believer_official_video"
 */
export function slugifyTitle(title: string): string {
  return (
    (title || 'track')
      .toLowerCase()
      .replace(/[^\w\s-]+/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'track'
  );
}

/**
 * Build the canonical cache filename for a track. Prefers `<videoId>.mp3`
 * (stable, dedup-safe) and falls back to the slugified title.
 */
export function cacheFileFor(hints: CachedTrackHints): string {
  let base = '';
  if (hints.url) {
    const id = extractVideoId(hints.url);
    if (id && /^[a-zA-Z\d_-]{6,20}$/.test(id)) {
      base = id;
    }
  }
  if (!base) base = slugifyTitle(hints.title ?? '');
  return join(cacheConfig.dir, `${base}.mp3`);
}

/**
 * Returns the cached file path if it exists and looks valid, else `null`.
 * "Valid" = present + non-empty + ≥ minValidBytes (guards against truncation).
 */
export async function findCachedTrack(hints: CachedTrackHints): Promise<string | null> {
  if (!cacheConfig.enabled) return null;
  const target = cacheFileFor(hints);
  try {
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return null;
    if (stat.size < cacheConfig.minValidBytes) {
      // Treat as corrupt — remove it and force a fresh download next time.
      console.log('[player] corrupt cache removed:', basename(target));
      await fsp.unlink(target).catch(() => undefined);
      return null;
    }
    // Touch the mtime so LRU-style cleanup keeps recently used files.
    await fsp.utimes(target, new Date(), new Date()).catch(() => undefined);
    return target;
  } catch {
    return null;
  }
}

/**
 * Open a `Readable` from a cached mp3. The caller is expected to wrap this
 * in `createAudioResource(stream, { inputType: StreamType.Arbitrary })`.
 */
export function openCachedStream(filePath: string): Readable {
  console.log('[player] cache hit:', basename(filePath));
  return createReadStream(filePath);
}

/**
 * Download a track via yt-dlp into the cache, atomically renaming the temp
 * `.part` file on success. Returns the final path or `null` on failure.
 *
 * Concurrent calls for the same `(url, title)` share the same Promise so we
 * never run two downloads for the same song in parallel.
 */
export async function downloadToCache(url: string, hints: CachedTrackHints = {}): Promise<string | null> {
  if (!cacheConfig.enabled || !cacheConfig.localFallbackEnabled) return null;
  if (!url || typeof url !== 'string') return null;

  const finalPath = cacheFileFor({ ...hints, url });
  // De-dup concurrent downloads against the canonical final path.
  const existing = inflightDownloads.get(finalPath);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    // Cache hit while we were queuing? Honour it.
    const hit = await findCachedTrack({ ...hints, url });
    if (hit) return hit;

    try {
      if (!existsSync(cacheConfig.dir)) {
        mkdirSync(cacheConfig.dir, { recursive: true });
      }
    } catch (e) {
      console.error('[player] cache dir unavailable:', (e as Error).message);
      return null;
    }

    const partPath = `${finalPath}${PART_SUFFIX}`;
    // Wipe any leftover `.part` from a previous interrupted run.
    await fsp.unlink(partPath).catch(() => undefined);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = createYtdlpDownload(url, partPath);
    } catch (e) {
      console.error('[player] yt-dlp download spawn failed:', (e as Error).message);
      return null;
    }

    const ok = await new Promise<boolean>((resolveOnce) => {
      let stderrBuf = '';
      child.stderr.on('data', (c: Buffer) => {
        stderrBuf += c.toString();
      });
      child.on('error', (e) => {
        console.error('[player] yt-dlp download error:', e.message);
        resolveOnce(false);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          const tail = stderrBuf.trim().split('\n').slice(-1)[0] ?? '';
          console.error(`[player] yt-dlp download exited ${code}${tail ? ` — ${tail}` : ''}`);
          resolveOnce(false);
          return;
        }
        resolveOnce(true);
      });
    });

    if (!ok) {
      await fsp.unlink(partPath).catch(() => undefined);
      return null;
    }

    // yt-dlp may have written to a slightly different name (it tacks on
    // `.mp3` itself when we use --extract-audio + --audio-format mp3).
    // We told it to use `partPath` literally, but be defensive: if `partPath`
    // doesn't exist, look for `<finalPath>` directly (yt-dlp sometimes
    // strips the `.part` ext when post-processing).
    const writtenPath = await pickWrittenFile(partPath, finalPath);
    if (!writtenPath) {
      console.error('[player] download produced no output file');
      return null;
    }

    // Validate size before promoting the temp file.
    let stat: Stats;
    try {
      stat = await fsp.stat(writtenPath);
    } catch {
      return null;
    }
    if (stat.size < cacheConfig.minValidBytes) {
      console.error('[player] downloaded mp3 too small, discarding');
      await fsp.unlink(writtenPath).catch(() => undefined);
      return null;
    }

    if (writtenPath !== finalPath) {
      try {
        await fsp.rename(writtenPath, finalPath);
      } catch (e) {
        console.error('[player] failed to rename cache file:', (e as Error).message);
        await fsp.unlink(writtenPath).catch(() => undefined);
        return null;
      }
    }

    console.log('[player] cached song saved:', basename(finalPath));
    // Schedule a cleanup pass so a fresh download never blows past the cap.
    cleanupCache().catch(() => undefined);
    return finalPath;
  })();

  inflightDownloads.set(finalPath, job);
  try {
    return await job;
  } finally {
    inflightDownloads.delete(finalPath);
  }
}

/**
 * yt-dlp's --extract-audio + --audio-format mp3 sometimes writes to
 * `<output>` and sometimes to `<output>.mp3` (it post-processes after the
 * initial download). Try both before giving up.
 */
async function pickWrittenFile(primary: string, alt: string): Promise<string | null> {
  for (const candidate of [primary, `${primary}.mp3`, alt]) {
    try {
      const s = await fsp.stat(candidate);
      if (s.isFile() && s.size > 0) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Sweep the cache directory:
 *   1. Drop files older than `maxAgeMs`.
 *   2. If total size > `maxSizeBytes`, drop oldest-first until we're under.
 *
 * All file IO is async so we don't block the event loop.
 */
export async function cleanupCache(): Promise<void> {
  if (!cacheConfig.enabled || !cacheConfig.autoCleanup) return;

  let entries: string[];
  try {
    entries = await fsp.readdir(cacheConfig.dir);
  } catch {
    return; // dir doesn't exist yet — nothing to clean
  }

  const now = Date.now();
  const stats: Array<{ path: string; size: number; mtimeMs: number }> = [];

  for (const name of entries) {
    if (!name.endsWith('.mp3')) continue;
    const full = join(cacheConfig.dir, name);
    let s: Stats;
    try {
      s = await fsp.stat(full);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;

    if (cacheConfig.maxAgeMs > 0 && now - s.mtimeMs > cacheConfig.maxAgeMs) {
      await fsp.unlink(full).catch(() => undefined);
      continue;
    }
    stats.push({ path: full, size: s.size, mtimeMs: s.mtimeMs });
  }

  let total = stats.reduce((acc, e) => acc + e.size, 0);
  if (total <= cacheConfig.maxSizeBytes) {
    console.log('[player] cache cleanup complete');
    return;
  }

  // Oldest first — LRU-ish since we touch mtime on every cache hit.
  stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const e of stats) {
    if (total <= cacheConfig.maxSizeBytes) break;
    await fsp.unlink(e.path).catch(() => undefined);
    total -= e.size;
  }
  console.log('[player] cache cleanup complete');
}

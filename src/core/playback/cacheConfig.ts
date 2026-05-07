import { resolve } from 'node:path';

/**
 * Centralised, env-tunable settings for the local-cache scrape fallback.
 * Anything that touches disk should read from here so the operator can
 * resize / disable caching without code changes.
 */
export interface CacheConfig {
  /** Master switch — when `false` the local fallback is fully bypassed. */
  enabled: boolean;
  /** Directory used to store cached mp3s, e.g. `./cache/music`. */
  dir: string;
  /** Soft cap (in bytes). Oldest files are evicted once we cross it. */
  maxSizeBytes: number;
  /** Files older than this are deleted on the next cleanup tick. */
  maxAgeMs: number;
  /** Background cleanup interval. */
  cleanupIntervalMs: number;
  /** Master switch for the local-download fallback path itself. */
  localFallbackEnabled: boolean;
  /** Whether the periodic cleanup should run at all. */
  autoCleanup: boolean;
  /** Minimum bytes a finished file must have to be considered valid. */
  minValidBytes: number;
}

const num = (v: string | undefined, fallback: number): number => {
  if (!v) return fallback;
  const parsed = Number(v);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const bool = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
};

export const cacheConfig: CacheConfig = {
  enabled: bool(process.env.MUSIC_CACHE_ENABLED, true),
  dir: process.env.MUSIC_CACHE_DIR
    ? resolve(process.cwd(), process.env.MUSIC_CACHE_DIR)
    : resolve(process.cwd(), 'cache', 'music'),
  // Default 1 GB — comfortably fits ~250 songs at ~4MB each.
  maxSizeBytes: num(process.env.MUSIC_CACHE_MAX_BYTES, 1024 * 1024 * 1024),
  // Default 7 days.
  maxAgeMs: num(process.env.MUSIC_CACHE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000),
  // Run every 30 minutes by default.
  cleanupIntervalMs: num(process.env.MUSIC_CACHE_CLEANUP_INTERVAL_MS, 30 * 60 * 1000),
  localFallbackEnabled: bool(process.env.MUSIC_LOCAL_FALLBACK_ENABLED, true),
  autoCleanup: bool(process.env.MUSIC_CACHE_AUTO_CLEANUP, true),
  // 64 KB — a successfully downloaded mp3 will always be much larger.
  minValidBytes: num(process.env.MUSIC_CACHE_MIN_VALID_BYTES, 64 * 1024),
};

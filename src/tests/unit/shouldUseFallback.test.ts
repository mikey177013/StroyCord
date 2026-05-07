import { shouldUseFallback } from 'src/core/playback/shouldUseFallback';
import { describe, expect, it } from 'vitest';

describe('shouldUseFallback', () => {
  it('returns true on YouTube anti-bot prompt with no audio streamed', () => {
    expect(
      shouldUseFallback({
        exitCode: 1,
        stderr: "ERROR: Sign in to confirm you're not a bot",
        bytesStreamed: 0,
      })
    ).toBe(true);
  });

  it('returns true on Video unavailable error', () => {
    expect(
      shouldUseFallback({
        exitCode: 1,
        stderr: 'ERROR: Video unavailable',
        bytesStreamed: 0,
      })
    ).toBe(true);
  });

  it('returns true on HTTP 429 rate limit', () => {
    expect(
      shouldUseFallback({
        exitCode: 1,
        stderr: 'ERROR: HTTP Error 429: Too Many Requests',
        bytesStreamed: 0,
      })
    ).toBe(true);
  });

  it('returns true on age-restricted video', () => {
    expect(
      shouldUseFallback({
        exitCode: 1,
        stderr: 'ERROR: Sign in to confirm your age. This video is age-restricted',
        bytesStreamed: 0,
      })
    ).toBe(true);
  });

  it('returns true for any non-zero exit with no audio streamed', () => {
    expect(
      shouldUseFallback({
        exitCode: 1,
        stderr: 'something exploded',
        bytesStreamed: 0,
      })
    ).toBe(true);
  });

  it('returns false when audio was successfully streamed despite stderr noise', () => {
    expect(
      shouldUseFallback({
        exitCode: 0,
        stderr: '',
        bytesStreamed: 1024 * 64,
      })
    ).toBe(false);
  });

  it('returns false when stderr has anti-bot text but audio kept flowing', () => {
    expect(
      shouldUseFallback({
        exitCode: 0,
        stderr: "Sign in to confirm you're not a bot",
        bytesStreamed: 1024 * 64,
      })
    ).toBe(false);
  });
});

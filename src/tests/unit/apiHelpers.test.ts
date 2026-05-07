import { fetchJsonWithRetry, fetchWithRetry, safeJsonParse } from 'src/core/playback/apiHelpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null on empty / whitespace input', () => {
    expect(safeJsonParse('')).toBeNull();
    expect(safeJsonParse('   ')).toBeNull();
    expect(safeJsonParse(null)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
  });

  it('returns null on malformed JSON without throwing', () => {
    expect(safeJsonParse('<html>nope</html>')).toBeNull();
    expect(safeJsonParse('{"a":')).toBeNull();
  });
});

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('returns body + status on a 200 OK first try', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"hello":"world"}',
    }) as unknown as typeof fetch;

    const result = await fetchWithRetry('https://example.test/json', { retries: 1 });
    expect(result).toEqual({ body: '{"hello":"world"}', status: 200 });
  });

  it('returns null after exhausting retries on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const promise = fetchWithRetry('https://example.test/json', { retries: 2, timeoutMs: 100 });
    // Advance through both retry backoffs.
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('does not retry deterministic 4xx (other than 429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchWithRetry('https://example.test/missing', { retries: 3 });
    expect(result?.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchJsonWithRetry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses JSON when status is OK', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"status":true,"result":{"mp3":"https://x/y.mp3"}}',
    }) as unknown as typeof fetch;

    const json = await fetchJsonWithRetry<{ status: boolean; result: { mp3: string } }>('https://example.test/api');
    expect(json?.result.mp3).toBe('https://x/y.mp3');
  });

  it('returns null when body is not JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>cf interstitial</html>',
    }) as unknown as typeof fetch;

    const json = await fetchJsonWithRetry('https://example.test/api');
    expect(json).toBeNull();
  });
});

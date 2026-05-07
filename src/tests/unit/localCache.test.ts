import { cacheFileFor, slugifyTitle } from 'src/core/playback/localCache';
import { describe, expect, it } from 'vitest';

describe('slugifyTitle', () => {
  it('lowercases and collapses whitespace into underscores', () => {
    expect(slugifyTitle('Imagine Dragons - Believer')).toBe('imagine_dragons_believer');
  });

  it('strips punctuation that would be unsafe on disk', () => {
    expect(slugifyTitle('Track / Name :: "weird"?!')).toBe('track_name_weird');
  });

  it('falls back to "track" when input is empty', () => {
    expect(slugifyTitle('')).toBe('track');
  });

  it('truncates very long titles', () => {
    const long = 'a'.repeat(500);
    expect(slugifyTitle(long).length).toBeLessThanOrEqual(80);
  });
});

describe('cacheFileFor', () => {
  it('uses the YouTube videoId when a URL is provided', () => {
    const path = cacheFileFor({ title: 'irrelevant', url: 'https://youtube.com/watch?v=kJQP7kiw5Fk' });
    expect(path.endsWith('kJQP7kiw5Fk.mp3')).toBe(true);
  });

  it('falls back to a slugified title when no URL is given', () => {
    const path = cacheFileFor({ title: 'Despacito Remix' });
    expect(path.endsWith('despacito_remix.mp3')).toBe(true);
  });
});

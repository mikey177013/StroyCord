// Use an isolated DB file for tests so we don't touch the bot's real data.db.
process.env.DATABASE_PATH = ':memory:';

import { db } from 'src/database/db';
import { emptyAllGuild, emptyNextSongs, removeCurrentPlayingSong } from 'src/database/queries/guilds/delete';
import { fetchGuild, getFirstSong, getLastPlayedSong, getNextSongs } from 'src/database/queries/guilds/get';
import { pushSongs, shiftSongs } from 'src/database/queries/guilds/update';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  db.prepare('DELETE FROM guilds').run();
});

const mockSong = (title: string) => ({
  title,
  url: `https://youtube.com/watch?v=${title}`,
  thumbnail: 'https://example.com/thumb.jpg',
  videoAuthor: 'Author',
  videoLength: '3:30',
  minutes: 3,
  seconds: 30,
  requestDateTimestamp: Date.now(),
  requestAuthor: { id: 'u1', username: 'test' },
  requestChannel: 'ch1',
  isQueueStart: true,
  isComingFromPlaylist: false,
});

const GUILD_ID = 'guild-123';

describe('fetchGuild', () => {
  it('creates a new guild row when none exists', async () => {
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.guildId).toBe(GUILD_ID);
    expect(guild.nextSongs).toEqual([]);
  });

  it('returns the existing guild when it already exists', async () => {
    await fetchGuild(GUILD_ID);
    const guild2 = await fetchGuild(GUILD_ID);
    expect(guild2.guildId).toBe(GUILD_ID);
    const row = db.prepare('SELECT COUNT(*) as c FROM guilds WHERE id = ?').get(GUILD_ID) as { c: number };
    expect(row.c).toBe(1);
  });

  it('throws when guildId is empty', async () => {
    await expect(fetchGuild('')).rejects.toThrow('GuildID not specified !');
  });
});

describe('pushSongs', () => {
  it('adds songs to the nextSongs queue', async () => {
    await fetchGuild(GUILD_ID);
    const songA = mockSong('songA');
    const songB = mockSong('songB');
    await pushSongs(GUILD_ID, [songA, songB]);
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toHaveLength(2);
    expect(guild.nextSongs[0].title).toBe('songA');
    expect(guild.nextSongs[1].title).toBe('songB');
  });

  it('appends to an existing queue', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('first')]);
    await pushSongs(GUILD_ID, [mockSong('second')]);
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toHaveLength(2);
  });
});

describe('getFirstSong', () => {
  it('returns undefined when the queue is empty', async () => {
    await fetchGuild(GUILD_ID);
    const first = await getFirstSong(GUILD_ID);
    expect(first).toBeUndefined();
  });

  it('returns the first song in the queue', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('alpha'), mockSong('beta')]);
    const first = await getFirstSong(GUILD_ID);
    expect(first?.title).toBe('alpha');
  });
});

describe('getNextSongs', () => {
  it('returns an empty array when queue has 0 or 1 song', async () => {
    await fetchGuild(GUILD_ID);
    const none = await getNextSongs(GUILD_ID);
    expect(none).toEqual([]);

    await pushSongs(GUILD_ID, [mockSong('only')]);
    const oneItem = await getNextSongs(GUILD_ID);
    expect(oneItem).toEqual([]);
  });

  it('returns all songs after the first', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('a'), mockSong('b'), mockSong('c')]);
    const next = await getNextSongs(GUILD_ID);
    expect(next).toHaveLength(2);
    expect(next[0].title).toBe('b');
    expect(next[1].title).toBe('c');
  });
});

describe('shiftSongs', () => {
  it('moves the first song to previouslyPlayedSongs and removes it from nextSongs', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('first'), mockSong('second')]);
    await shiftSongs(GUILD_ID);
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toHaveLength(1);
    expect(guild.nextSongs[0].title).toBe('second');
    expect(guild.previouslyPlayedSongs).toHaveLength(1);
    expect(guild.previouslyPlayedSongs[0].title).toBe('first');
  });

  it('empties nextSongs gracefully when queue is already empty', async () => {
    await fetchGuild(GUILD_ID);
    await expect(shiftSongs(GUILD_ID)).resolves.toBeUndefined();
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toEqual([]);
    expect(guild.previouslyPlayedSongs).toEqual([]);
  });
});

describe('emptyNextSongs', () => {
  it('clears all songs from the queue', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('x'), mockSong('y'), mockSong('z')]);
    await emptyNextSongs(GUILD_ID);
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toEqual([]);
  });
});

describe('removeCurrentPlayingSong', () => {
  it('removes the first song and adds it to history', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('current'), mockSong('next')]);
    await removeCurrentPlayingSong(GUILD_ID);
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toHaveLength(1);
    expect(guild.nextSongs[0].title).toBe('next');
    expect(guild.previouslyPlayedSongs).toHaveLength(1);
    expect(guild.previouslyPlayedSongs[0].title).toBe('current');
  });

  it('empties nextSongs gracefully when queue is already empty', async () => {
    await fetchGuild(GUILD_ID);
    await expect(removeCurrentPlayingSong(GUILD_ID)).resolves.toBeUndefined();
    const guild = await fetchGuild(GUILD_ID);
    expect(guild.nextSongs).toEqual([]);
  });
});

describe('getLastPlayedSong', () => {
  it('returns undefined when history is empty', async () => {
    await fetchGuild(GUILD_ID);
    const last = await getLastPlayedSong(GUILD_ID);
    expect(last).toBeUndefined();
  });

  it('returns the last song in previouslyPlayedSongs after a shift', async () => {
    await fetchGuild(GUILD_ID);
    await pushSongs(GUILD_ID, [mockSong('one'), mockSong('two')]);
    await shiftSongs(GUILD_ID);
    await shiftSongs(GUILD_ID);
    const last = await getLastPlayedSong(GUILD_ID);
    expect(last?.title).toBe('two');
  });
});

describe('emptyAllGuild', () => {
  it('empties nextSongs for all guilds', async () => {
    await fetchGuild('guild-A');
    await fetchGuild('guild-B');
    await pushSongs('guild-A', [mockSong('s1')]);
    await pushSongs('guild-B', [mockSong('s2')]);
    await emptyAllGuild();
    const guildA = await fetchGuild('guild-A');
    const guildB = await fetchGuild('guild-B');
    expect(guildA.nextSongs).toEqual([]);
    expect(guildB.nextSongs).toEqual([]);
  });
});

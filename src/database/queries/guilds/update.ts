import { db } from '../../db';
import type { Guild } from '../../schema/guild';
import { fetchGuild, getGuild } from './get';

const upsertStmt = db.prepare(
  `INSERT INTO guilds (id, data)
   VALUES (?, ?)
   ON CONFLICT(id) DO UPDATE SET data = excluded.data`
);

export const upsertGuild = (guild: Guild) => {
  upsertStmt.run(guild.guildId, JSON.stringify(guild));
};

export const updateGuild = (guild: Guild) => upsertGuild(guild);

export const pushSongs = async (guildId: string, data: object[]) => {
  const guild = await fetchGuild(guildId);
  guild.nextSongs = [...(guild.nextSongs ?? []), ...(data as Guild['nextSongs'])];
  upsertGuild(guild);
};

export const shiftSongs = async (guildId: string) => {
  const guild = await fetchGuild(guildId);

  if (!guild.nextSongs || guild.nextSongs.length === 0) {
    guild.nextSongs = [];
    upsertGuild(guild);
    return;
  }

  const [firstSong, ...rest] = guild.nextSongs;
  guild.nextSongs = rest;
  guild.previouslyPlayedSongs = [...(guild.previouslyPlayedSongs ?? []), firstSong];
  upsertGuild(guild);
};

export const updateVoiceChannel = async (guildId: string, data: object) => {
  const guild = await fetchGuild(guildId);
  guild.currentVoiceChannel = data as Guild['currentVoiceChannel'];
  upsertGuild(guild);
};

// Convenience helper — auto-create with sensible defaults.
export const getOrCreateGuild = async (guildId: string): Promise<Guild> => {
  const existing = getGuild(guildId);
  if (existing) return existing;
  return await fetchGuild(guildId);
};

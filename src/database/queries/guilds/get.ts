import { db } from '../../db';
import { createDefaultGuild, type Guild } from '../../schema/guild';
import { upsertGuild } from './update';

const selectStmt = db.prepare('SELECT data FROM guilds WHERE id = ?');

export const getGuild = (guildId: string): Guild | null => {
  const row = selectStmt.get(guildId) as { data: string } | undefined;
  if (!row) return null;

  try {
    return JSON.parse(row.data) as Guild;
  } catch {
    return null;
  }
};

export const fetchGuild = async (guildId: string): Promise<Guild> => {
  if (!guildId) throw new Error('GuildID not specified !');

  const existing = getGuild(guildId);
  if (existing) return existing;

  const fresh = createDefaultGuild(guildId);
  upsertGuild(fresh);
  return fresh;
};

export const getFirstSong = async (guildId: string) => {
  const guild = await fetchGuild(guildId);
  if (!guild.nextSongs || guild.nextSongs.length === 0) return undefined;
  return guild.nextSongs[0];
};

export const getNextSongs = async (guildId: string) => {
  const guild = await fetchGuild(guildId);
  if (!guild.nextSongs) return [];
  return guild.nextSongs.slice(1);
};

export const getLastPlayedSong = async (guildId: string) => {
  const guild = await fetchGuild(guildId);
  if (!guild.previouslyPlayedSongs || guild.previouslyPlayedSongs.length === 0) return undefined;
  return guild.previouslyPlayedSongs[guild.previouslyPlayedSongs.length - 1];
};

export const getCurrentVoiceChannel = async (guildId: string) => {
  const guild = await fetchGuild(guildId);
  return guild.currentVoiceChannel;
};

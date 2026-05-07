import { db } from '../../db';
import { fetchGuild } from './get';
import { upsertGuild } from './update';

const deleteStmt = db.prepare('DELETE FROM guilds WHERE id = ?');
const selectAllStmt = db.prepare('SELECT id, data FROM guilds');

export const deleteGuild = (guildId: string) => {
  deleteStmt.run(guildId);
};

export const emptyNextSongs = async (guildId: string) => {
  const guild = await fetchGuild(guildId);
  guild.nextSongs = [];
  upsertGuild(guild);
};

export const removeCurrentPlayingSong = async (guildId: string) => {
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

export const emptyAllGuild = async () => {
  try {
    const rows = selectAllStmt.all() as { id: string; data: string }[];
    for (const row of rows) {
      try {
        const guild = JSON.parse(row.data);
        guild.nextSongs = [];
        guild.currentVoiceChannel = null;
        upsertGuild(guild);
      } catch {
        // skip corrupted rows silently
      }
    }
    console.log('[db] all guilds emptied');
  } catch (error) {
    console.error('[db] error emptying all guilds:', error);
  }
};

export const removeGuild = async (guildId: string) => {
  deleteStmt.run(guildId);
};

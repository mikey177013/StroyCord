import { db } from './db';
import { emptyAllGuild } from './queries/guilds/delete';

export { db };

export const connectToDatabase = async () => {
  try {
    // On startup, wipe transient runtime state from every guild
    // (queues + current voice channel) since activePlayers is always empty
    // on a fresh start.
    await emptyAllGuild();
    console.log('[db] sqlite ready');
  } catch (error) {
    console.error('[db] error initializing database:', error);
    process.exit(1);
  }
};

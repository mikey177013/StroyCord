import type { Client } from 'discord.js';

export const setActivity = async (client: Client) => {
  if (!client.user || !client.application) {
    return;
  }

  const count = client.guilds.cache.size;
  return client.user.setActivity(`music in ${count} server${count > 1 ? 's' : ''}`);
};

import { Client, GatewayIntentBits } from 'discord.js';

import i18n from './config/i18n';
import { secrets } from './config/secrets';
import { initLocalCache } from './core/playback/localCache';
import { connectToDatabase } from './database/databaseConnect';
import errorListeners from './listeners/errorListeners';
import messageListener from './listeners/messageListener';
import ready from './listeners/ready';
import type { activePlayersInterface } from './utils/interfaces';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

export const activePlayers: activePlayersInterface = {};

const init = async () => {
  i18n.locale = secrets.LANGUAGE || 'en-US';

  ready(client);
  errorListeners(client);
  messageListener(client);

  initLocalCache();

  await connectToDatabase();

  client.login(secrets.DISCORD_TOKEN);
};

init();

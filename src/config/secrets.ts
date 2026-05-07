import dotenv from 'dotenv';

dotenv.config();

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  PREFIX = '&',
  SANO_LOGO = 'https://avatars.githubusercontent.com/u/201428450?v=4',
  LANGUAGE = 'en-US',
  DETECT_FROM_ALL_MESSAGES,
} = process.env;

if (!DISCORD_TOKEN) throw new Error('No token provided');
if (!DISCORD_CLIENT_ID) throw new Error('No client ID provided');
if (!PREFIX) throw new Error('No prefix provided');

export const secrets = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  PREFIX,
  SANO_LOGO,
  LANGUAGE,
  DETECT_FROM_ALL_MESSAGES: DETECT_FROM_ALL_MESSAGES === 'true',
};

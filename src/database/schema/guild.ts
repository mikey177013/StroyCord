import type { songInterface } from 'src/utils/interfaces';

export interface VoiceChannelData {
  channelId: string;
  guildId: string;
  // intentionally permissive — Discord's runtime objects (Guild, adapterCreator)
  // are stored verbatim and we never round-trip them through JSON safely
  // beyond { channelId, guildId }, which is all the player needs.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  [key: string]: any;
}

export interface Guild {
  guildId: string;
  registeredAt: number;
  currentVoiceChannel: VoiceChannelData | null;
  previouslyPlayedSongs: songInterface[];
  nextSongs: songInterface[];
}

export const createDefaultGuild = (guildId: string): Guild => ({
  guildId,
  registeredAt: Date.now(),
  currentVoiceChannel: null,
  previouslyPlayedSongs: [],
  nextSongs: [],
});

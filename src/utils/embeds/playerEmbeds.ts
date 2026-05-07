import { EmbedBuilder, type User } from 'discord.js';
import i18n from 'src/config/i18n';
import { secrets } from 'src/config/secrets';
import { getFirstSong, getLastPlayedSong } from 'src/database/queries/guilds/get';

import type { songInterface } from '../interfaces';

const AUTHOR_NAME = 'sano.senxpai';
const BRAND_COLOR = '#37123C';
const sanoLogo = secrets.SANO_LOGO;

export const pauseEmbed = (author: User) => {
  return new EmbedBuilder()
    .setTitle(`${author.username} ${i18n.t('embedsText.player.pause.title')}`)
    .setDescription(
      `${i18n.t('embedsText.global.youCanUse')} \`${secrets.PREFIX}re\` ${i18n.t('embedsText.player.pause.description')}`
    )
    .setAuthor({ name: AUTHOR_NAME, iconURL: sanoLogo })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const resumeEmbed = (author: User) => {
  return new EmbedBuilder()
    .setTitle(`${author.username} ${i18n.t('embedsText.player.resume.title')}`)
    .setDescription(
      `${i18n.t('embedsText.global.youCanUse')} \`${secrets.PREFIX}pa\` ${i18n.t('embedsText.player.resume.description')}`
    )
    .setAuthor({ name: AUTHOR_NAME, iconURL: sanoLogo })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const skipEmbed = async (author: User, guildId: string) => {
  const nextSong: songInterface | undefined = await getFirstSong(guildId);
  const lastSong: songInterface | undefined = await getLastPlayedSong(guildId);

  const embed = new EmbedBuilder()
    .setTitle(`${author.username} ${i18n.t('embedsText.player.skip.title')}`)
    .setDescription(
      `${i18n.t('embedsText.global.youCanUse')} \`${secrets.PREFIX}fo\` ${i18n.t('embedsText.player.skip.description')}`
    )
    .setAuthor({ name: AUTHOR_NAME, iconURL: sanoLogo })
    .setColor(BRAND_COLOR)
    .setTimestamp();

  if (nextSong) {
    embed.addFields(
      {
        name: i18n.t('embedsText.player.skip.fields.nowPlaying'),
        value: `${nextSong.title} — ${nextSong.videoAuthor}`,
        inline: true,
      },
      {
        name: i18n.t('embedsText.global.duration'),
        value: nextSong.videoLength,
        inline: true,
      }
    );
  }

  if (lastSong) {
    embed.addFields({
      name: i18n.t('embedsText.player.skip.fields.previouslyPlayed'),
      value: `${lastSong.title} — ${lastSong.videoAuthor}`,
    });
  }

  return embed;
};

export const removeEmbed = (author: User) => {
  return new EmbedBuilder()
    .setTitle(`${author.username} ${i18n.t('embedsText.player.remove.title')}`)
    .setDescription(
      `${i18n.t('embedsText.global.youCanUse')} \`${secrets.PREFIX}p [args]\` ${i18n.t('embedsText.global.toLaunchANewMusic')}`
    )
    .setAuthor({ name: AUTHOR_NAME, iconURL: sanoLogo })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

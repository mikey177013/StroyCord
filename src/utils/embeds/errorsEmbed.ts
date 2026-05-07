import { EmbedBuilder } from 'discord.js';
import i18n from 'src/config/i18n';
import { secrets } from 'src/config/secrets';

const AUTHOR_NAME = 'sano.senxpai';
const BRAND_COLOR = '#37123C';

export const noPresenceInVoiceChannelEmbed = (commandTried: string): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle(`${i18n.t('embedsText.errors.authorPresence.title')} ${commandTried}`)
    .setDescription(i18n.t('embedsText.errors.authorPresence.description'))
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const noMusicCurrentlyPlayingEmbed = (): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle(i18n.t('embedsText.errors.noMusicPlaying.title'))
    .setDescription(
      `${i18n.t('embedsText.global.youCanUse')} \`${secrets.PREFIX}p [args]\` ${i18n.t('embedsText.global.toLaunchANewMusic')}`
    )
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const missingRequiredArgument = (): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle(i18n.t('embedsText.errors.arguments.missing.title'))
    .setDescription(i18n.t('embedsText.errors.arguments.missing.description'))
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const unreconizedArgumentEmbed = (): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle(i18n.t('embedsText.errors.arguments.unknown.title'))
    .setDescription(i18n.t('embedsText.errors.arguments.unknown.description'))
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const unknownRequestEmbed = (): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle(i18n.t('embedsText.errors.request.title'))
    .setDescription(i18n.t('embedsText.errors.request.description'))
    .addFields(
      { name: i18n.t('embedsText.errors.request.fields.usableCommands'), value: '\u200B' },
      { name: 'play', value: `${secrets.PREFIX}p [url/${i18n.t('global.search')}]`, inline: true },
      { name: 'redo', value: `${secrets.PREFIX}redo`, inline: true },
      { name: 'skip', value: `${secrets.PREFIX}s`, inline: true },
      { name: 'stop', value: `${secrets.PREFIX}fo`, inline: true },
      { name: 'pause', value: `${secrets.PREFIX}pa`, inline: true },
      { name: 'resume', value: `${secrets.PREFIX}re`, inline: true },
      { name: 'queue', value: `${secrets.PREFIX}q`, inline: true },
      { name: 'current', value: `${secrets.PREFIX}c`, inline: true }
    )
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

export const unknownError = (errorMsg: string): EmbedBuilder => {
  return new EmbedBuilder()
    .setTitle(i18n.t('embedsText.errors.unknown.title'))
    .setDescription(errorMsg)
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setTimestamp();
};

import { EmbedBuilder } from 'discord.js';
import { client } from 'src/Bot';
import i18n from 'src/config/i18n';
import { secrets } from 'src/config/secrets';

import type { embedChecksInterface, songInterface } from '../interfaces';

const AUTHOR_NAME = 'sano.senxpai';
const FOOTER_NAME = 'sano.music';
const BRAND_COLOR = '#37123C';
const ACCENT_COLOR = '#C4302B';
const sanoLogo = secrets.SANO_LOGO;

export const nowPlayingEmbed = (song: songInterface): EmbedBuilder => {
  const { author, noAuthorEmbed } = embedChecks(song.requestAuthor.id);

  if (author === undefined) return noAuthorEmbed;

  return new EmbedBuilder()
    .setTitle(i18n.t('embedsText.song.nowPlaying.title'))
    .setAuthor({ name: AUTHOR_NAME, iconURL: sanoLogo })
    .setColor(BRAND_COLOR)
    .setFooter({ text: FOOTER_NAME, iconURL: sanoLogo })
    .setThumbnail(song.thumbnail)
    .setTimestamp()
    .setURL(song.url)
    .addFields(
      {
        name: song.title,
        value: `${i18n.t('embedsText.global.duration')}: ${song.videoLength}`,
      },
      {
        name: i18n.t('embedsText.global.asked'),
        value: author.username,
      }
    );
};

export const newSongEmbed = (song: songInterface): EmbedBuilder => {
  const { author, iconURL, noAuthorEmbed } = embedChecks(song.requestAuthor.id);

  if (author === undefined) return noAuthorEmbed;

  return new EmbedBuilder()
    .setTitle(song.title)
    .setAuthor({ name: author.username, iconURL })
    .setColor(ACCENT_COLOR)
    .setFooter({ text: FOOTER_NAME, iconURL: sanoLogo })
    .setThumbnail(song.thumbnail)
    .setTimestamp()
    .setURL(song.url)
    .addFields(
      {
        name: `${author.username} ${i18n.t('embedsText.song.newSong.title')}`,
        value: song.title,
      },
      {
        name: i18n.t('embedsText.global.from'),
        value: song.videoAuthor,
        inline: true,
      },
      {
        name: i18n.t('embedsText.global.findWith'),
        value: `${secrets.PREFIX}p ${song.url}`,
        inline: true,
      },
      {
        name: i18n.t('embedsText.global.duration'),
        value: song.videoLength,
      }
    );
};

export const addSongEmbed = (song: songInterface): EmbedBuilder => {
  const { author, iconURL, noAuthorEmbed } = embedChecks(song.requestAuthor.id);

  if (author === undefined) return noAuthorEmbed;

  return new EmbedBuilder()
    .setTitle(`${author.username} ${i18n.t('embedsText.song.addSong.title')}`)
    .setAuthor({ name: author.username, iconURL })
    .setColor(ACCENT_COLOR)
    .setFooter({ text: FOOTER_NAME, iconURL: sanoLogo })
    .setThumbnail(song.thumbnail)
    .setTimestamp()
    .setURL(song.url)
    .addFields(
      { name: song.title, value: '\u200B' },
      {
        name: i18n.t('embedsText.global.from'),
        value: song.videoAuthor,
        inline: true,
      },
      {
        name: i18n.t('embedsText.global.findWith'),
        value: `${secrets.PREFIX}p ${song.url}`,
        inline: true,
      },
      {
        name: i18n.t('embedsText.global.duration'),
        value: song.videoLength,
      }
    );
};

const embedChecks = (requestAuthorId: string): embedChecksInterface => {
  const author = client.users.cache.get(requestAuthorId) || undefined;

  const noAuthorEmbed = new EmbedBuilder()
    .setTitle(i18n.t('embedsText.song.generic.title'))
    .setDescription(i18n.t('embedsText.song.generic.description'))
    .setAuthor({ name: AUTHOR_NAME, iconURL: sanoLogo })
    .setColor(BRAND_COLOR)
    .setTimestamp();

  const iconURL = author?.avatarURL() || sanoLogo;

  return {
    noAuthorEmbed,
    author,
    iconURL,
  };
};

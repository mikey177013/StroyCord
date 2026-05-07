import { EmbedBuilder, type User } from 'discord.js';
import i18n from 'src/config/i18n';
import { secrets } from 'src/config/secrets';

import type { PlaylistInfo, songInterface } from '../interfaces';

const AUTHOR_NAME = 'sano.senxpai';
const FOOTER_NAME = 'sano.music';
const BRAND_COLOR = '#37123C';
const ACCENT_COLOR = '#C4302B';

export const queueEmbed = async (nextSongs: songInterface[]): Promise<EmbedBuilder> => {
  if (nextSongs.length === 0)
    return new EmbedBuilder()
      .setTitle(i18n.t('embedsText.lists.emptyQueue.title'))
      .setDescription(
        `${i18n.t('embedsText.global.youCanUse')} \`${secrets.PREFIX}p [args]\` ${i18n.t('embedsText.global.toLaunchANewMusic')}`
      )
      .setAuthor({
        name: AUTHOR_NAME,
        iconURL: secrets.SANO_LOGO,
      })
      .setColor(BRAND_COLOR)
      .setTimestamp();

  const tabEmbeds: { name: string; value: string }[] = [];

  nextSongs.forEach((song, index) => {
    if (index > 10) return;
    if (index === 10) {
      tabEmbeds.push({ name: '...', value: '\u200B' });
    } else {
      tabEmbeds.push({
        name: `${index + 1} — ${song.title}`,
        value: `${song.videoAuthor} • ${song.videoLength}`,
      });
    }
  });

  return new EmbedBuilder()
    .setTitle(`${i18n.t('embedsText.global.youHave')} ${nextSongs.length} ${i18n.t('embedsText.lists.queue.title')}`)
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setColor(BRAND_COLOR)
    .setFooter({
      text: FOOTER_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setTimestamp()
    .addFields(tabEmbeds);
};

export const playlistEmbed = async (author: User, playlistData: PlaylistInfo): Promise<EmbedBuilder> => {
  const msg = new EmbedBuilder()
    .setTitle(`${author.username} ${i18n.t('embedsText.lists.playlist.title')}`)
    .setAuthor({
      name: AUTHOR_NAME,
      iconURL: author.avatarURL() || secrets.SANO_LOGO,
    })
    .setColor(ACCENT_COLOR)
    .setFooter({
      text: FOOTER_NAME,
      iconURL: secrets.SANO_LOGO,
    })
    .setTimestamp()
    .setURL(playlistData.url || 'https://www.youtube.com/')
    .addFields(
      {
        name: i18n.t('embedsText.global.findWith'),
        value: `${secrets.PREFIX}p ${playlistData.url}`,
      },
      {
        name: i18n.t('embedsText.lists.playlist.fields.playListName'),
        value: playlistData.title || '—',
        inline: true,
      },
      {
        name: i18n.t('embedsText.lists.playlist.fields.playlistCreatedBy'),
        value: playlistData.author?.name || '—',
        inline: true,
      },
      {
        name: i18n.t('embedsText.lists.playlist.fields.putInQueue'),
        value: `${playlistData.items.length > 30 ? 30 : playlistData.items.length} ${i18n.t('embedsText.global.musics')}`,
      }
    );

  if (playlistData.items.length > 0 && playlistData.items[0].thumbnail) {
    msg.setThumbnail(playlistData.items[0].thumbnail);
  }

  return msg;
};

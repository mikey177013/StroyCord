import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  joinVoiceChannel,
  StreamType,
} from '@discordjs/voice';
import { activePlayers, client } from 'src/Bot';
import { sendErrorEmbed } from 'src/core/messages';
import { createFallbackApiStream } from 'src/core/playback/fallbackStream';
import { shouldUseFallback } from 'src/core/playback/shouldUseFallback';
import { createYtdlpStream } from 'src/core/playback/ytdlpStream';
import { emptyNextSongs, removeCurrentPlayingSong } from 'src/database/queries/guilds/delete';
import { getCurrentVoiceChannel, getFirstSong, getNextSongs } from 'src/database/queries/guilds/get';
import { shiftSongs } from 'src/database/queries/guilds/update';
import {
  createAudioPlayerListener,
  removeAllAudioPlayerListener,
  voiceConnectionErrorListener,
} from 'src/listeners/playerListeners';
import type { songInterface } from 'src/utils/interfaces';

/**
 * Run the primary yt-dlp pipeline for a single track.
 *
 * Returns:
 *   - { stream }                 → caller should pipe this into discord
 *   - { needsFallback: true, … } → yt-dlp failed in a way that warrants the
 *                                  external-API fallback
 *   - { fatal: true, … }         → unrecoverable spawn-level failure
 */
function runYtdlp(
  url: string
): Promise<
  | { stream: Readable; child: ChildProcessWithoutNullStreams }
  | { needsFallback: true; reason: string }
  | { fatal: true; reason: string }
> {
  return new Promise((resolveOnce) => {
    let settled = false;
    let stderrBuf = '';
    let bytesStreamed = 0;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = createYtdlpStream(url);
    } catch (e) {
      resolveOnce({ fatal: true, reason: `yt-dlp spawn threw: ${(e as Error).message}` });
      return;
    }

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    // First chunk of audio bytes = success — hand the stream to Discord.
    const onFirstByte = (chunk: Buffer) => {
      bytesStreamed += chunk.length;
      if (settled) return;
      // Need at least a small payload before we trust the stream — single
      // 0-byte reads or tiny error blobs would otherwise look successful.
      if (bytesStreamed < 256) return;

      settled = true;
      child.stdout.off('data', onFirstByte);
      // Re-attach a counter that doesn't gate the resolution.
      child.stdout.on('data', (c: Buffer) => {
        bytesStreamed += c.length;
      });
      resolveOnce({ stream: child.stdout, child });
    };
    child.stdout.on('data', onFirstByte);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolveOnce({ fatal: true, reason: `yt-dlp spawn error: ${e.message}` });
    });

    child.on('close', (code) => {
      const trimmed = stderrBuf.trim();
      if (trimmed) console.error(`[player] yt-dlp stderr: ${trimmed}`);

      if (settled) {
        // Stream already handed off — nothing to do here. Errors after the
        // fact get reported via the audio-player error listener.
        return;
      }

      settled = true;
      const useFallback = shouldUseFallback({ exitCode: code, stderr: trimmed, bytesStreamed });
      if (useFallback) {
        resolveOnce({ needsFallback: true, reason: trimmed || `yt-dlp exited ${code}` });
        return;
      }
      resolveOnce({
        fatal: true,
        reason: trimmed
          ? `yt-dlp failed: ${trimmed.split('\n').slice(-1)[0]}`
          : `yt-dlp exited ${code} before delivering audio`,
      });
    });
  });
}

/**
 * Try the external-API fallback for a song. The API takes either a YouTube
 * URL or a free-text query — we pass the title first (it's the most
 * forgiving), and only fall back to the URL if that yields nothing.
 */
async function runFallback(song: songInterface): Promise<Readable | null> {
  console.log('[player] using fallback API for:', song.title);

  // Title first — this is what the API was designed for.
  if (song.title && song.title.trim() !== '') {
    const result = await createFallbackApiStream(song.title);
    if (result) {
      console.log('[player] fallback stream started (via title):', result.title ?? song.title);
      return result.stream;
    }
  }

  // URL as a last resort.
  const result = await createFallbackApiStream(song.url);
  if (result) {
    console.log('[player] fallback stream started (via url):', result.title ?? song.url);
    return result.stream;
  }

  return null;
}

export const songPlayer = async (guildId: string) => {
  const voiceChannel = await getCurrentVoiceChannel(guildId);
  const nextSong: songInterface = await getFirstSong(guildId);

  if (nextSong === undefined) {
    return;
  }
  if (!voiceChannel) {
    console.error('[player] no voice channel stored for guild', guildId);
    return;
  }

  const adapterCreator = (await client.guilds.fetch(voiceChannel.guildId)).voiceAdapterCreator;
  let audioPlayer = activePlayers[guildId]?.audioPlayer;

  const connection = joinVoiceChannel({
    channelId: voiceChannel.channelId,
    guildId: voiceChannel.guildId,
    adapterCreator,
  });

  if (!audioPlayer) {
    audioPlayer = createAudioPlayer();
    activePlayers[guildId] = { audioPlayer };
    createAudioPlayerListener(audioPlayer, guildId);
  }

  // ─── Primary: yt-dlp ──────────────────────────────────────────────────
  console.log(`[player] streaming ${nextSong.url} via yt-dlp`);
  let outcome: Awaited<ReturnType<typeof runYtdlp>>;
  try {
    outcome = await runYtdlp(nextSong.url);
  } catch (e) {
    console.error('[player] runYtdlp threw:', e);
    outcome = { needsFallback: true, reason: (e as Error).message };
  }

  let resourceStream: Readable | null = null;
  let usedFallback = false;

  if ('stream' in outcome) {
    resourceStream = outcome.stream;
  } else if ('needsFallback' in outcome) {
    console.error('[player] yt-dlp failed:', outcome.reason);
    try {
      resourceStream = await runFallback(nextSong);
      usedFallback = resourceStream !== null;
    } catch (e) {
      console.error('[player] fallback threw:', e);
      resourceStream = null;
    }
  } else {
    // fatal — try fallback once anyway, never crash the bot.
    console.error('[player] yt-dlp fatal:', outcome.reason);
    try {
      resourceStream = await runFallback(nextSong);
      usedFallback = resourceStream !== null;
    } catch (e) {
      console.error('[player] fallback threw:', e);
      resourceStream = null;
    }
  }

  if (!resourceStream) {
    await sendErrorEmbed(
      guildId,
      nextSong.requestChannel,
      `Could not play **${nextSong.title}** — both yt-dlp and the fallback failed.`
    );
    // Move on to the next song so the queue doesn't get stuck.
    try {
      await skipSong(guildId);
    } catch (e) {
      console.error('[player] skip-after-failure error:', e);
    }
    return;
  }

  if (usedFallback) {
    console.log(`[player] fallback stream started for: ${nextSong.title}`);
  }

  const audioStream = createAudioResource(resourceStream, {
    inputType: StreamType.Arbitrary,
  });

  audioPlayer.play(audioStream);
  connection.subscribe(audioPlayer);

  voiceConnectionErrorListener(guildId);
};

export const skipSong = async (guildId: string) => {
  const hasFollowingSong: songInterface[] = await getNextSongs(guildId);

  if (hasFollowingSong.length === 0) {
    remove(guildId, true);
    return;
  }

  await shiftSongs(guildId);
  await songPlayer(guildId);
};

export const remove = async (guildId: string, isFromSkip: boolean = false) => {
  if (isFromSkip) {
    await removeCurrentPlayingSong(guildId);
  } else {
    await emptyNextSongs(guildId);
  }

  if (activePlayers[guildId]?.audioPlayer) {
    removeAllAudioPlayerListener(activePlayers[guildId].audioPlayer);
    activePlayers[guildId].audioPlayer.stop();
    delete activePlayers[guildId];
  }

  getVoiceConnection(guildId)?.disconnect();
  getVoiceConnection(guildId)?.destroy();
  getVoiceConnection(guildId)?.removeAllListeners();
  return;
};

export const pause = async (guildId: string) => {
  if (!activePlayers[guildId]) return;
  if (activePlayers[guildId].audioPlayer.state.status !== AudioPlayerStatus.Playing) return;

  activePlayers[guildId].audioPlayer.pause();
};

export const resume = async (guildId: string) => {
  if (!activePlayers[guildId]) return;
  if (activePlayers[guildId].audioPlayer.state.status !== AudioPlayerStatus.Paused) return;

  activePlayers[guildId].audioPlayer.unpause();
};

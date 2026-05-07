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
import { downloadToCache, findCachedTrack, openCachedStream } from 'src/core/playback/localCache';
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
        // Stream already handed off — log EOF for clarity.
        console.log('[player] stream ended');
        return;
      }

      settled = true;
      console.error('[player] yt-dlp failed');
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
 * URL or a free-text query — we always pass the *title* (the API was
 * designed for free-text search). Never use the raw URL as a query, that
 * was the source of the "youtube.com" bug.
 */
async function runFallback(song: songInterface): Promise<Readable | null> {
  const query = (song.title ?? '').trim();
  if (!query) {
    console.error('[player] cannot run fallback — song has no title');
    return null;
  }

  const result = await createFallbackApiStream(query);
  if (result) {
    console.log('[player] fallback stream started:', result.title ?? query);
    return result.stream;
  }
  return null;
}

/**
 * Last-resort path: download the audio with yt-dlp into the local cache and
 * stream it from disk. Slower than the live pipeline but works even when
 * Discord-friendly streaming is impossible (anti-bot, expired cookies, etc.).
 */
async function runLocalCacheFallback(song: songInterface): Promise<Readable | null> {
  console.log('[player] local fallback started');
  const path = await downloadToCache(song.url, { title: song.title, url: song.url });
  if (!path) return null;
  return openCachedStream(path);
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

  // ─── 1. Cached mp3 (fastest, zero network) ────────────────────────────
  let resourceStream: Readable | null = null;
  try {
    const cached = await findCachedTrack({ title: nextSong.title, url: nextSong.url });
    if (cached) {
      resourceStream = openCachedStream(cached);
    }
  } catch (e) {
    console.error('[player] cache lookup failed:', e);
  }

  // ─── 2. yt-dlp live stream ────────────────────────────────────────────
  if (!resourceStream) {
    console.log(`[player] streaming ${nextSong.url} via yt-dlp`);
    let outcome: Awaited<ReturnType<typeof runYtdlp>>;
    try {
      outcome = await runYtdlp(nextSong.url);
    } catch (e) {
      console.error('[player] runYtdlp threw:', e);
      outcome = { needsFallback: true, reason: (e as Error).message };
    }

    if ('stream' in outcome) {
      resourceStream = outcome.stream;
    } else if ('needsFallback' in outcome) {
      console.error('[player] yt-dlp failed:', outcome.reason);
    } else {
      console.error('[player] yt-dlp fatal:', outcome.reason);
    }
  }

  // ─── 3. Fallback API (faa.my.id) ──────────────────────────────────────
  if (!resourceStream) {
    try {
      resourceStream = await runFallback(nextSong);
    } catch (e) {
      console.error('[player] fallback API threw:', e);
    }
  }

  // ─── 4. Local scrape/download ─────────────────────────────────────────
  if (!resourceStream) {
    try {
      resourceStream = await runLocalCacheFallback(nextSong);
    } catch (e) {
      console.error('[player] local fallback threw:', e);
    }
  }

  // ─── 5. Give up — skip the broken song, keep the queue alive ──────────
  if (!resourceStream) {
    console.error('[player] skipping broken song:', nextSong.title);
    await sendErrorEmbed(
      guildId,
      nextSong.requestChannel,
      `Could not play **${nextSong.title}** — every playback path failed.`
    ).catch((e) => console.error('[player] sendErrorEmbed error:', e));

    try {
      await skipSong(guildId);
    } catch (e) {
      console.error('[player] skip-after-failure error:', e);
    }
    return;
  }

  // Defensive: if the stream is destroyed before we wrap it, bail out.
  if ('destroyed' in resourceStream && (resourceStream as Readable).destroyed) {
    console.error('[player] resource stream was destroyed before playback');
    try {
      await skipSong(guildId);
    } catch (e) {
      console.error('[player] skip-after-destroyed error:', e);
    }
    return;
  }

  let audioStream: ReturnType<typeof createAudioResource>;
  try {
    audioStream = createAudioResource(resourceStream, {
      inputType: StreamType.Arbitrary,
    });
  } catch (e) {
    console.error('[player] createAudioResource failed — skipping broken song:', e);
    try {
      await skipSong(guildId);
    } catch (err) {
      console.error('[player] skip-after-resource-error:', err);
    }
    return;
  }

  // Surface late stream errors instead of crashing the process.
  resourceStream.on('error', (err) => {
    console.error('[player] resource stream error:', err);
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

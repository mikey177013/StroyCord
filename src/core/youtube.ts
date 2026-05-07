import { Innertube } from 'youtubei.js';

export let youtubeClient!: Innertube;

export async function initYoutubeClient(): Promise<void> {
  youtubeClient = await Innertube.create({ retrieve_player: true });
  console.log('[youtube] client ready');
}

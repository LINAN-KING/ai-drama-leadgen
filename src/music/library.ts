import { createRandom } from "../generation/random.js";

export interface MusicTrack {
  id: string;
  path: string;
  title: string;
  instrumental: boolean;
  mood: string[];
  bpm: number;
  license: { name: string; url: string; commercialUse: boolean; snapshotText: string };
}

export function selectMusicRotation(
  tracks: MusicTrack[],
  mood: string,
  seed: number,
  count = 5,
): MusicTrack[] {
  const eligible = tracks.filter(
    (track) =>
      track.instrumental &&
      track.license.commercialUse &&
      Boolean(track.license.url) &&
      Boolean(track.license.snapshotText),
  );
  const preferred = eligible.filter((track) => track.mood.includes(mood));
  const pool = preferred.length >= 3 ? preferred : eligible;
  return createRandom(seed)
    .shuffle(pool)
    .slice(0, Math.min(Math.max(count, 3), 5));
}

export function rotateMusic(tracks: MusicTrack[], videoIndex: number): MusicTrack {
  if (!tracks.length) throw new Error("No licensed instrumental music is available");
  return tracks[videoIndex % tracks.length] as MusicTrack;
}

import { fetchJson } from "../media-providers/http.js";

export interface SoundEffect {
  id: number;
  name: string;
  sourceUrl: string;
  previewUrl: string;
  duration: number;
  license: "CC0" | "CC BY";
  author: string;
}

interface FreesoundResult {
  id: number;
  name: string;
  url: string;
  username: string;
  duration: number;
  license: string;
  previews: { "preview-hq-mp3"?: string; "preview-lq-mp3"?: string };
}

export class FreesoundProvider {
  constructor(private readonly apiKey = process.env.FREESOUND_API_KEY) {}
  async search(query: string, limit = 30, signal?: AbortSignal): Promise<SoundEffect[]> {
    if (!this.apiKey) return [];
    const url = new URL("https://freesound.org/apiv2/search/text/");
    url.search = new URLSearchParams({
      query,
      token: this.apiKey,
      page_size: String(Math.min(limit, 150)),
      fields: "id,name,url,username,duration,license,previews",
    }).toString();
    const result = await fetchJson<{ results: FreesoundResult[] }>(url, {}, signal);
    return result.results.flatMap((sound) => {
      const license = sound.license.includes("zero")
        ? "CC0"
        : sound.license.includes("by/4.0") || sound.license.includes("by/3.0")
          ? "CC BY"
          : null;
      const preview = sound.previews["preview-hq-mp3"] ?? sound.previews["preview-lq-mp3"];
      return license && preview
        ? [
            {
              id: sound.id,
              name: sound.name,
              sourceUrl: sound.url,
              previewUrl: preview,
              duration: sound.duration,
              license,
              author: sound.username,
            },
          ]
        : [];
    });
  }
}

export function selectSoundEffects(effects: SoundEffect[], seed: number, count = 6): SoundEffect[] {
  if (count < 5 || count > 8) throw new RangeError("Sound effect count must be 5-8");
  const eligible = effects.filter(
    (effect) => effect.license === "CC0" || effect.license === "CC BY",
  );
  return createSeededOrder(eligible, seed).slice(0, count);
}

function createSeededOrder<T>(items: T[], seed: number): T[] {
  return [...items]
    .map((item, index) => ({ item, score: Math.sin(seed + index * 9_973) }))
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);
}

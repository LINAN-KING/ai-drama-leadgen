import { fetchJson } from "./http.js";
import type { LicenseEvidence, MediaCandidate, MediaProvider, SearchRequest } from "./types.js";

interface PixabayImage {
  id: number;
  pageURL: string;
  user: string;
  imageWidth: number;
  imageHeight: number;
  previewURL: string;
  largeImageURL: string;
}
interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
}
interface PixabayVideo {
  id: number;
  pageURL: string;
  user: string;
  duration: number;
  picture_id: string;
  videos: Record<string, PixabayVideoFile>;
}

function licenseEvidence(): LicenseEvidence {
  return {
    name: "Pixabay Content License",
    url: "https://pixabay.com/service/license-summary/",
    commercialUse: true,
    attributionRequired: false,
    snapshotText:
      "Royalty-free content may be used and adapted, subject to prohibited-use, trademark, endorsement, and standalone distribution restrictions.",
    capturedAt: new Date().toISOString(),
  };
}

export class PixabayProvider implements MediaProvider {
  readonly id = "pixabay";
  readonly tier = "free" as const;
  constructor(private readonly apiKey = process.env.PIXABAY_API_KEY) {}
  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]> {
    if (!this.apiKey) return [];
    const url = new URL(
      request.kind === "image" ? "https://pixabay.com/api/" : "https://pixabay.com/api/videos/",
    );
    const orientation =
      request.orientation === "portrait"
        ? "vertical"
        : request.orientation === "landscape"
          ? "horizontal"
          : "all";
    url.search = new URLSearchParams({
      key: this.apiKey,
      q: request.query.slice(0, 100),
      lang: "zh",
      orientation,
      per_page: String(Math.min(Math.max(request.limit, 3), 200)),
      safesearch: "true",
    }).toString();
    if (request.kind === "image") {
      const result = await fetchJson<{ hits: PixabayImage[] }>(url, {}, signal);
      return result.hits.map((image) => ({
        id: `pixabay-image-${image.id}`,
        provider: this.id,
        tier: this.tier,
        kind: "image",
        previewUrl: image.previewURL,
        sourceUrl: image.pageURL,
        downloadUrl: image.largeImageURL,
        author: image.user,
        width: image.imageWidth,
        height: image.imageHeight,
        watermarked: false,
        motionScore: 0,
        semanticScore: 0.6,
        compositionScore: 0.6,
        styleScore: 0.6,
        license: licenseEvidence(),
      }));
    }
    const result = await fetchJson<{ hits: PixabayVideo[] }>(url, {}, signal);
    return result.hits.flatMap((video) => {
      const file = Object.values(video.videos)
        .filter((item) => item.url && item.width && item.height)
        .sort((left, right) => right.width * right.height - left.width * left.height)[0];
      return file
        ? [
            {
              id: `pixabay-video-${video.id}`,
              provider: this.id,
              tier: this.tier,
              kind: "video" as const,
              previewUrl: `https://i.vimeocdn.com/video/${video.picture_id}_640x360.jpg`,
              sourceUrl: video.pageURL,
              downloadUrl: file.url,
              author: video.user,
              width: file.width,
              height: file.height,
              durationSeconds: video.duration,
              watermarked: false,
              motionScore: 0.65,
              semanticScore: 0.6,
              compositionScore: 0.6,
              styleScore: 0.6,
              license: licenseEvidence(),
            },
          ]
        : [];
    });
  }
}

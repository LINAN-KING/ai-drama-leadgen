import { fetchJson } from "./http.js";
import type { LicenseEvidence, MediaCandidate, MediaProvider, SearchRequest } from "./types.js";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: { original: string; large: string; medium: string };
}
interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}
interface PexelsVideo {
  id: number;
  duration: number;
  url: string;
  user: { name: string };
  image: string;
  video_files: PexelsVideoFile[];
}

function licenseEvidence(): LicenseEvidence {
  return {
    name: "Pexels License",
    url: "https://www.pexels.com/license/",
    commercialUse: true,
    attributionRequired: false,
    snapshotText:
      "Free to use and modify, including ads and marketing; no endorsement, unaltered resale, or stock redistribution.",
    capturedAt: new Date().toISOString(),
  };
}

function baseCandidate(id: number, request: SearchRequest) {
  return {
    id: `pexels-${request.kind}-${id}`,
    provider: "pexels",
    tier: "free" as const,
    kind: request.kind,
    watermarked: false,
    motionScore: request.kind === "video" ? 0.65 : 0,
    semanticScore: 0.6,
    compositionScore: 0.6,
    styleScore: 0.6,
    license: licenseEvidence(),
  };
}

export class PexelsProvider implements MediaProvider {
  readonly id = "pexels";
  readonly tier = "free" as const;
  constructor(private readonly apiKey = process.env.PEXELS_API_KEY) {}
  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]> {
    if (!this.apiKey) return [];
    if (request.kind === "image") {
      const url = new URL("https://api.pexels.com/v1/search");
      url.search = new URLSearchParams({
        query: request.query,
        orientation: request.orientation,
        per_page: String(Math.min(request.limit, 80)),
        locale: "zh-CN",
      }).toString();
      const result = await fetchJson<{ photos: PexelsPhoto[] }>(
        url,
        { headers: { Authorization: this.apiKey } },
        signal,
      );
      return result.photos.map((photo) => ({
        ...baseCandidate(photo.id, request),
        previewUrl: photo.src.medium,
        sourceUrl: photo.url,
        downloadUrl: photo.src.original,
        author: photo.photographer,
        width: photo.width,
        height: photo.height,
      }));
    }
    const url = new URL("https://api.pexels.com/v1/videos/search");
    url.search = new URLSearchParams({
      query: request.query,
      orientation: request.orientation,
      per_page: String(Math.min(request.limit, 80)),
      locale: "zh-CN",
    }).toString();
    const result = await fetchJson<{ videos: PexelsVideo[] }>(
      url,
      { headers: { Authorization: this.apiKey } },
      signal,
    );
    return result.videos.flatMap((video) => {
      const file = video.video_files
        .filter((item) => item.file_type === "video/mp4" && item.width && item.height)
        .sort((left, right) => right.width * right.height - left.width * left.height)[0];
      return file
        ? [
            {
              ...baseCandidate(video.id, request),
              previewUrl: video.image,
              sourceUrl: video.url,
              downloadUrl: file.link,
              author: video.user.name,
              width: file.width,
              height: file.height,
              durationSeconds: video.duration,
            },
          ]
        : [];
    });
  }
}

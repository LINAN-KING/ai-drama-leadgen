import { fetchJson } from "./http.js";
import { openLicenseEvidence } from "./open-license.js";
import type { MediaCandidate, MediaProvider, SearchRequest } from "./types.js";

interface SmithsonianResource {
  label?: string;
  url?: string;
  width?: number;
  height?: number;
}
interface SmithsonianMedia {
  id?: string;
  type?: string;
  content?: string;
  thumbnail?: string;
  usage?: { access?: string };
  resources?: SmithsonianResource[];
}
interface SmithsonianRow {
  id: string;
  title: string;
  content?: {
    freetext?: { name?: Array<{ label?: string; content?: string }> };
    descriptiveNonRepeating?: {
      record_link?: string;
      data_source?: string;
      online_media?: { media?: SmithsonianMedia[] };
    };
  };
}

export class SmithsonianProvider implements MediaProvider {
  readonly id = "smithsonian";
  readonly tier = "open" as const;
  constructor(private readonly apiKey = process.env.SMITHSONIAN_API_KEY) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]> {
    if (!this.apiKey) return [];
    const url = new URL("https://api.si.edu/openaccess/api/v1.0/search");
    url.search = new URLSearchParams({
      q: `${request.query} AND online_media_type:Images`,
      api_key: this.apiKey,
      rows: String(Math.min(request.limit, 100)),
    }).toString();
    const result = await fetchJson<{ response?: { rows?: SmithsonianRow[] } }>(url, {}, signal);
    return (result.response?.rows ?? []).flatMap((row) => {
      const details = row.content?.descriptiveNonRepeating;
      const names = row.content?.freetext?.name ?? [];
      const author = names.find(({ label }) =>
        /artist|maker|creator|photographer/i.test(label ?? ""),
      )?.content;
      return (details?.online_media?.media ?? []).flatMap((media, mediaIndex) => {
        if (media.type !== "Images" || media.usage?.access !== "CC0") return [];
        const resource = (media.resources ?? [])
          .filter((item) => /jpeg/i.test(item.label ?? "") && item.url && item.width && item.height)
          .sort(
            (left, right) =>
              (right.width ?? 0) * (right.height ?? 0) - (left.width ?? 0) * (left.height ?? 0),
          )[0];
        const evidence = openLicenseEvidence(
          "https://creativecommons.org/publicdomain/zero/1.0/",
          "The Smithsonian API marked this media resource CC0.",
        );
        if (
          !resource?.url?.startsWith("https://") ||
          !resource.width ||
          !resource.height ||
          resource.width < 720 ||
          resource.height < 720 ||
          !evidence
        )
          return [];
        return [
          {
            id: `smithsonian-${row.id}-${media.id ?? mediaIndex}`.replace(/[^a-z0-9_-]/gi, "-"),
            provider: this.id,
            tier: this.tier,
            kind: "image" as const,
            previewUrl: media.thumbnail ?? media.content ?? resource.url,
            sourceUrl:
              details?.record_link ?? `https://www.si.edu/object/${encodeURIComponent(row.id)}`,
            downloadUrl: resource.url,
            author: author ?? details?.data_source ?? "Smithsonian Institution",
            width: resource.width,
            height: resource.height,
            watermarked: false,
            motionScore: 0,
            semanticScore: 0.67,
            compositionScore: 0.7,
            styleScore: 0.7,
            license: evidence,
          },
        ];
      });
    });
  }
}

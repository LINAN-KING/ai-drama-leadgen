import { fetchJson } from "./http.js";
import { runBinary } from "../ffmpeg/process.js";
import type { LicenseEvidence, MediaCandidate, MediaProvider, SearchRequest } from "./types.js";

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  width: number;
  height: number;
  mime: string;
  extmetadata?: Record<string, { value?: string }>;
}
interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: CommonsImageInfo[];
}

function plain(value = ""): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function license(meta: CommonsImageInfo["extmetadata"]): LicenseEvidence | null {
  const name = plain(meta?.LicenseShortName?.value);
  const url =
    plain(meta?.LicenseUrl?.value) ||
    "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia";
  const allowed =
    /public domain|pdm|cc0|cc by(?:-sa)?(?: |$)/i.test(name) && !/noncommercial|\bnc\b/i.test(name);
  if (!allowed) return null;
  return {
    name,
    url,
    commercialUse: true,
    attributionRequired: /cc by/i.test(name),
    snapshotText:
      plain(meta?.UsageTerms?.value) ||
      `${name}; per-file license metadata supplied by Wikimedia Commons.`,
    capturedAt: new Date().toISOString(),
  };
}

export class WikimediaProvider implements MediaProvider {
  readonly id = "wikimedia";
  readonly tier = "open" as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]> {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:bitmap ${request.query}`,
      gsrnamespace: "6",
      gsrlimit: String(Math.min(request.limit, 50)),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: request.orientation === "portrait" ? "1080" : "1920",
      format: "json",
      origin: "*",
    }).toString();
    type Response = { query?: { pages?: Record<string, CommonsPage> } };
    let result: Response;
    if (process.platform === "win32") {
      if (signal?.aborted) throw signal.reason ?? new Error("Request aborted");
      const response = await runBinary(
        "curl.exe",
        [
          "-fsSL",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--connect-timeout",
          "15",
          "--max-time",
          "45",
          "-A",
          "ai-drama-leadgen/0.1",
          url.toString(),
        ],
        60_000,
      );
      result = JSON.parse(response.stdout) as Response;
    } else {
      result = await fetchJson<Response>(
        url,
        {
          headers: {
            "User-Agent": "ai-drama-leadgen/0.1 (local CLI; commercial-license verification)",
          },
        },
        signal,
      );
    }
    return Object.values(result.query?.pages ?? {}).flatMap((page) => {
      const info = page.imageinfo?.[0];
      const evidence = info ? license(info.extmetadata) : null;
      if (
        !info ||
        !evidence ||
        !info.mime.startsWith("image/") ||
        info.width < 720 ||
        info.height < 720
      )
        return [];
      const meta = info.extmetadata;
      return [
        {
          id: `wikimedia-${page.pageid}`,
          provider: this.id,
          tier: this.tier,
          kind: "image" as const,
          previewUrl: info.thumburl ?? info.url,
          sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`,
          downloadUrl: info.thumburl ?? info.url,
          author: plain(meta?.Artist?.value) || "Wikimedia Commons contributor",
          width: info.width,
          height: info.height,
          watermarked: false,
          motionScore: 0,
          semanticScore: 0.68,
          compositionScore: 0.7,
          styleScore: 0.72,
          license: evidence,
        },
      ];
    });
  }
}

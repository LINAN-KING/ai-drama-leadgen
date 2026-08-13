import { fetchJson } from "./http.js";
import { openLicenseEvidence } from "./open-license.js";
import { runPool } from "../scheduler/pool.js";
import { fetchJsonWithPinnedCurl } from "./safe-network.js";
import type { MediaCandidate, MediaProvider, SearchRequest } from "./types.js";
import { runBinary } from "../ffmpeg/process.js";

interface ArchiveDocument {
  identifier: string;
  title?: string;
  creator?: string | string[];
  licenseurl?: string;
  rights?: string;
}
interface ArchiveFile {
  name?: string;
  source?: string;
  format?: string;
  width?: string | number;
  height?: string | number;
  length?: string | number;
}
interface ArchiveMetadata {
  metadata?: ArchiveDocument;
  files?: ArchiveFile[];
}

function requestJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  if (process.platform !== "win32") return fetchJson<T>(url, {}, signal);
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted"));
  return fetchJsonWithPinnedCurl<T>(url, signal);
}

export type ArchiveJsonRequester = <T>(url: URL, signal?: AbortSignal) => Promise<T>;

export class InternetArchiveProvider implements MediaProvider {
  readonly id = "internet-archive";
  readonly tier = "open" as const;
  constructor(private readonly requester: ArchiveJsonRequester = requestJson) {}
  async isAvailable(): Promise<boolean> {
    if (process.platform !== "win32" || this.requester !== requestJson) return true;
    try {
      await runBinary("curl.exe", ["--version"], 10_000);
      return true;
    } catch {
      return false;
    }
  }

  async search(request: SearchRequest, signal?: AbortSignal): Promise<MediaCandidate[]> {
    const mediaType = request.kind === "video" ? "movies" : "image";
    const url = new URL("https://archive.org/advancedsearch.php");
    url.search = new URLSearchParams({
      q: `mediatype:${mediaType} AND licenseurl:* AND "${request.query.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
      "fl[]": "identifier,title,creator,licenseurl,rights",
      rows: String(Math.min(request.limit, 50)),
      page: "1",
      output: "json",
    }).toString();
    const search = await this.requester<{ response?: { docs?: ArchiveDocument[] } }>(url, signal);
    const records = await runPool(
      search.response?.docs ?? [],
      () => 6,
      async (document) => {
        const evidence = document.licenseurl
          ? openLicenseEvidence(document.licenseurl, document.rights)
          : null;
        if (!evidence) return [];
        const metadata = await this.requester<ArchiveMetadata>(
          new URL(`https://archive.org/metadata/${encodeURIComponent(document.identifier)}`),
          signal,
        );
        const candidates = (metadata.files ?? []).filter((file) => {
          const format = file.format ?? "";
          return (
            file.source === "original" &&
            (request.kind === "image" ? /jpeg|png/i.test(format) : /mpeg4|h\.264/i.test(format))
          );
        });
        if (evidence.attributionRequired && !document.creator) return [];
        return candidates.flatMap((file, index) => {
          const width = Number(file.width);
          const height = Number(file.height);
          const durationSeconds =
            request.kind === "video" && file.length ? Number(file.length) : undefined;
          if (
            !file.name ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width < 720 ||
            height < 720 ||
            (request.kind === "video" &&
              (!durationSeconds || durationSeconds < 0.8 || durationSeconds > 30))
          )
            return [];
          const downloadUrl = `https://archive.org/download/${encodeURIComponent(document.identifier)}/${encodeURIComponent(file.name)}`;
          const creator = Array.isArray(document.creator)
            ? document.creator.join(", ")
            : document.creator;
          return [
            {
              id: `internet-archive-${document.identifier}-${index}`.replace(/[^a-z0-9_-]/gi, "-"),
              provider: this.id,
              tier: this.tier,
              kind: request.kind,
              previewUrl: downloadUrl,
              sourceUrl: `https://archive.org/details/${encodeURIComponent(document.identifier)}`,
              downloadUrl,
              author: creator ?? "Internet Archive contributor",
              width,
              height,
              durationSeconds,
              watermarked: false,
              motionScore: request.kind === "video" ? 0.62 : 0,
              semanticScore: 0.64,
              compositionScore: 0.65,
              styleScore: 0.64,
              license: evidence,
            },
          ];
        });
      },
    );
    const candidates = records.flatMap((record) =>
      record.status === "fulfilled" ? record.value : [],
    );
    const failures = records.filter((record) => record.status === "rejected");
    if (!candidates.length && failures.length)
      throw new AggregateError(
        failures.map((record) => (record as PromiseRejectedResult).reason),
        "Internet Archive metadata requests failed",
      );
    return candidates;
  }
}

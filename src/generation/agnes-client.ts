import os from "node:os";
import path from "node:path";
import { readWindowsCredential } from "../config/windows-credentials.js";
import { assertSafeDownloadUrl, downloadMedia } from "../media-providers/download.js";
import { fetchJson } from "../media-providers/http.js";
import type { AgnesArtifact, AgnesClient, AgnesRequest } from "./agnes.js";

const API_ROOT = "https://apihub.agnes-ai.com";
const MODEL = "agnes-video-v2.0";
const TERMINAL_FAILURES = new Set(["failed", "cancelled", "canceled", "error"]);

interface AgnesVideoResponse {
  video_id?: string;
  status?: string;
  seconds?: string | number;
  size?: string;
  metadata?: { url?: string };
  error?: unknown;
}

function dimensions(aspectRatio: AgnesRequest["aspectRatio"]): [number, number] {
  if (aspectRatio === "9:16") return [448, 832];
  if (aspectRatio === "16:9") return [832, 448];
  return [768, 768];
}

function frameCount(durationSeconds: number): number {
  const intervals = Math.min(55, Math.max(1, Math.round((durationSeconds * 24) / 8)));
  return intervals * 8 + 1;
}

function parseSize(value: string | undefined, fallback: [number, number]): [number, number] {
  const match = value?.match(/^(\d+)x(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : fallback;
}

type CredentialReader = () => Promise<string | null>;
type Downloader = (url: string, outputPath: string, signal?: AbortSignal) => Promise<unknown>;

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Agnes polling aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AgnesApiClient implements AgnesClient {
  private readonly credential: CredentialReader;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly download: Downloader;
  private readonly outputRoot: string;

  constructor(
    options: {
      credential?: CredentialReader;
      pollIntervalMs?: number;
      maxPolls?: number;
      download?: Downloader;
      outputRoot?: string;
    } = {},
  ) {
    this.credential =
      options.credential ??
      (async () => process.env.AGNES_API_KEY ?? readWindowsCredential("ai-drama-leadgen-agnes"));
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.maxPolls = options.maxPolls ?? 120;
    this.download =
      options.download ??
      ((url, outputPath, signal) => downloadMedia(url, outputPath, 120_000, signal));
    this.outputRoot = options.outputRoot ?? path.join(os.tmpdir(), "drama-leadgen-agnes");
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(await this.credential());
  }

  async generate(request: AgnesRequest, signal?: AbortSignal): Promise<AgnesArtifact> {
    if (request.kind !== "video") throw new Error("Agnes image generation is not implemented");
    const apiKey = await this.credential();
    if (!apiKey) throw new Error("Agnes credential is unavailable");
    const [width, height] = dimensions(request.aspectRatio);
    const durationSeconds = request.durationSeconds ?? 3;
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const created = await fetchJson<AgnesVideoResponse>(
      new URL("/v1/videos", API_ROOT),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: MODEL,
          prompt: request.prompt,
          width,
          height,
          num_frames: frameCount(durationSeconds),
          frame_rate: 24,
          seed: request.seed,
          negative_prompt: "text, watermark, logo, low quality, distorted anatomy",
        }),
      },
      signal,
      60_000,
      1,
    );
    const videoId = created.video_id;
    if (!videoId) throw new Error("Agnes create response did not include video_id");
    let result = created;
    for (let poll = 0; poll < this.maxPolls && result.status !== "completed"; poll += 1) {
      signal?.throwIfAborted();
      if (result.status && TERMINAL_FAILURES.has(result.status.toLowerCase()))
        throw new Error(
          `Agnes generation failed: ${JSON.stringify(result.error ?? result.status)}`,
        );
      await delay(this.pollIntervalMs, signal);
      const pollUrl = new URL("/agnesapi", API_ROOT);
      pollUrl.searchParams.set("video_id", videoId);
      result = await fetchJson<AgnesVideoResponse>(pollUrl, { headers }, signal, 30_000);
    }
    if (result.status && TERMINAL_FAILURES.has(result.status.toLowerCase()))
      throw new Error(`Agnes generation failed: ${JSON.stringify(result.error ?? result.status)}`);
    if (result.status !== "completed") throw new Error("Agnes generation polling timed out");
    const outputUrl = result.metadata?.url;
    if (!outputUrl) throw new Error("Agnes completed response did not include metadata.url");
    assertSafeDownloadUrl(outputUrl);
    const safeId = videoId.replace(/[^a-z0-9_-]/gi, "-");
    const outputPath = path.join(this.outputRoot, `${safeId}.mp4`);
    await this.download(outputUrl, outputPath, signal);
    const actualSize = parseSize(result.size, [width, height]);
    const actualDuration = Number(result.seconds);
    return {
      id: videoId,
      localPath: outputPath,
      width: actualSize[0],
      height: actualSize[1],
      durationSeconds: Number.isFinite(actualDuration) ? actualDuration : durationSeconds,
      model: MODEL,
      temporary: true,
    };
  }
}

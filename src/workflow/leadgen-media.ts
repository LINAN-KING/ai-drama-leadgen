import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { TaskConfig } from "../config/schema.js";
import { discoverCandidates, type DiscoveryResult } from "../discovery/discover.js";
import type { AgnesClient, AgnesRequest } from "../generation/agnes.js";
import { agnesCandidate } from "../generation/agnes.js";
import { generateWithQa, GenerationBudget } from "../generation/retry.js";
import { downloadMedia } from "../media-providers/download.js";
import type { AssetLibrary, AssetRecord } from "../media-providers/library.js";
import type { MediaCandidate, MediaProvider } from "../media-providers/types.js";
import { analyzeMedia, type MediaQaPolicy } from "../media-qa/analyze.js";
import { rankCandidates, rejectAdjacentSimilarity } from "../media-qa/filter.js";

export interface LeadgenDiscovery extends DiscoveryResult {
  request: {
    query: string;
    kind: "video";
    limit: number;
    orientation: "portrait" | "landscape" | "square";
  };
}

export interface FrozenMediaAsset extends AssetRecord {
  candidate: MediaCandidate;
}

const LEADGEN_MEDIA_QA_POLICY: MediaQaPolicy = {
  minWidth: 720,
  minHeight: 720,
  minDurationSeconds: 0.8,
  maxDurationSeconds: 30,
  maxBlackRatio: 0.05,
  maxFreezeRatio: 0.85,
};

function orientation(config: TaskConfig): "portrait" | "landscape" | "square" {
  return config.aspectRatio === "9:16"
    ? "portrait"
    : config.aspectRatio === "16:9"
      ? "landscape"
      : "square";
}

export async function discoverLeadgenMedia(
  config: TaskConfig,
  providers: MediaProvider[],
): Promise<LeadgenDiscovery> {
  const request = {
    query: `${config.topic} cinematic fantasy AI`,
    kind: "video" as const,
    limit: 80,
    orientation: orientation(config),
  };
  return { request, ...(await discoverCandidates(providers, request, config.concurrency.search)) };
}

export async function acquireLeadgenMedia(options: {
  config: TaskConfig;
  variant: number;
  discovery: LeadgenDiscovery;
  workspace: string;
  library: AssetLibrary;
  agnes?: AgnesClient;
  required?: number;
}): Promise<{ assets: FrozenMediaAsset[]; gaps: string[] }> {
  const required = options.required ?? 9;
  const usage = await options.library.usageMap();
  const ranked = rejectAdjacentSimilarity(
    rankCandidates(options.discovery.candidates, usage, Math.max(required * 3, 40)).map(
      (item) => item.candidate,
    ),
  );
  const gaps: string[] = [];
  const assets: FrozenMediaAsset[] = [];
  const downloads = path.join(options.workspace, "downloads");
  await mkdir(downloads, { recursive: true });
  for (const candidate of ranked) {
    if (assets.length >= required) break;
    const extension = candidate.kind === "video" ? ".mp4" : ".jpg";
    const localPath = path.join(
      downloads,
      `${candidate.id.replace(/[^a-z0-9_-]/gi, "-")}${extension}`,
    );
    try {
      if (path.isAbsolute(candidate.downloadUrl)) await copyFile(candidate.downloadUrl, localPath);
      else await downloadMedia(candidate.downloadUrl, localPath);
      const report = await analyzeMedia(localPath, LEADGEN_MEDIA_QA_POLICY);
      if (!report.passed) {
        gaps.push(`${candidate.id}:${report.hardFailures.join(",")}`);
        continue;
      }
      const record = await options.library.importOriginal(candidate, localPath);
      await options.library.incrementUse(candidate.id);
      assets.push({ ...record, candidate });
    } catch (error) {
      gaps.push(`${candidate.id}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (assets.length < required && options.agnes) {
    const budget = new GenerationBudget();
    while (assets.length < required && budget.videoShotsUsed < budget.maxVideoShots) {
      const index = assets.length;
      const request: AgnesRequest = {
        prompt: `${options.config.topic}, cinematic fantasy drama shot, no text, no watermark`,
        kind: "video",
        aspectRatio: options.config.aspectRatio,
        durationSeconds: 3,
        seed: options.config.seed + options.variant * 10_007 + index,
      };
      const generated = await generateWithQa(options.agnes, request, budget, async (artifact) => {
        const report = await analyzeMedia(artifact.localPath, {
          ...LEADGEN_MEDIA_QA_POLICY,
          maxFreezeRatio: 0.8,
        });
        return { passed: report.passed, reason: report.hardFailures.join(", ") };
      });
      if (generated.status !== "accepted" || !generated.artifact) {
        gaps.push(`agnes-shot-${index + 1}:${generated.status}`);
        continue;
      }
      const candidate = agnesCandidate(generated.artifact, request);
      try {
        const record = await options.library.importOriginal(
          candidate,
          generated.artifact.localPath,
        );
        await options.library.incrementUse(candidate.id);
        assets.push({ ...record, candidate });
      } catch (error) {
        gaps.push(`${candidate.id}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (assets.length < required) gaps.push(`qualified-media:${assets.length}/${required}`);
  return { assets, gaps };
}

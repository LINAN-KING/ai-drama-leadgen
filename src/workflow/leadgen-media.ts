import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { TaskConfig } from "../config/schema.js";
import { discoverCandidates, type DiscoveryResult } from "../discovery/discover.js";
import {
  collectDiscoverySignals,
  enrichDiscoveryReferences,
  type DiscoveryPlugin,
  type DiscoveryReferenceReader,
  type DiscoverySignals,
} from "../discovery/plugins.js";
import type { AgnesClient, AgnesRequest } from "../generation/agnes.js";
import { agnesCandidate } from "../generation/agnes.js";
import { generateWithQa, GenerationBudget } from "../generation/retry.js";
import { downloadMedia } from "../media-providers/download.js";
import type { AssetLibrary, AssetRecord } from "../media-providers/library.js";
import type { MediaCandidate, MediaProvider } from "../media-providers/types.js";
import { analyzeMedia, type MediaQaPolicy } from "../media-qa/analyze.js";
import { rankCandidates, rejectAdjacentSimilarity } from "../media-qa/filter.js";

export interface LeadgenResourceLimits {
  download<T>(operation: () => Promise<T>): Promise<T>;
  agnes<T>(operation: () => Promise<T>): Promise<T>;
  qa<T>(operation: () => Promise<T>): Promise<T>;
}

export interface LeadgenDiscovery extends DiscoveryResult {
  request: {
    query: string;
    kind: "video";
    limit: number;
    orientation: "portrait" | "landscape" | "square";
  };
  signals: DiscoverySignals;
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
  plugins: DiscoveryPlugin[] = [],
  readers: DiscoveryReferenceReader[] = [],
): Promise<LeadgenDiscovery> {
  const signals = await enrichDiscoveryReferences(
    await collectDiscoverySignals(
      plugins,
      `${config.topic} ${config.workflow} ${config.platform} AI drama trends`,
      Math.min(config.concurrency.search, 3),
    ),
    readers,
    Math.min(config.concurrency.search, 2),
  );
  const expanded = signals.keywords.slice(0, 4).join(" ");
  const request = {
    query: `${config.topic} cinematic fantasy AI${expanded ? ` ${expanded}` : ""}`.slice(0, 300),
    kind: "video" as const,
    limit: 80,
    orientation: orientation(config),
  };
  return {
    request,
    signals,
    ...(await discoverCandidates(providers, request, config.concurrency.search)),
  };
}

export async function acquireLeadgenMedia(options: {
  config: TaskConfig;
  variant: number;
  discovery: LeadgenDiscovery;
  workspace: string;
  library: AssetLibrary;
  agnes?: AgnesClient;
  required?: number;
  resources?: LeadgenResourceLimits;
  agnesAttemptTimeoutMs?: number;
}): Promise<{ assets: FrozenMediaAsset[]; gaps: string[] }> {
  const cleanupGenerated = async (artifact: { localPath: string; temporary?: boolean }) => {
    if (artifact.temporary) await rm(artifact.localPath, { force: true });
  };
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
  let candidateIndex = 0;
  while (assets.length < required && candidateIndex < ranked.length) {
    const batch = ranked.slice(candidateIndex, candidateIndex + required - assets.length);
    candidateIndex += batch.length;
    const results = await Promise.all(
      batch.map(async (candidate) => {
        const extension = candidate.kind === "video" ? ".mp4" : ".jpg";
        const localPath = path.join(
          downloads,
          `${candidate.id.replace(/[^a-z0-9_-]/gi, "-")}${extension}`,
        );
        try {
          await (options.resources?.download ?? ((operation) => operation()))(async () => {
            if (path.isAbsolute(candidate.downloadUrl))
              await copyFile(candidate.downloadUrl, localPath);
            else await downloadMedia(candidate.downloadUrl, localPath);
          });
          const report = await (options.resources?.qa ?? ((operation) => operation()))(() =>
            analyzeMedia(localPath, LEADGEN_MEDIA_QA_POLICY),
          );
          if (!report.passed) return { gap: `${candidate.id}:${report.hardFailures.join(",")}` };
          const record = await options.library.importAndRecordUse(candidate, localPath);
          return { asset: { ...record, candidate } };
        } catch (error) {
          return {
            gap: `${candidate.id}:${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
    );
    for (const result of results) {
      if (result.asset) assets.push(result.asset);
      else if (result.gap) gaps.push(result.gap);
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
      const generated = await (options.resources?.agnes ?? ((operation) => operation()))(() =>
        generateWithQa(
          options.agnes!,
          request,
          budget,
          async (artifact) => {
            const report = await (options.resources?.qa ?? ((operation) => operation()))(() =>
              analyzeMedia(artifact.localPath, {
                ...LEADGEN_MEDIA_QA_POLICY,
                maxFreezeRatio: 0.8,
              }),
            );
            return { passed: report.passed, reason: report.hardFailures.join(", ") };
          },
          options.agnesAttemptTimeoutMs,
          5_000,
          cleanupGenerated,
        ),
      );
      if (generated.status !== "accepted" || !generated.artifact) {
        gaps.push(`agnes-shot-${index + 1}:${generated.status}`);
        if (generated.status === "unavailable") break;
        continue;
      }
      const candidate = agnesCandidate(generated.artifact, request);
      try {
        const record = await options.library.importAndRecordUse(
          candidate,
          generated.artifact.localPath,
        );
        assets.push({ ...record, candidate });
      } catch (error) {
        gaps.push(`${candidate.id}:${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await cleanupGenerated(generated.artifact);
      }
    }
  }
  if (assets.length < required) gaps.push(`qualified-media:${assets.length}/${required}`);
  return { assets, gaps };
}

import { runBinary } from "../ffmpeg/process.js";
import { probeMedia, type MediaProbe } from "./probe.js";

export interface MediaQaPolicy {
  minWidth: number;
  minHeight: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  maxBlackRatio: number;
  maxFreezeRatio: number;
}

export const DEFAULT_MEDIA_QA_POLICY: MediaQaPolicy = {
  minWidth: 720,
  minHeight: 720,
  minDurationSeconds: 0.8,
  maxDurationSeconds: 30,
  maxBlackRatio: 0.15,
  maxFreezeRatio: 0.5,
};

export interface MediaQaReport {
  passed: boolean;
  hardFailures: string[];
  warnings: string[];
  probe: MediaProbe;
  blackRatio: number;
  freezeRatio: number;
}

function sumDetectedDuration(log: string, detector: "black" | "freeze"): number {
  const pattern =
    detector === "black" ? /black_duration:([0-9.]+)/g : /freeze_duration: ([0-9.]+)/g;
  return [...log.matchAll(pattern)].reduce((sum, match) => sum + Number(match[1] ?? 0), 0);
}

export async function analyzeMedia(
  filePath: string,
  policy = DEFAULT_MEDIA_QA_POLICY,
): Promise<MediaQaReport> {
  const probe = await probeMedia(filePath);
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!probe.decodable) failures.push("not-decodable");
  if (probe.width < policy.minWidth || probe.height < policy.minHeight)
    failures.push("insufficient-resolution");
  if (probe.kind === "video" && probe.durationSeconds < policy.minDurationSeconds)
    failures.push("too-short");
  if (probe.kind === "video" && probe.durationSeconds > policy.maxDurationSeconds)
    warnings.push("long-source");
  let blackRatio = 0;
  let freezeRatio = 0;
  if (probe.decodable && probe.kind === "video" && probe.durationSeconds > 0) {
    const black = await runBinary("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      filePath,
      "-vf",
      "blackdetect=d=0.1:pix_th=0.02",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const freeze = await runBinary("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      filePath,
      "-vf",
      "freezedetect=n=-50dB:d=0.5",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    blackRatio = Math.min(1, sumDetectedDuration(black.stderr, "black") / probe.durationSeconds);
    freezeRatio = Math.min(1, sumDetectedDuration(freeze.stderr, "freeze") / probe.durationSeconds);
    if (blackRatio > policy.maxBlackRatio) failures.push("excessive-black-frames");
    if (freezeRatio > policy.maxFreezeRatio) failures.push("excessive-freeze");
  }
  return {
    passed: failures.length === 0,
    hardFailures: failures,
    warnings,
    probe,
    blackRatio: Number(blackRatio.toFixed(6)),
    freezeRatio: Number(freezeRatio.toFixed(6)),
  };
}

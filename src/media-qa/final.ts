import type { AspectRatio } from "../config/schema.js";
import { CANVAS_SIZES } from "../hyperframes/types.js";
import { analyzeMedia } from "./analyze.js";

export interface FinalVideoQaReport {
  passed: boolean;
  failures: string[];
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  codec: string | null;
  hasAudio: boolean;
}

export async function analyzeFinalVideo(
  filePath: string,
  aspectRatio: AspectRatio,
  expectedDuration: number,
): Promise<FinalVideoQaReport> {
  const media = await analyzeMedia(filePath, {
    minWidth: 720,
    minHeight: 720,
    minDurationSeconds: expectedDuration - 0.2,
    maxDurationSeconds: expectedDuration + 0.2,
    maxBlackRatio: 0.05,
    maxFreezeRatio: 0.5,
  });
  const hasAudio = media.probe.hasAudio;
  const size = CANVAS_SIZES[aspectRatio];
  const failures = [...media.hardFailures];
  if (media.probe.width !== size.width || media.probe.height !== size.height)
    failures.push("wrong-canvas-size");
  if (media.probe.codec !== "h264") failures.push("wrong-video-codec");
  if (Math.abs(media.probe.frameRate - 30) > 0.01) failures.push("wrong-frame-rate");
  if (Math.abs(media.probe.durationSeconds - expectedDuration) > 0.2)
    failures.push("wrong-duration");
  if (!hasAudio) failures.push("missing-audio-track");
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    width: media.probe.width,
    height: media.probe.height,
    durationSeconds: media.probe.durationSeconds,
    frameRate: media.probe.frameRate,
    codec: media.probe.codec,
    hasAudio,
  };
}

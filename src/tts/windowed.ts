import path from "node:path";
import { runBinary } from "../ffmpeg/process.js";
import { normalizeNarration } from "./audio.js";
import { synthesizeWithRetry } from "./retry.js";
import type { TtsProvider, TtsSegment } from "./types.js";

export async function synthesizeWithinWindow(options: {
  provider: TtsProvider;
  segment: TtsSegment;
  outputDirectory: string;
  outputStem: string;
  voiceStyle: string;
  windowSeconds: number;
  speeds?: number[];
  synthesize?: typeof synthesizeWithRetry;
  normalize?: typeof normalizeNarration;
  probeDuration?: (filePath: string) => Promise<number>;
}): Promise<{ path: string; durationSeconds: number; speed: number }> {
  const speeds = options.speeds ?? [1, 1.1];
  const output = path.join(options.outputDirectory, `${options.outputStem}.wav`);
  const synthesize = options.synthesize ?? synthesizeWithRetry;
  const normalize = options.normalize ?? normalizeNarration;
  const probeDuration =
    options.probeDuration ??
    (async (filePath) => {
      const probe = await runBinary("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        filePath,
      ]);
      return Number(probe.stdout.trim());
    });
  let durationSeconds = Number.POSITIVE_INFINITY;
  for (const [attempt, speed] of speeds.entries()) {
    const raw = path.join(
      options.outputDirectory,
      `${options.outputStem}-attempt-${attempt + 1}-raw.wav`,
    );
    await synthesize(options.provider, {
      segment: options.segment,
      outputPath: raw,
      voiceStyle: options.voiceStyle,
      speed,
    });
    await normalize(raw, output);
    durationSeconds = await probeDuration(output);
    if (Number.isFinite(durationSeconds) && durationSeconds <= options.windowSeconds + 0.05)
      return { path: output, durationSeconds, speed };
  }
  throw new Error(
    `Narration segment ${options.segment.id} is ${durationSeconds.toFixed(3)}s after ${speeds.length} attempts but its window is ${options.windowSeconds.toFixed(3)}s`,
  );
}

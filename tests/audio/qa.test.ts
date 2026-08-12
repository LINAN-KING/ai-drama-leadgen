import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { analyzeAudio } from "../../src/audio-qa/analyze.js";
import { normalizeNarration } from "../../src/tts/audio.js";

const exec = promisify(execFile);

describe("real FFmpeg audio QA", () => {
  it("verifies normalized narration loudness and peak", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "audio-qa-"));
    const source = path.join(root, "source.wav");
    const normalized = path.join(root, "normalized.wav");
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=pink:amplitude=0.15:duration=2:sample_rate=48000",
      "-c:a",
      "pcm_s16le",
      source,
    ]);
    await normalizeNarration(source, normalized);
    const report = await analyzeAudio(normalized);
    expect(report.passed).toBe(true);
    expect(report.integratedLufs).toBeGreaterThanOrEqual(-18);
    expect(report.integratedLufs).toBeLessThanOrEqual(-14);
    expect(report.truePeakDbtp).toBeLessThanOrEqual(-1);
  });
});

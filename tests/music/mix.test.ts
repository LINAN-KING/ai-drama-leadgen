import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { analyzeAudio } from "../../src/audio-qa/analyze.js";
import { mixNarrationMusicAndEffects } from "../../src/music/mix.js";

const exec = promisify(execFile);

describe("real FFmpeg narration-first mix", () => {
  it("mixes narration, music, and effects to final loudness", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mix-"));
    const narration = path.join(root, "narr.wav");
    const music = path.join(root, "music.wav");
    const effect = path.join(root, "effect.wav");
    const output = path.join(root, "mix.wav");
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:d=2.5",
      "-af",
      "volume=0.18",
      narration,
    ]);
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=pink:amplitude=0.08:duration=2.5",
      music,
    ]);
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=f=1200:d=0.12",
      "-af",
      "afade=t=out:st=0.04:d=0.08",
      effect,
    ]);
    await mixNarrationMusicAndEffects(
      narration,
      music,
      [{ path: effect, start: 1, volume: 0.1 }],
      2.5,
      output,
    );
    const report = await analyzeAudio(output, -14, 2);
    expect(report.passed).toBe(true);
    expect(report.truePeakDbtp).toBeLessThanOrEqual(-1);
  });
});

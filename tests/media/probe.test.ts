import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { analyzeMedia } from "../../src/media-qa/analyze.js";

const exec = promisify(execFile);

describe("real FFmpeg media QA", () => {
  it("accepts a decodable moving 720p clip", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "media-qa-"));
    const video = path.join(root, "moving.mp4");
    await exec(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=30:duration=1.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        video,
      ],
      { timeout: 60_000 },
    );
    const report = await analyzeMedia(video);
    expect(report.passed).toBe(true);
    expect(report.probe).toMatchObject({ width: 1280, height: 720, decodable: true });
  });

  it("rejects black video", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "media-qa-black-"));
    const video = path.join(root, "black.mp4");
    await exec(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=black:size=1280x720:rate=30:duration=1.2",
        "-c:v",
        "libx264",
        video,
      ],
      { timeout: 60_000 },
    );
    const report = await analyzeMedia(video);
    expect(report.hardFailures).toContain("excessive-black-frames");
  });
});

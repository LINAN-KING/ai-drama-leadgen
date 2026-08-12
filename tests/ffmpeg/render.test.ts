import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { renderEdl } from "../../src/ffmpeg/render.js";
import { probeMedia } from "../../src/media-qa/probe.js";
import { analyzeFinalVideo } from "../../src/media-qa/final.js";

const exec = promisify(execFile);

describe("real FFmpeg EDL render", () => {
  it("normalizes, concatenates, subtitles, and packages H.264 30fps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "edl-render-"));
    const first = path.join(root, "first.mp4");
    const second = path.join(root, "second.mp4");
    const audio = path.join(root, "audio.wav");
    const subtitle = path.join(root, "subtitle.srt");
    const output = path.join(root, "final.mp4");
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=24:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      first,
    ]);
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=720x1280:rate=25:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      second,
    ]);
    await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=f=440:d=2", audio]);
    await writeFile(subtitle, "1\n00:00:00,000 --> 00:00:01,500\n测试字幕\n", "utf8");
    await renderEdl(
      {
        aspectRatio: "1:1",
        fps: 30,
        duration: 2,
        shots: [
          {
            id: "a",
            sourcePath: first,
            sourceStart: 0,
            sourceDuration: 1,
            timelineStart: 0,
            timelineDuration: 1,
            speed: 1,
            role: "hook",
          },
          {
            id: "b",
            sourcePath: second,
            sourceStart: 0,
            sourceDuration: 1,
            timelineStart: 1,
            timelineDuration: 1,
            speed: 1,
            role: "cta",
          },
        ],
      },
      {
        workDirectory: path.join(root, "work"),
        audioPath: audio,
        subtitlePath: subtitle,
        outputPath: output,
      },
    );
    const probe = await probeMedia(output);
    expect(probe).toMatchObject({ decodable: true, width: 1080, height: 1080, codec: "h264" });
    expect(probe.frameRate).toBe(30);
    expect(probe.durationSeconds).toBeGreaterThanOrEqual(1.9);
    expect(probe.durationSeconds).toBeLessThanOrEqual(2.1);
    const finalQa = await analyzeFinalVideo(output, "1:1", 2);
    expect(finalQa.passed).toBe(true);
  }, 60_000);
});

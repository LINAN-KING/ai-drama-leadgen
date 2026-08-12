import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CANVAS_SIZES } from "../hyperframes/types.js";
import type { EditDecisionList } from "../editing/edl.js";
import { cropExpression, validateEdl } from "../editing/edl.js";
import { probeMedia } from "../media-qa/probe.js";
import { runBinary } from "./process.js";

export async function normalizeShot(
  sourcePath: string,
  outputPath: string,
  options: {
    width: number;
    height: number;
    sourceStart: number;
    duration: number;
    speed: number;
    focus?: { x: number; y: number };
  },
): Promise<void> {
  const probe = await probeMedia(sourcePath);
  if (!probe.decodable) throw new Error(`Cannot decode source shot: ${sourcePath}`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const crop = cropExpression(
    probe.width,
    probe.height,
    options.width,
    options.height,
    options.focus,
  );
  const setpts = `setpts=(PTS-STARTPTS)/${options.speed}`;
  await runBinary(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(options.sourceStart),
      "-i",
      sourcePath,
      "-t",
      String(options.duration * options.speed),
      "-vf",
      `${crop},scale=${options.width}:${options.height}:flags=lanczos,${setpts},fps=30,format=yuv420p`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      outputPath,
    ],
    180_000,
  );
}

export async function renderEdl(
  edl: EditDecisionList,
  workDirectory: string,
  audioPath: string | null,
  subtitlePath: string | null,
  outputPath: string,
): Promise<void> {
  const failures = validateEdl(edl);
  if (failures.length) throw new Error(`Invalid EDL: ${failures.join(", ")}`);
  const size = CANVAS_SIZES[edl.aspectRatio];
  const clipsDirectory = path.join(workDirectory, "normalized-clips");
  const clips: string[] = [];
  for (const [index, shot] of edl.shots.entries()) {
    const clip = path.join(clipsDirectory, `${String(index).padStart(3, "0")}-${shot.id}.mp4`);
    await normalizeShot(shot.sourcePath, clip, {
      width: size.width,
      height: size.height,
      sourceStart: shot.sourceStart,
      duration: shot.timelineDuration,
      speed: shot.speed,
      focus: shot.focus,
    });
    clips.push(clip);
  }
  const concatPath = path.join(workDirectory, "video-concat.txt");
  await mkdir(workDirectory, { recursive: true });
  await writeFile(
    concatPath,
    clips.map((clip) => `file '${path.resolve(clip).replaceAll("'", "'\\''")}'`).join("\n"),
    "utf8",
  );
  const silentVideo = path.join(workDirectory, "silent-video.mp4");
  await runBinary(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", silentVideo],
    180_000,
  );
  const args = ["-y", "-i", silentVideo];
  if (audioPath) args.push("-i", audioPath);
  const subtitleFilter = subtitlePath
    ? `subtitles='${subtitlePath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'")}':force_style='Alignment=2,MarginV=${Math.round(size.height * 0.22)},FontName=Microsoft YaHei,FontSize=${edl.aspectRatio === "9:16" ? 18 : 24},PrimaryColour=&H0000FFFF,OutlineColour=&H0011100F,BorderStyle=1,Outline=2,Shadow=0'`
    : null;
  args.push(
    ...(subtitleFilter ? ["-vf", subtitleFilter] : []),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
  );
  if (audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  else args.push("-an");
  args.push(outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await runBinary("ffmpeg", args, 300_000);
}

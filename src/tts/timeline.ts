import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runBinary } from "../ffmpeg/process.js";

export async function placeNarrationSegments(
  segments: Array<{ path: string; start: number }>,
  durationSeconds: number,
  outputPath: string,
): Promise<void> {
  if (!segments.length) throw new Error("At least one narration segment is required");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const args: string[] = ["-y"];
  for (const segment of segments) args.push("-i", segment.path);
  const filters = segments.map(
    (segment, index) =>
      `[${index}:a]adelay=${Math.round(segment.start * 1000)}|${Math.round(segment.start * 1000)}[s${index}]`,
  );
  filters.push(
    `${segments.map((_, index) => `[s${index}]`).join("")}amix=inputs=${segments.length}:duration=longest:normalize=0,apad=whole_dur=${durationSeconds},atrim=0:${durationSeconds},loudnorm=I=-16:TP=-1.5:LRA=7[out]`,
  );
  await runBinary(
    "ffmpeg",
    [
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    180_000,
  );
}

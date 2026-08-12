import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBinary } from "../ffmpeg/process.js";

export async function normalizeNarration(input: string, output: string): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  await runBinary("ffmpeg", [
    "-y",
    "-i",
    input,
    "-ar",
    "48000",
    "-ac",
    "1",
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=7",
    "-c:a",
    "pcm_s16le",
    output,
  ]);
}

export async function concatenateWav(inputs: string[], output: string): Promise<void> {
  if (inputs.length === 0) throw new Error("At least one WAV segment is required");
  const listPath = path.join(path.dirname(output), "narration-concat.txt");
  const quote = (value: string) => value.replaceAll("'", "'\\''");
  await writeFile(
    listPath,
    inputs.map((input) => `file '${quote(path.resolve(input))}'`).join("\n"),
    "utf8",
  );
  await runBinary("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:a",
    "pcm_s16le",
    output,
  ]);
}

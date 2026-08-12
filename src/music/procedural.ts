import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runBinary } from "../ffmpeg/process.js";

export const PROCEDURAL_AUDIO_LICENSE = {
  name: "Project-generated original audio",
  url: "local://ai-drama-leadgen/procedural-audio",
  commercialUse: true,
  attributionRequired: false,
  snapshotText:
    "Deterministically synthesized by this MIT-licensed project without third-party samples.",
};

export async function generateProceduralMusic(
  outputPath: string,
  durationSeconds: number,
  seed: number,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const root = 110 + (seed % 5) * 8;
  const filter = [root, root * 1.5, root * 2]
    .map(
      (frequency, index) =>
        `sine=frequency=${frequency}:sample_rate=48000:duration=${durationSeconds},volume=${[0.08, 0.04, 0.025][index]}[t${index}]`,
    )
    .join(";");
  await runBinary("ffmpeg", [
    "-y",
    "-filter_complex",
    `${filter};[t0][t1][t2]amix=inputs=3:normalize=0,lowpass=f=1800,afade=t=in:d=1,afade=t=out:st=${Math.max(0, durationSeconds - 2)}:d=2[out]`,
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ]);
}

export async function generateProceduralEffects(
  directory: string,
  count: number,
  seed: number,
): Promise<string[]> {
  if (count < 5 || count > 8) throw new RangeError("Sound effect count must be 5-8");
  await mkdir(directory, { recursive: true });
  const files: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const output = path.join(directory, `effect-${index + 1}.wav`);
    const frequency = 520 + ((seed + index * 137) % 900);
    await runBinary("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=f=${frequency}:d=0.18`,
      "-af",
      "volume=0.2,afade=t=out:st=0.04:d=0.14",
      output,
    ]);
    files.push(output);
  }
  return files;
}

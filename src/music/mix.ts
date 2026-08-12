import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runBinary } from "../ffmpeg/process.js";

export interface EffectPlacement {
  path: string;
  start: number;
  volume: number;
}

export async function mixNarrationMusicAndEffects(
  narrationPath: string,
  musicPath: string,
  effects: EffectPlacement[],
  durationSeconds: number,
  outputPath: string,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const inputs = ["-i", narrationPath, "-stream_loop", "-1", "-i", musicPath];
  for (const effect of effects) inputs.push("-i", effect.path);
  const graph: string[] = [
    `[0:a]atrim=0:${durationSeconds},asetpts=PTS-STARTPTS,volume=1[narr]`,
    `[1:a]atrim=0:${durationSeconds},asetpts=PTS-STARTPTS,volume=0.32[music]`,
    `[music][narr]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=350:makeup=1[ducked]`,
  ];
  const mixLabels = ["[narr]", "[ducked]"];
  effects.forEach((effect, index) => {
    const delay = Math.max(0, Math.round(effect.start * 1000));
    const label = `fx${index}`;
    graph.push(`[${index + 2}:a]adelay=${delay}|${delay},volume=${effect.volume}[${label}]`);
    mixLabels.push(`[${label}]`);
  });
  graph.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,loudnorm=I=-14:TP=-1:LRA=9,atrim=0:${durationSeconds}[out]`,
  );
  await runBinary(
    "ffmpeg",
    [
      "-y",
      ...inputs,
      "-filter_complex",
      graph.join(";"),
      "-map",
      "[out]",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    180_000,
  );
}

import { readFile } from "node:fs/promises";
import { runBinary } from "../ffmpeg/process.js";
import type { TranscriptWord } from "./types.js";

interface WhisperJson {
  segments?: Array<{
    words?: Array<{
      word?: string;
      text?: string;
      start: number;
      end: number;
      probability?: number;
    }>;
  }>;
}

export async function transcribeWithWhisper(
  audioPath: string,
  outputDirectory: string,
  model = "small",
): Promise<TranscriptWord[]> {
  await runBinary(
    "whisper",
    [
      audioPath,
      "--model",
      model,
      "--language",
      "zh",
      "--word_timestamps",
      "True",
      "--output_format",
      "json",
      "--output_dir",
      outputDirectory,
    ],
    600_000,
  );
  const base = pathBase(audioPath);
  const parsed = JSON.parse(
    await readFile(`${outputDirectory}/${base}.json`, "utf8"),
  ) as WhisperJson;
  return (parsed.segments ?? []).flatMap((segment) =>
    (segment.words ?? []).map((word) => ({
      text: (word.word ?? word.text ?? "").trim(),
      start: word.start,
      end: word.end,
      confidence: word.probability,
    })),
  );
}

function pathBase(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "");
}

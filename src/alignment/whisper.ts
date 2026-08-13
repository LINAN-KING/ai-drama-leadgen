import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
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
  initialPrompt?: string,
): Promise<TranscriptWord[]> {
  const args = [
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
  ];
  if (initialPrompt) args.push("--initial_prompt", initialPrompt);
  await runBinary("whisper", args, 600_000);
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

export async function transcribeSectionsWithWhisper(
  audioPath: string,
  outputDirectory: string,
  sections: Array<{ id: string; narration: string; start: number; end: number }>,
  model = "small",
  dependencies: {
    extract?: (input: string, output: string, start: number, duration: number) => Promise<void>;
    transcribe?: typeof transcribeWithWhisper;
  } = {},
): Promise<TranscriptWord[]> {
  await mkdir(outputDirectory, { recursive: true });
  const extract =
    dependencies.extract ??
    (async (input, output, start, duration) => {
      await runBinary(
        "ffmpeg",
        [
          "-y",
          "-ss",
          start.toFixed(3),
          "-t",
          duration.toFixed(3),
          "-i",
          input,
          "-ar",
          "16000",
          "-ac",
          "1",
          output,
        ],
        120_000,
      );
    });
  const transcribe = dependencies.transcribe ?? transcribeWithWhisper;
  const transcript: TranscriptWord[] = [];
  for (const [index, section] of sections.entries()) {
    const clip = path.join(outputDirectory, `section-${String(index).padStart(2, "0")}.wav`);
    const sectionOutput = path.join(outputDirectory, `section-${String(index).padStart(2, "0")}`);
    await extract(audioPath, clip, section.start, section.end - section.start);
    const words = await transcribe(clip, sectionOutput, model, section.narration);
    transcript.push(
      ...words.map((word) => ({
        ...word,
        start: word.start + section.start,
        end: word.end + section.start,
      })),
    );
  }
  return transcript;
}

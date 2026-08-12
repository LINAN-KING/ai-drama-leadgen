import type { CaptionMode } from "../config/schema.js";
import type { AlignedWord } from "../alignment/types.js";

export interface CaptionCue {
  id: string;
  text: string;
  start: number;
  end: number;
  words: AlignedWord[];
  mode: CaptionMode;
  baselinePercent: number;
}

export function buildCaptions(
  words: AlignedWord[],
  mode: CaptionMode,
  maxCharacters = 14,
): CaptionCue[] {
  const matched = words.filter((word) => word.matched);
  const cues: CaptionCue[] = [];
  let group: AlignedWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0]!.start;
    const speechEnd = group.at(-1)!.end;
    cues.push({
      id: `caption-${String(cues.length + 1).padStart(3, "0")}`,
      text: group.map((word) => word.sourceText).join(""),
      start,
      end: Math.max(speechEnd, start + 0.65),
      words: group,
      mode,
      baselinePercent: 22,
    });
    group = [];
  };
  for (const word of matched) {
    const nextLength =
      group.reduce((sum, item) => sum + item.sourceText.length, 0) + word.sourceText.length;
    const gap = group.length ? word.start - group.at(-1)!.end : 0;
    if (nextLength > maxCharacters || gap > 0.35) flush();
    group.push(word);
  }
  flush();
  for (let index = 1; index < cues.length; index += 1)
    if (cues[index]!.start < cues[index - 1]!.end) cues[index - 1]!.end = cues[index]!.start;
  return cues;
}

function srtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`).join("\n\n")}\n`;
}

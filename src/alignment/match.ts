import type { AlignedWord, AlignmentReport, TranscriptWord } from "./types.js";

export function normalizeSpeechText(text: string): string[] {
  return [...text.replace(/[\s，。！？、“”‘’：:；;,.!?]/g, "")].filter(Boolean);
}

function lcsPairs(source: string[], transcript: string[]): Array<[number, number]> {
  const table = Array.from({ length: source.length + 1 }, () =>
    Array<number>(transcript.length + 1).fill(0),
  );
  for (let i = source.length - 1; i >= 0; i -= 1)
    for (let j = transcript.length - 1; j >= 0; j -= 1)
      table[i]![j] =
        source[i] === transcript[j]
          ? 1 + table[i + 1]![j + 1]!
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < source.length && j < transcript.length) {
    if (source[i] === transcript[j]) {
      pairs.push([i++, j++]);
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

export function alignTranscript(sourceText: string, transcript: TranscriptWord[]): AlignmentReport {
  const source = normalizeSpeechText(sourceText);
  const flatTranscript = transcript.flatMap((word, wordIndex) => {
    const characters = normalizeSpeechText(word.text);
    const duration = Math.max(0, word.end - word.start);
    return characters.map((text, characterIndex) => ({
      text,
      wordIndex,
      start: word.start + (duration * characterIndex) / characters.length,
      end: word.start + (duration * (characterIndex + 1)) / characters.length,
    }));
  });
  const pairs = lcsPairs(
    source,
    flatTranscript.map((item) => item.text),
  );
  const matchedByTranscript = new Map(
    pairs.map(([sourceIndex, transcriptIndex]) => [transcriptIndex, sourceIndex]),
  );
  const words: AlignedWord[] = flatTranscript.map((item, index) => ({
    ...transcript[item.wordIndex]!,
    text: item.text,
    start: item.start,
    end: item.end,
    sourceText: matchedByTranscript.has(index) ? source[matchedByTranscript.get(index)!]! : "",
    sourceIndex: matchedByTranscript.get(index) ?? -1,
    matched: matchedByTranscript.has(index),
  }));
  const coverage = source.length ? pairs.length / source.length : 0;
  const errors = words
    .filter((word) => word.matched)
    .map((word) => (Math.max(0, word.end - word.start) * 1000) / 2)
    .sort((a, b) => a - b);
  const medianErrorMs = errors.length
    ? errors[Math.floor(errors.length / 2)]!
    : Number.POSITIVE_INFINITY;
  const failures: string[] = [];
  if (coverage < 0.98) failures.push("source-coverage-below-98-percent");
  if (medianErrorMs > 120) failures.push("median-word-error-above-120ms");
  for (let index = 1; index < words.length; index += 1)
    if (words[index]!.start < words[index - 1]!.end) failures.push("overlapping-word-times");
  return {
    words,
    coverage: Number(coverage.toFixed(6)),
    medianErrorMs: Number(medianErrorMs.toFixed(3)),
    passed: failures.length === 0,
    failures: [...new Set(failures)],
  };
}

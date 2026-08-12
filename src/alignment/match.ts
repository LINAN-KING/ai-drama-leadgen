import type { AlignedWord, AlignmentReport, TranscriptWord } from "./types.js";

export function normalizeSpeechText(text: string): string[] {
  return [...text.replace(/[\s，。！？、“”‘’：:；;,.!?…]/g, "")].filter(Boolean);
}

type EditPair = { sourceIndex: number | null; transcriptIndex: number | null };

function editPairs(source: string[], transcript: string[]): EditPair[] {
  const table = Array.from({ length: source.length + 1 }, () =>
    Array<number>(transcript.length + 1).fill(0),
  );
  for (let i = 0; i <= source.length; i += 1) table[i]![0] = i;
  for (let j = 0; j <= transcript.length; j += 1) table[0]![j] = j;
  for (let i = 1; i <= source.length; i += 1)
    for (let j = 1; j <= transcript.length; j += 1)
      table[i]![j] = Math.min(
        table[i - 1]![j]! + 1,
        table[i]![j - 1]! + 1,
        table[i - 1]![j - 1]! + (source[i - 1] === transcript[j - 1] ? 0 : 1),
      );
  const pairs: EditPair[] = [];
  let i = source.length;
  let j = transcript.length;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      table[i]![j] === table[i - 1]![j - 1]! + (source[i - 1] === transcript[j - 1] ? 0 : 1)
    ) {
      pairs.push({ sourceIndex: --i, transcriptIndex: --j });
    } else if (i > 0 && table[i]![j] === table[i - 1]![j]! + 1) {
      pairs.push({ sourceIndex: --i, transcriptIndex: null });
    } else {
      pairs.push({ sourceIndex: null, transcriptIndex: --j });
    }
  }
  return pairs.reverse();
}

export function alignTranscript(sourceText: string, transcript: TranscriptWord[]): AlignmentReport {
  const source = normalizeSpeechText(sourceText);
  const flatTranscript = transcript.flatMap((word, wordIndex) => {
    const characters = normalizeSpeechText(word.text);
    const duration = Math.max(0, word.end - word.start);
    return characters.map((text, characterIndex) => ({
      ...word,
      text,
      start: word.start + (duration * characterIndex) / characters.length,
      end: word.start + (duration * (characterIndex + 1)) / characters.length,
      wordIndex,
    }));
  });
  const pairs = editPairs(
    source,
    flatTranscript.map((item) => item.text),
  );
  const alignedSource = new Set(
    pairs
      .filter((pair) => pair.sourceIndex !== null && pair.transcriptIndex !== null)
      .map((pair) => pair.sourceIndex!),
  );
  const substitutions = pairs.filter(
    (pair) =>
      pair.sourceIndex !== null &&
      pair.transcriptIndex !== null &&
      source[pair.sourceIndex] !== flatTranscript[pair.transcriptIndex]?.text,
  ).length;
  const words: AlignedWord[] = pairs.flatMap((pair) => {
    if (pair.transcriptIndex === null) return [];
    const item = flatTranscript[pair.transcriptIndex]!;
    return [
      {
        ...transcript[item.wordIndex]!,
        text: item.text,
        start: item.start,
        end: item.end,
        sourceText: pair.sourceIndex === null ? "" : source[pair.sourceIndex]!,
        sourceIndex: pair.sourceIndex ?? -1,
        matched: pair.sourceIndex !== null,
      },
    ];
  });
  const coverage = source.length ? alignedSource.size / source.length : 0;
  const errors = words
    .filter((word) => word.matched)
    .map((word) => (Math.max(0, word.end - word.start) * 1000) / 2)
    .sort((a, b) => a - b);
  const medianErrorMs = errors.length
    ? errors[Math.floor(errors.length / 2)]!
    : Number.POSITIVE_INFINITY;
  const failures: string[] = [];
  if (coverage < 0.98) failures.push("source-coverage-below-98-percent");
  const substitutionRate = source.length ? substitutions / source.length : 0;
  if (medianErrorMs > 120) failures.push("median-word-error-above-120ms");
  for (let index = 1; index < words.length; index += 1)
    if (words[index]!.start < words[index - 1]!.end) failures.push("overlapping-word-times");
  return {
    words,
    coverage: Number(coverage.toFixed(6)),
    medianErrorMs: Number(medianErrorMs.toFixed(3)),
    substitutionRate: Number(substitutionRate.toFixed(6)),
    passed: failures.length === 0,
    failures: [...new Set(failures)],
  };
}

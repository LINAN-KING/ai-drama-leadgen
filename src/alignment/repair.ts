import { alignTranscript, normalizeSpeechText } from "./match.js";
import type { AlignmentReport, TranscriptWord } from "./types.js";

export interface AlignmentSection {
  id: string;
  narration: string;
  start: number;
  end: number;
}

function failedSectionIndexes(sections: AlignmentSection[], report: AlignmentReport): number[] {
  const matchedBySource = new Set(
    report.words
      .filter((word) => word.matched && word.text === word.sourceText)
      .map((word) => word.sourceIndex),
  );
  let sourceOffset = 0;
  return sections.flatMap((section, index) => {
    const characters = normalizeSpeechText(section.narration);
    const startIndex = sourceOffset;
    const matched = characters.filter((_, localIndex) =>
      matchedBySource.has(sourceOffset + localIndex),
    );
    sourceOffset += characters.length;
    const words = report.words.filter(
      (word) => word.sourceIndex >= startIndex && word.sourceIndex < sourceOffset,
    );
    const invalidTiming = words.some(
      (word) =>
        word.end < word.start ||
        word.start < section.start - 0.001 ||
        word.end > section.end + 0.001,
    );
    const invalidOrder = words.some(
      (word, wordIndex) =>
        wordIndex > 0 &&
        (word.start < words[wordIndex - 1]!.start || word.start < words[wordIndex - 1]!.end),
    );
    return characters.length > 0 &&
      (matched.length / characters.length < 0.98 || invalidTiming || invalidOrder)
      ? [index]
      : [];
  });
}

function enforceSectionWindows(
  sections: AlignmentSection[],
  report: AlignmentReport,
): AlignmentReport {
  const boundaries: Array<{ startIndex: number; endIndex: number; start: number; end: number }> =
    [];
  let sourceOffset = 0;
  for (const section of sections) {
    const length = normalizeSpeechText(section.narration).length;
    boundaries.push({
      startIndex: sourceOffset,
      endIndex: sourceOffset + length,
      start: section.start,
      end: section.end,
    });
    sourceOffset += length;
  }
  const failures = [...report.failures];
  for (const word of report.words) {
    if (word.end < word.start) failures.push("non-monotonic-word-times");
    const boundary = boundaries.find(
      (candidate) =>
        word.sourceIndex >= candidate.startIndex && word.sourceIndex < candidate.endIndex,
    );
    if (boundary && (word.start < boundary.start - 0.001 || word.end > boundary.end + 0.001))
      failures.push("word-crosses-sentence-boundary");
  }
  for (let index = 1; index < report.words.length; index += 1)
    if (report.words[index]!.start < report.words[index - 1]!.start)
      failures.push("non-monotonic-word-times");
  const uniqueFailures = [...new Set(failures)];
  return { ...report, passed: uniqueFailures.length === 0, failures: uniqueFailures };
}

export async function alignWithSectionRepairs(options: {
  sections: AlignmentSection[];
  initialAudioPath: string;
  transcribe(audioPath: string, attempt: number): Promise<TranscriptWord[]>;
  repair(sectionIndexes: number[], attempt: number): Promise<string>;
  maxRepairAttempts?: number;
}): Promise<{
  report: AlignmentReport;
  audioPath: string;
  repairs: Array<{ sectionIds: string[]; attempt: number }>;
}> {
  const source = options.sections.map((section) => section.narration).join("");
  const maxRepairAttempts = options.maxRepairAttempts ?? 2;
  let audioPath = options.initialAudioPath;
  const repairs: Array<{ sectionIds: string[]; attempt: number }> = [];
  let report = enforceSectionWindows(
    options.sections,
    alignTranscript(source, await options.transcribe(audioPath, 0)),
  );
  for (let attempt = 1; !report.passed && attempt <= maxRepairAttempts; attempt += 1) {
    const indexes = failedSectionIndexes(options.sections, report);
    if (!indexes.length) break;
    repairs.push({ sectionIds: indexes.map((index) => options.sections[index]!.id), attempt });
    audioPath = await options.repair(indexes, attempt);
    report = enforceSectionWindows(
      options.sections,
      alignTranscript(source, await options.transcribe(audioPath, attempt)),
    );
  }
  return { report, audioPath, repairs };
}

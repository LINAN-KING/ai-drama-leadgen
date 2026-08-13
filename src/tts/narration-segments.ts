import type { ScriptSection } from "../script/plan.js";
import { normalizeSpeechText } from "../alignment/match.js";
import { splitNarration } from "./segments.js";
import type { TtsSegment } from "./types.js";

export interface NarrationSegment extends TtsSegment {
  parentSectionId: ScriptSection["id"];
  narration: string;
  start: number;
  end: number;
}

export function createNarrationSegments(sections: ScriptSection[]): NarrationSegment[] {
  let globalIndex = 0;
  return sections.flatMap((section) => {
    const sentences = splitNarration(section.narration);
    const weights = sentences.map((sentence) =>
      Math.max(1, normalizeSpeechText(sentence.text).length),
    );
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let cursor = section.start;
    return sentences.map((sentence, sentenceIndex) => {
      const end =
        sentenceIndex === sentences.length - 1
          ? section.end
          : cursor + ((section.end - section.start) * weights[sentenceIndex]!) / totalWeight;
      const segment: NarrationSegment = {
        id: `${section.id}-sentence-${String(sentenceIndex + 1).padStart(2, "0")}`,
        parentSectionId: section.id,
        text: sentence.text,
        narration: sentence.text,
        index: globalIndex,
        start: Number(cursor.toFixed(6)),
        end: Number(end.toFixed(6)),
      };
      globalIndex += 1;
      cursor = end;
      return segment;
    });
  });
}

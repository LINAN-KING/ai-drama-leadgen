import type { TtsSegment } from "./types.js";

export function splitNarration(text: string): TtsSegment[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const pieces = normalized.match(/[^，。！？；!?;]+[，。！？；!?;]?/g) ?? [normalized];
  return pieces.map((piece, index) => ({
    id: `segment-${String(index + 1).padStart(3, "0")}`,
    text: piece.trim(),
    index,
  }));
}

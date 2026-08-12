export function snapToBeat(semanticCut: number, beats: number[], maxOffsetSeconds = 0.12): number {
  const nearest = beats.reduce<number | null>((best, beat) => {
    if (Math.abs(beat - semanticCut) > maxOffsetSeconds) return best;
    if (best === null || Math.abs(beat - semanticCut) < Math.abs(best - semanticCut)) return beat;
    return best;
  }, null);
  return nearest ?? semanticCut;
}

export function trimToBar(targetDuration: number, bpm: number, beatsPerBar = 4): number {
  if (bpm <= 0) return targetDuration;
  const barDuration = (60 / bpm) * beatsPerBar;
  const bars = Math.max(1, Math.round(targetDuration / barDuration));
  return Math.min(targetDuration, Number((bars * barDuration).toFixed(3)));
}

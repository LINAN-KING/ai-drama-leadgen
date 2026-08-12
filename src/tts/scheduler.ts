import type { TtsProviderId } from "./types.js";

export function allocateProviders(
  count: number,
  edgeRatio: number,
  mimoRatio: number,
): TtsProviderId[] {
  if (count < 1 || count > 50) throw new RangeError("count must be 1-50");
  if (Math.abs(edgeRatio + mimoRatio - 1) > 0.0001) throw new Error("TTS ratios must sum to one");
  const edgeCount = Math.round(count * edgeRatio);
  const result: TtsProviderId[] = [];
  let edgeUsed = 0;
  let mimoUsed = 0;
  for (let index = 0; index < count; index += 1) {
    const edgeProgress = edgeCount ? edgeUsed / edgeCount : Number.POSITIVE_INFINITY;
    const mimoTarget = count - edgeCount;
    const mimoProgress = mimoTarget ? mimoUsed / mimoTarget : Number.POSITIVE_INFINITY;
    if (edgeProgress <= mimoProgress) {
      result.push("edge");
      edgeUsed += 1;
    } else {
      result.push("mimo");
      mimoUsed += 1;
    }
  }
  return result;
}

export function actualProviderRatio(assignments: TtsProviderId[]) {
  const edge = assignments.filter((item) => item === "edge").length;
  const mimo = assignments.length - edge;
  return {
    edge: assignments.length ? edge / assignments.length : 0,
    mimo: assignments.length ? mimo / assignments.length : 0,
  };
}

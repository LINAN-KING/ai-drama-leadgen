import type { MediaCandidate } from "../media-providers/types.js";

export interface CandidateDecision {
  candidate: MediaCandidate;
  accepted: boolean;
  hardFailures: string[];
  score: number;
}

export interface FilterPolicy {
  minWidth: number;
  minHeight: number;
  minSemanticScore: number;
  recentUsePenalty: number;
}

export const DEFAULT_FILTER_POLICY: FilterPolicy = {
  minWidth: 720,
  minHeight: 720,
  minSemanticScore: 0.55,
  recentUsePenalty: 0.06,
};

export function evaluateCandidate(
  candidate: MediaCandidate,
  useCount: number,
  policy = DEFAULT_FILTER_POLICY,
): CandidateDecision {
  const failures: string[] = [];
  if (!candidate.license?.commercialUse) failures.push("missing-commercial-license");
  if (!candidate.license?.url || !candidate.license.snapshotText)
    failures.push("missing-license-evidence");
  if (!candidate.sourceUrl || !candidate.author) failures.push("missing-provenance");
  if (candidate.watermarked) failures.push("watermark");
  if (candidate.width < policy.minWidth || candidate.height < policy.minHeight)
    failures.push("insufficient-resolution");
  if (candidate.semanticScore < policy.minSemanticScore) failures.push("semantic-mismatch");
  if (candidate.kind === "video" && (!candidate.durationSeconds || candidate.durationSeconds < 0.8))
    failures.push("insufficient-duration");
  const score =
    candidate.semanticScore * 0.34 +
    candidate.motionScore * 0.22 +
    candidate.compositionScore * 0.24 +
    candidate.styleScore * 0.2 -
    Math.min(useCount, 10) * policy.recentUsePenalty;
  return {
    candidate,
    accepted: failures.length === 0,
    hardFailures: failures,
    score: Number(score.toFixed(6)),
  };
}

export function rankCandidates(
  candidates: MediaCandidate[],
  usage: ReadonlyMap<string, number>,
  limit = 3,
): CandidateDecision[] {
  return candidates
    .map((candidate) => evaluateCandidate(candidate, usage.get(candidate.id) ?? 0))
    .filter((decision) => decision.accepted)
    .sort(
      (left, right) =>
        right.score - left.score || left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, limit);
}

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) distance += 1;
  return distance;
}

export function rejectAdjacentSimilarity(
  candidates: MediaCandidate[],
  maxDistance = 6,
): MediaCandidate[] {
  const result: MediaCandidate[] = [];
  for (const candidate of candidates) {
    const previous = result.at(-1);
    if (
      previous?.perceptualHash &&
      candidate.perceptualHash &&
      hammingDistance(previous.perceptualHash, candidate.perceptualHash) <= maxDistance
    )
      continue;
    result.push(candidate);
  }
  return result;
}

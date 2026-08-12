import type { MediaCandidate } from "../media-providers/types.js";
import { evaluateCandidate } from "../media-qa/filter.js";

export interface FrozenShot {
  shotId: string;
  mediaId: string;
  provider: string;
  sourceUrl: string;
  licenseUrl: string;
  sha256: string;
  localPath: string;
  start: number;
  duration: number;
}

export function freezeShot(
  candidate: MediaCandidate,
  original: { sha256: string; localPath: string },
  timing: { shotId: string; start: number; duration: number },
): FrozenShot {
  const decision = evaluateCandidate(candidate, 0);
  if (!decision.accepted)
    throw new Error(`Cannot freeze ${candidate.id}: ${decision.hardFailures.join(", ")}`);
  if (!/^[a-f0-9]{64}$/i.test(original.sha256)) throw new Error("A valid SHA-256 hash is required");
  if (!original.localPath) throw new Error("A local original is required");
  return {
    ...timing,
    mediaId: candidate.id,
    provider: candidate.provider,
    sourceUrl: candidate.sourceUrl,
    licenseUrl: candidate.license!.url,
    sha256: original.sha256.toLowerCase(),
    localPath: original.localPath,
  };
}

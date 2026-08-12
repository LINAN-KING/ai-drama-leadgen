import type { MediaProvider, MediaCandidate, SearchRequest } from "../media-providers/types.js";

export interface DiscoveryResult {
  candidates: MediaCandidate[];
  failures: Array<{ provider: string; error: string }>;
  unavailable: string[];
}

export async function discoverCandidates(
  providers: MediaProvider[],
  request: SearchRequest,
  concurrency = 6,
): Promise<DiscoveryResult> {
  const candidates: MediaCandidate[] = [];
  const failures: DiscoveryResult["failures"] = [];
  const unavailable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < providers.length) {
      const provider = providers[cursor++] as MediaProvider;
      try {
        if (!(await provider.isAvailable())) {
          unavailable.push(provider.id);
          continue;
        }
        candidates.push(...(await provider.search(request)));
      } catch (error) {
        failures.push({
          provider: provider.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), providers.length) }, worker),
  );
  return {
    candidates: candidates.sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id),
    ),
    failures: failures.sort((left, right) => left.provider.localeCompare(right.provider)),
    unavailable: unavailable.sort(),
  };
}

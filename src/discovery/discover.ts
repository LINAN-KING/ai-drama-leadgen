import type { MediaProvider, MediaCandidate, SearchRequest } from "../media-providers/types.js";
import { runPool } from "../scheduler/pool.js";

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
  const results = await runPool(
    providers,
    () => Math.min(Math.max(1, concurrency), providers.length),
    async (provider) => {
      if (!(await provider.isAvailable()))
        return { provider: provider.id, unavailable: true as const };
      return { provider: provider.id, candidates: await provider.search(request) };
    },
  );
  const candidates: MediaCandidate[] = [];
  const failures: DiscoveryResult["failures"] = [];
  const unavailable: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failures.push({
        provider: providers[index]!.id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    } else if ("unavailable" in result.value) {
      unavailable.push(result.value.provider);
    } else {
      candidates.push(...result.value.candidates);
    }
  }
  return {
    candidates: candidates.sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id),
    ),
    failures: failures.sort((left, right) => left.provider.localeCompare(right.provider)),
    unavailable: unavailable.sort(),
  };
}

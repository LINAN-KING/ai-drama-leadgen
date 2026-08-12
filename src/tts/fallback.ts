import type { TtsProvider, TtsProviderId, TtsSynthesisRequest } from "./types.js";

export interface TtsRunResult {
  requested: TtsProviderId;
  actual: TtsProviderId;
  failures: Array<{ provider: TtsProviderId; error: string }>;
}

export async function synthesizeWithFallback(
  requested: TtsProviderId,
  providers: Record<TtsProviderId, TtsProvider>,
  request: TtsSynthesisRequest,
  consecutiveFailures: Map<TtsProviderId, number>,
  failureThreshold = 2,
): Promise<TtsRunResult> {
  const alternate: TtsProviderId = requested === "edge" ? "mimo" : "edge";
  const order: TtsProviderId[] =
    (consecutiveFailures.get(requested) ?? 0) >= failureThreshold
      ? [alternate, requested]
      : [requested, alternate];
  const failures: TtsRunResult["failures"] = [];
  for (const id of order) {
    const provider = providers[id];
    if (!(await provider.isAvailable())) {
      failures.push({ provider: id, error: "unavailable" });
      continue;
    }
    try {
      await provider.synthesize(request);
      consecutiveFailures.set(id, 0);
      return { requested, actual: id, failures };
    } catch (error) {
      consecutiveFailures.set(id, (consecutiveFailures.get(id) ?? 0) + 1);
      failures.push({
        provider: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new Error(
    `All TTS providers failed: ${failures.map((item) => `${item.provider}:${item.error}`).join("; ")}`,
  );
}

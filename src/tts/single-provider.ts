import type { TtsProvider, TtsProviderId, TtsSegment } from "./types.js";

export interface SingleProviderNarrationResult {
  requested: TtsProviderId;
  actual: TtsProviderId;
  outputs: string[];
  failures: Array<{ provider: TtsProviderId; error: string }>;
}

export async function synthesizeSingleProvider(options: {
  requested: TtsProviderId;
  providers: Record<TtsProviderId, TtsProvider>;
  segments: TtsSegment[];
  synthesizeSegment(provider: TtsProvider, segment: TtsSegment): Promise<string>;
}): Promise<SingleProviderNarrationResult> {
  const alternate: TtsProviderId = options.requested === "edge" ? "mimo" : "edge";
  const failures: SingleProviderNarrationResult["failures"] = [];
  for (const id of [options.requested, alternate]) {
    const provider = options.providers[id];
    if (!(await provider.isAvailable())) {
      failures.push({ provider: id, error: "unavailable" });
      continue;
    }
    const outputs: string[] = [];
    try {
      for (const segment of options.segments)
        outputs.push(await options.synthesizeSegment(provider, segment));
      return { requested: options.requested, actual: id, outputs, failures };
    } catch (error) {
      failures.push({
        provider: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new Error(
    `All TTS providers failed: ${failures.map(({ provider, error }) => `${provider}:${error}`).join("; ")}`,
  );
}

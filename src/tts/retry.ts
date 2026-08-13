import type { TtsProvider, TtsSynthesisRequest } from "./types.js";

const TRANSIENT_TTS_ERROR =
  /NoAudioReceived|\b(?:408|429|5\d\d)\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|timed? out|timeout|rate.?limit|temporar(?:y|ily)|connection (?:closed|reset)/i;

export function isTransientTtsError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message}\n${error.cause ?? ""}` : String(error);
  return TRANSIENT_TTS_ERROR.test(message);
}

export async function synthesizeWithRetry(
  provider: TtsProvider,
  request: TtsSynthesisRequest,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 500);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await provider.synthesize(request);
      return;
    } catch (error) {
      if (attempt === attempts || !isTransientTtsError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

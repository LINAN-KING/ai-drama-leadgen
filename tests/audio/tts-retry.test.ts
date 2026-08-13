import { describe, expect, it, vi } from "vitest";
import { synthesizeWithRetry } from "../../src/tts/retry.js";
import type { TtsProvider } from "../../src/tts/types.js";

const request = {
  segment: { id: "a", text: "测试", index: 0 },
  outputPath: "test.wav",
  voiceStyle: "professional",
  speed: 1,
};

function provider(synthesize: TtsProvider["synthesize"]): TtsProvider {
  return { id: "edge", isAvailable: async () => true, synthesize };
}

describe("TTS transient recovery", () => {
  it("retries a bounded transient provider failure", async () => {
    const synthesize = vi
      .fn<TtsProvider["synthesize"]>()
      .mockRejectedValueOnce(new Error("NoAudioReceived"))
      .mockResolvedValueOnce();
    await synthesizeWithRetry(provider(synthesize), request, { delayMs: 0 });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent provider failure", async () => {
    const synthesize = vi.fn<TtsProvider["synthesize"]>().mockRejectedValue(new Error("bad voice"));
    await expect(
      synthesizeWithRetry(provider(synthesize), request, { delayMs: 0 }),
    ).rejects.toThrow("bad voice");
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});

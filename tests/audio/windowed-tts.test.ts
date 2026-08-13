import { describe, expect, it, vi } from "vitest";
import { synthesizeWithinWindow } from "../../src/tts/windowed.js";

describe("window-bounded TTS", () => {
  it("retries at 1.1 speed and returns only a fitting segment", async () => {
    const synthesize = vi.fn(async () => undefined);
    const durations = [2.2, 1.8];
    const result = await synthesizeWithinWindow({
      provider: {
        id: "edge",
        async isAvailable() {
          return true;
        },
        async synthesize() {},
      },
      segment: { id: "sentence", text: "测试", index: 0 },
      outputDirectory: "tmp",
      outputStem: "sentence",
      voiceStyle: "professional",
      windowSeconds: 2,
      synthesize,
      normalize: async () => undefined,
      probeDuration: async () => durations.shift()!,
    });
    expect(result.speed).toBe(1.1);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("fails when repair audio still exceeds the sentence window", async () => {
    await expect(
      synthesizeWithinWindow({
        provider: {
          id: "mimo",
          async isAvailable() {
            return true;
          },
          async synthesize() {},
        },
        segment: { id: "sentence", text: "测试", index: 0 },
        outputDirectory: "tmp",
        outputStem: "repair",
        voiceStyle: "professional",
        windowSeconds: 1,
        synthesize: async () => undefined,
        normalize: async () => undefined,
        probeDuration: async () => 1.2,
      }),
    ).rejects.toThrow(/window is 1.000s/);
  });
});

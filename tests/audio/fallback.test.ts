import { describe, expect, it } from "vitest";
import { synthesizeWithFallback } from "../../src/tts/fallback.js";
import type { TtsProvider } from "../../src/tts/types.js";

function provider(id: "edge" | "mimo", fails: boolean): TtsProvider {
  return {
    id,
    async isAvailable() {
      return true;
    },
    async synthesize() {
      if (fails) throw new Error("provider-error");
    },
  };
}

describe("TTS provider fallback", () => {
  it("switches provider and records the actual provider", async () => {
    const result = await synthesizeWithFallback(
      "mimo",
      { mimo: provider("mimo", true), edge: provider("edge", false) },
      {
        segment: { id: "s1", text: "测试", index: 0 },
        outputPath: "x.wav",
        voiceStyle: "professional",
        speed: 1,
      },
      new Map(),
    );
    expect(result.actual).toBe("edge");
    expect(result.failures[0]).toMatchObject({ provider: "mimo" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { EdgeProvider } from "../../src/tts/providers.js";

describe("Edge TTS provider", () => {
  it("applies speed locally instead of using the unstable cloud rate", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const provider = new EdgeProvider("edge-tts", runner);
    await provider.synthesize({
      segment: { id: "a", text: "每个节点都能检查、重试和继续。", index: 0 },
      outputPath: "output.wav",
      voiceStyle: "professional",
      speed: 1.1,
    });
    expect(runner).toHaveBeenNthCalledWith(
      1,
      "edge-tts",
      expect.arrayContaining(["--rate", "+0%"]),
      120_000,
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      "ffmpeg",
      expect.arrayContaining(["-filter:a", "atempo=1.100", "output.wav"]),
      120_000,
    );
  });
});

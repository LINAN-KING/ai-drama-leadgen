import { describe, expect, it } from "vitest";
import { synthesizeSingleProvider } from "../../src/tts/single-provider.js";
import type { TtsProvider } from "../../src/tts/types.js";

function provider(id: "edge" | "mimo", calls: string[], failText?: string): TtsProvider {
  return {
    id,
    async isAvailable() {
      return true;
    },
    async synthesize(request) {
      calls.push(`${id}:${request.segment.text}`);
      if (request.segment.text === failText) throw new Error(`${id} failed`);
    },
  };
}

describe("single-provider narration", () => {
  it("rerenders the whole narration with the alternate provider after one segment fails", async () => {
    const calls: string[] = [];
    const result = await synthesizeSingleProvider({
      requested: "mimo",
      providers: {
        mimo: provider("mimo", calls, "second"),
        edge: provider("edge", calls),
      },
      segments: [
        { id: "a", text: "first", index: 0 },
        { id: "b", text: "second", index: 1 },
      ],
      async synthesizeSegment(provider, segment) {
        await provider.synthesize({
          segment,
          outputPath: `${provider.id}-${segment.id}.wav`,
          voiceStyle: "professional",
          speed: 1,
        });
        return `${provider.id}-${segment.id}.wav`;
      },
    });
    expect(result.actual).toBe("edge");
    expect(result.outputs).toEqual(["edge-a.wav", "edge-b.wav"]);
    expect(calls).toEqual(["mimo:first", "mimo:second", "edge:first", "edge:second"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transcribeSectionsWithWhisper } from "../../src/alignment/whisper.js";

describe("section-aware Whisper alignment", () => {
  it("extracts final-audio windows and offsets their word timestamps", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "whisper-sections-"));
    const extract = vi.fn(async () => undefined);
    const transcribe = vi.fn(async (_audio, _output, _model, prompt) => [
      { text: prompt ?? "", start: 0.1, end: 0.4 },
    ]);
    const words = await transcribeSectionsWithWhisper(
      "aligned.wav",
      outputDirectory,
      [
        { id: "a", narration: "第一句", start: 2, end: 4 },
        { id: "b", narration: "第二句", start: 5, end: 8 },
      ],
      "small",
      { extract, transcribe },
    );
    expect(extract).toHaveBeenNthCalledWith(
      1,
      "aligned.wav",
      expect.stringContaining("section-00.wav"),
      2,
      2,
    );
    expect(transcribe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("section-01.wav"),
      expect.stringContaining("section-01"),
      "small",
      "第二句",
    );
    expect(words).toEqual([
      { text: "第一句", start: 2.1, end: 2.4 },
      { text: "第二句", start: 5.1, end: 5.4 },
    ]);
  });
});

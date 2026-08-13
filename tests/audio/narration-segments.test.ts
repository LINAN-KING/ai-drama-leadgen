import { describe, expect, it } from "vitest";
import { createNarrationSegments } from "../../src/tts/narration-segments.js";

describe("natural narration segmentation", () => {
  it("allocates stable sentence windows inside each parent scene", () => {
    const segments = createNarrationSegments([
      { id: "hook", start: 2, end: 8, narration: "先生成分镜，再锁定角色。完成视频！" },
    ]);
    expect(segments.map((segment) => segment.id)).toEqual([
      "hook-sentence-01",
      "hook-sentence-02",
      "hook-sentence-03",
    ]);
    expect(segments[0]!.start).toBe(2);
    expect(segments.at(-1)!.end).toBe(8);
    expect(
      segments.every((segment, index) => index === 0 || segment.start === segments[index - 1]!.end),
    ).toBe(true);
  });
});

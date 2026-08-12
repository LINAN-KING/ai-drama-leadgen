import { describe, expect, it } from "vitest";
import { toAss } from "../../src/captions/ass.js";

describe("ASS subtitle layout", () => {
  it("uses an explicit portrait canvas, safe baseline, and CTA style", () => {
    const ass = toAss(
      [
        {
          id: "a",
          text: "普通字幕",
          start: 1,
          end: 2,
          words: [],
          mode: "phrase",
          baselinePercent: 22,
        },
        {
          id: "b",
          text: "评论漫剧",
          start: 37,
          end: 40,
          words: [],
          mode: "phrase",
          baselinePercent: 22,
        },
      ],
      "9:16",
      37,
    );
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("{\\pos(540,1498)}普通字幕");
    expect(ass).toContain(",CTA,");
  });
});

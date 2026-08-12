import { describe, expect, it } from "vitest";
import { cropExpression, validateEdl, type EditDecisionList } from "../../src/editing/edl.js";

describe("EDL", () => {
  it("validates continuous 0.8-3 second shots", () => {
    const edl: EditDecisionList = {
      aspectRatio: "9:16",
      fps: 30,
      duration: 4,
      shots: [
        {
          id: "a",
          sourcePath: "a.mp4",
          sourceStart: 0,
          sourceDuration: 2,
          timelineStart: 0,
          timelineDuration: 2,
          speed: 1,
          role: "hook",
        },
        {
          id: "b",
          sourcePath: "b.mp4",
          sourceStart: 0,
          sourceDuration: 2,
          timelineStart: 2,
          timelineDuration: 2,
          speed: 1,
          role: "quality",
        },
      ],
    };
    expect(validateEdl(edl)).toEqual([]);
  });

  it("keeps a supplied focus point inside the crop", () => {
    expect(cropExpression(1920, 1080, 1080, 1920, { x: 0.8, y: 0.5 })).toContain("1536-304");
    expect(cropExpression(1920, 1080, 1080, 1920)).toContain("min(iw-608\\,960-304)");
    expect(cropExpression(1080, 1920, 1920, 1080, { x: 0.5, y: 0.2 })).toContain("384-304");
  });
});

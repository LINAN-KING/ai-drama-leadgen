import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";
import { createScriptPlan } from "../../src/script/plan.js";

const config = taskConfigSchema.parse({
  mode: "leadgen",
  topic: "AI 漫剧获客",
  workflow: "提示词生成分镜，再生成角色、场景和动态镜头",
  platform: "抖音",
  targetDurationSeconds: 42,
  audience: "learners",
  ctaKind: "comment-keyword",
  ctaText: "评论漫剧，领取工作流清单",
  edgeRatio: 1,
  mimoRatio: 0,
  confirmed: true,
});

describe("script plan", () => {
  it("uses the required leadgen timing structure", () => {
    expect(
      createScriptPlan(config).sections.map(({ id, start, end }) => ({ id, start, end })),
    ).toEqual([
      { id: "hook", start: 0, end: 2 },
      { id: "quality", start: 2, end: 7 },
      { id: "workbench", start: 7, end: 18 },
      { id: "montage", start: 18, end: 32 },
      { id: "proof", start: 32, end: 37 },
      { id: "cta", start: 37, end: 42 },
    ]);
  });

  it("is deterministic per variant and preserves the user CTA", () => {
    const first = createScriptPlan(config, 3);
    expect(first).toEqual(createScriptPlan(config, 3));
    expect(first.sections.at(-1)?.narration).toBe(config.ctaText);
    expect(first).not.toEqual(createScriptPlan(config, 4));
  });
});

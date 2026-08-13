import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";

const valid = {
  mode: "leadgen",
  topic: "AI 漫剧获客",
  workflow: "从提示词生成分镜与成片",
  platform: "抖音",
  aspectRatio: "9:16",
  targetDurationSeconds: 40,
  audience: "learners",
  ctaKind: "comment-keyword",
  ctaText: "评论关键词领取流程清单",
  count: 10,
  concurrency: { jobs: 2 },
  captions: "word",
  edgeRatio: 0.7,
  mimoRatio: 0.3,
  voiceStyle: "professional",
  confirmed: true,
};

describe("taskConfigSchema", () => {
  it("applies deterministic concurrency defaults", () => {
    const parsed = taskConfigSchema.parse(valid);
    expect(parsed.concurrency.search).toBe(6);
    expect(parsed.seed).toBe(20260813);
  });

  it("rejects mixed-up count and concurrency", () => {
    const result = taskConfigSchema.safeParse({ ...valid, count: 51, concurrency: { jobs: 9 } });
    expect(result.success).toBe(false);
  });

  it("enforces mode-specific duration", () => {
    expect(taskConfigSchema.safeParse({ ...valid, targetDurationSeconds: 20 }).success).toBe(false);
    expect(
      taskConfigSchema.safeParse({ ...valid, mode: "process", targetDurationSeconds: 10 }).success,
    ).toBe(true);
  });

  it("requires TTS ratios to sum to one", () => {
    expect(taskConfigSchema.safeParse({ ...valid, edgeRatio: 0.8, mimoRatio: 0.8 }).success).toBe(
      false,
    );
  });

  it("requires explicit confirmation before side effects", () => {
    expect(taskConfigSchema.safeParse({ ...valid, confirmed: false }).success).toBe(false);
  });

  it("rejects a leadgen CTA that cannot fit the final narration window", () => {
    expect(() =>
      taskConfigSchema.parse({
        ...valid,
        ctaText: "评论区输入漫剧两个字立即领取完整制作流程和全部配套资料",
      }),
    ).toThrow(/CTA must be at most 20 characters/);
  });
});

import { describe, expect, it } from "vitest";
import { GenerationBudget, generateWithQa } from "../../src/generation/retry.js";
import type { AgnesClient } from "../../src/generation/agnes.js";

describe("bounded Agnes generation", () => {
  it("retries failed QA and changes the seed deterministically", async () => {
    const seeds: number[] = [];
    const client: AgnesClient = {
      async isAvailable() {
        return true;
      },
      async generate(request) {
        seeds.push(request.seed);
        return {
          id: String(request.seed),
          localPath: "x.mp4",
          width: 1080,
          height: 1920,
          durationSeconds: 2,
          model: "agnes",
        };
      },
    };
    const result = await generateWithQa(
      client,
      { prompt: "x", kind: "video", aspectRatio: "9:16", durationSeconds: 2, seed: 10 },
      new GenerationBudget(),
      async (artifact) => ({ passed: artifact.id === "12", reason: "bad" }),
    );
    expect(result.status).toBe("accepted");
    expect(seeds).toEqual([10, 11, 12]);
  });

  it("enforces eight generated video shots per finished video", async () => {
    const budget = new GenerationBudget(8, 1);
    for (let index = 0; index < 8; index += 1) budget.reserve("video");
    expect(() => budget.reserve("video")).toThrow("agnes-video-budget-exhausted");
  });
});

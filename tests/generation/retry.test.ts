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

  it("aborts and exhausts a client that never settles", async () => {
    let aborted = 0;
    const client: AgnesClient = {
      async isAvailable() {
        return true;
      },
      generate(_request, signal) {
        return new Promise((_resolve, reject) =>
          signal?.addEventListener(
            "abort",
            () => {
              aborted += 1;
              reject(new Error("aborted"));
            },
            { once: true },
          ),
        );
      },
    };
    const result = await generateWithQa(
      client,
      { prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 },
      new GenerationBudget(1, 2),
      async () => ({ passed: true }),
      10,
    );
    expect(result.status).toBe("exhausted");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((attempt) => attempt.reason?.includes("timeout"))).toBe(true);
    expect(aborted).toBe(2);
  });

  it("does not overlap retries when an adapter ignores abort", async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const client: AgnesClient = {
      async isAvailable() {
        return true;
      },
      async generate(request) {
        calls += 1;
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          id: String(calls),
          localPath: "ignored.mp4",
          width: 720,
          height: 1280,
          durationSeconds: request.durationSeconds,
          model: "ignores-abort",
        };
      },
    };
    const result = await generateWithQa(
      client,
      { prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 },
      new GenerationBudget(1, 2),
      async () => ({ passed: false }),
      5,
    );
    expect(result.status).toBe("exhausted");
    expect(calls).toBe(2);
    expect(peak).toBe(1);
  });

  it("returns after a bounded grace period when cancellation never settles", async () => {
    const client: AgnesClient = {
      async isAvailable() {
        return true;
      },
      generate() {
        return new Promise(() => undefined);
      },
    };
    const startedAt = Date.now();
    const result = await generateWithQa(
      client,
      { prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 },
      new GenerationBudget(1, 1),
      async () => ({ passed: true }),
      5,
      10,
    );
    expect(result.status).toBe("exhausted");
    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it("does not overlap a retry and cleans an artifact that resolves after cancellation grace", async () => {
    let resolveGeneration!: (artifact: {
      id: string;
      localPath: string;
      width: number;
      height: number;
      model: string;
      temporary: boolean;
    }) => void;
    let calls = 0;
    const cleaned: string[] = [];
    const client: AgnesClient = {
      async isAvailable() {
        return true;
      },
      generate() {
        calls += 1;
        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      },
    };
    const result = await generateWithQa(
      client,
      { prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 },
      new GenerationBudget(1, 3),
      async () => ({ passed: true }),
      5,
      5,
      async (artifact) => {
        cleaned.push(artifact.localPath);
      },
    );
    expect(result.attempts).toHaveLength(1);
    expect(calls).toBe(1);
    resolveGeneration({
      id: "late",
      localPath: "late.mp4",
      width: 720,
      height: 1280,
      model: "agnes",
      temporary: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cleaned).toEqual(["late.mp4"]);
  });

  it("cleans each rejected temporary artifact before retrying", async () => {
    const cleaned: string[] = [];
    const client: AgnesClient = {
      async isAvailable() {
        return true;
      },
      async generate(request) {
        return {
          id: String(request.seed),
          localPath: `${request.seed}.mp4`,
          width: 720,
          height: 1280,
          model: "agnes",
          temporary: true,
        };
      },
    };
    const result = await generateWithQa(
      client,
      { prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 },
      new GenerationBudget(1, 2),
      async () => ({ passed: false }),
      100,
      10,
      async (artifact) => {
        cleaned.push(artifact.localPath);
      },
    );
    expect(result.status).toBe("exhausted");
    expect(cleaned).toEqual(["1.mp4", "2.mp4"]);
  });
});

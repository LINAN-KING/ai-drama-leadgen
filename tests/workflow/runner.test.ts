import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";
import { createBatchState, runBatch } from "../../src/workflow/runner.js";
import { AdaptiveConcurrency, classifyFailure } from "../../src/scheduler/adaptive.js";
import { WorkflowStore } from "../../src/workflow/store.js";
import type { NodeHandler } from "../../src/workflow/types.js";

const config = taskConfigSchema.parse({
  mode: "process",
  topic: "测试",
  workflow: "测试工作流",
  platform: "test",
  targetDurationSeconds: 10,
  audience: "learners",
  ctaKind: "comment-keyword",
  ctaText: "评论",
  count: 10,
  concurrency: { jobs: 4 },
  edgeRatio: 1,
  mimoRatio: 0,
  confirmed: true,
});

describe("persistent workflow", () => {
  it("resumes only failed nodes and preserves succeeded outputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-"));
    let renderAvailable = false;
    const handlers: Record<string, NodeHandler> = Object.fromEntries(
      [
        "configure",
        "script",
        "discover",
        "media",
        "tts",
        "alignment",
        "captions",
        "music",
        "edl",
        "render",
        "qa",
      ].map((id) => [
        id,
        async ({ workspace }) => {
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          if (id === "render" && !renderAvailable) throw new Error("render crash");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const first = await runBatch({ ...config, count: 1 }, root, handlers);
    expect(first.jobs).toHaveLength(2);
    expect(first.jobs.every((job) => job.status === "failed")).toBe(true);
    const firstJobAttempts = first.jobs[0]!.nodes.configure.attempts;
    const failedRenderAttempts = first.jobs[0]!.nodes.render.attempts;
    const store = new WorkflowStore(root);
    renderAvailable = true;
    const resumed = await runBatch({ ...config, count: 1 }, root, handlers, await store.read());
    expect(resumed.jobs.filter((job) => job.status === "succeeded")).toHaveLength(1);
    expect(resumed.jobs[0]!.nodes.configure.attempts).toBe(firstJobAttempts);
    expect(resumed.jobs[0]!.nodes.render.attempts).toBe(failedRenderAttempts + 1);
    expect(resumed.jobs[0]!.status).toBe("succeeded");
  });

  it("caps replacement attempts at ceil(N * 1.5)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-fail-"));
    const result = await runBatch(config, root, {
      configure: async () => {
        throw new Error("always fails");
      },
    });
    expect(result.jobs).toHaveLength(15);
    expect(result.jobs.every((job) => job.status === "failed")).toBe(true);
  });

  it("halves concurrency under pressure and recovers to the user maximum", () => {
    const adaptive = new AdaptiveConcurrency(8, 8, 2);
    expect(adaptive.record("rate-limit")).toBe(4);
    expect(adaptive.record("success")).toBe(4);
    expect(adaptive.record("success")).toBe(5);
    for (let index = 0; index < 20; index += 1) adaptive.record("success");
    expect(adaptive.current).toBe(8);
  });

  it("fails closed when a workflow handler is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-missing-"));
    const result = await runBatch({ ...config, count: 1 }, root, {});
    expect(result.jobs.every((job) => job.status === "failed")).toBe(true);
    expect(result.jobs[0]!.nodes.configure.error).toContain("Missing workflow handler");
  });

  it.each([10, 50])("keeps %i successful jobs isolated", async (count) => {
    const root = await mkdtemp(path.join(os.tmpdir(), `workflow-${count}-`));
    const handlers = Object.fromEntries(
      [
        "configure",
        "script",
        "discover",
        "media",
        "tts",
        "alignment",
        "captions",
        "music",
        "edl",
        "render",
        "qa",
      ].map((id) => [
        id,
        async ({ workspace, jobId }: Parameters<NodeHandler>[0]) => {
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, jobId);
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const result = await runBatch({ ...config, count }, root, handlers);
    expect(result.jobs).toHaveLength(count);
    expect(new Set(result.jobs.map((job) => job.id))).toHaveLength(count);
    await Promise.all(
      result.jobs.map(async (job) => {
        expect(await readFile(job.nodes.qa.outputFiles[0]!, "utf8")).toBe(job.id);
      }),
    );
  });

  it("serializes concurrent state snapshots without temporary-file collisions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-store-"));
    const store = new WorkflowStore(root);
    const states = Array.from({ length: 20 }, (_, index) => ({
      ...createBatchState({ ...config, count: 1 }, `batch-${index}`),
      updatedAt: String(index).padStart(2, "0"),
    }));
    await Promise.all(states.map((state) => store.write(state)));
    expect((await store.read()).id).toBe("batch-19");
  });

  it("propagates upstream invalidation but skips a fully valid resumed job", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-hash-"));
    const calls = new Map<string, number>();
    const handlers = Object.fromEntries(
      [
        "configure",
        "script",
        "discover",
        "media",
        "tts",
        "alignment",
        "captions",
        "music",
        "edl",
        "render",
        "qa",
      ].map((id) => [
        id,
        async ({ workspace }: Parameters<NodeHandler>[0]) => {
          calls.set(id, (calls.get(id) ?? 0) + 1);
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const first = await runBatch({ ...config, count: 1 }, root, handlers);
    const store = new WorkflowStore(root);
    await runBatch({ ...config, count: 1 }, root, handlers, await store.read());
    expect([...calls.values()].every((count) => count === 1)).toBe(true);

    first.jobs[0]!.nodes.media.inputHash = "stale";
    await store.write(first);
    await runBatch({ ...config, count: 1 }, root, handlers, await store.read());
    expect(calls.get("discover")).toBe(1);
    for (const id of ["media", "tts", "alignment", "captions", "music", "edl", "render", "qa"])
      expect(calls.get(id)).toBe(2);
  });

  it("reduces launches after a rate limit and later recovers", async () => {
    const adaptive = new AdaptiveConcurrency(4, 4, 2);
    expect(classifyFailure(new Error("HTTP 429 rate limit"))).toBe("rate-limit");
    expect(adaptive.record("rate-limit")).toBe(2);
    expect(adaptive.record("success")).toBe(2);
    expect(adaptive.record("success")).toBe(3);
  });
});

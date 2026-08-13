import { access, mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";
import { createBatchState, runBatch, WORKFLOW_NODE_VERSIONS } from "../../src/workflow/runner.js";
import { AdaptiveConcurrency, classifyFailure } from "../../src/scheduler/adaptive.js";
import { WorkflowStore } from "../../src/workflow/store.js";
import { WORKFLOW_NODES, type NodeHandler } from "../../src/workflow/types.js";

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

  it.each([10, 50])(
    "keeps %i successful jobs isolated",
    async (count) => {
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
    },
    10_000,
  );

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

  it("invalidates a changed node implementation and every downstream node", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-version-"));
    const calls = new Map<string, number>();
    const handlers = Object.fromEntries(
      WORKFLOW_NODES.map((id) => [
        id,
        async ({ workspace }: Parameters<NodeHandler>[0]) => {
          calls.set(id, (calls.get(id) ?? 0) + 1);
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    await runBatch({ ...config, count: 1 }, root, handlers);
    const store = new WorkflowStore(root);
    WORKFLOW_NODE_VERSIONS.media += 1;
    try {
      await runBatch({ ...config, count: 1 }, root, handlers, await store.read());
    } finally {
      WORKFLOW_NODE_VERSIONS.media -= 1;
    }
    for (const id of ["configure", "script", "discover"]) expect(calls.get(id)).toBe(1);
    for (const id of ["media", "tts", "alignment", "captions", "music", "edl", "render", "qa"])
      expect(calls.get(id)).toBe(2);
  });

  it.each(["workflow", "platform"] as const)(
    "invalidates discovery when %s changes",
    async (field) => {
      const root = await mkdtemp(path.join(os.tmpdir(), `workflow-discovery-${field}-`));
      const calls = new Map<string, number>();
      const handlers = Object.fromEntries(
        WORKFLOW_NODES.map((id) => [
          id,
          async ({ workspace }: Parameters<NodeHandler>[0]) => {
            calls.set(id, (calls.get(id) ?? 0) + 1);
            const output = path.join(workspace, `${id}.json`);
            await writeFile(output, "{}");
            return { outputFiles: [output] };
          },
        ]),
      ) as Record<string, NodeHandler>;
      await runBatch({ ...config, count: 1 }, root, handlers);
      const store = new WorkflowStore(root);
      await runBatch(
        { ...config, count: 1, [field]: `${config[field]}-changed` },
        root,
        handlers,
        await store.read(),
      );
      expect(calls.get("configure")).toBe(2);
      expect(calls.get("script")).toBe(2);
      expect(calls.get("discover")).toBe(2);
    },
  );

  it("invalidates discovery when non-secret discovery configuration changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-discovery-config-"));
    const calls = new Map<string, number>();
    const handlers = Object.fromEntries(
      WORKFLOW_NODES.map((id) => [
        id,
        async ({ workspace }: Parameters<NodeHandler>[0]) => {
          calls.set(id, (calls.get(id) ?? 0) + 1);
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    await runBatch({ ...config, count: 1 }, root, handlers);
    const store = new WorkflowStore(root);
    const original = process.env.AGENT_REACH_SERVER;
    process.env.AGENT_REACH_SERVER = "alternate-exa";
    try {
      await runBatch({ ...config, count: 1 }, root, handlers, await store.read());
    } finally {
      if (original === undefined) delete process.env.AGENT_REACH_SERVER;
      else process.env.AGENT_REACH_SERVER = original;
    }
    expect(calls.get("discover")).toBe(2);
  });

  it("rejects persisted job IDs that could escape the jobs workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-traversal-"));
    const state = createBatchState({ ...config, count: 1 }, "batch-safe");
    state.jobs.push({
      id: "../outside",
      variant: 0,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: Object.fromEntries(
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
        ].map((id) => [id, { id, status: "pending", inputHash: "", attempts: 0, outputFiles: [] }]),
      ) as unknown as (typeof state.jobs)[number]["nodes"],
    });
    await expect(runBatch({ ...config, count: 1 }, root, {}, state)).rejects.toThrow(
      /job|batch state/i,
    );
  });

  it("reruns a corrupt output and every downstream node", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-integrity-"));
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
          await writeFile(output, `${id}-${calls.get(id)}`);
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const first = await runBatch({ ...config, count: 1 }, root, handlers);
    await writeFile(first.jobs[0]!.nodes.script.outputFiles[0]!, "corrupt");

    const store = new WorkflowStore(root);
    await runBatch({ ...config, count: 1 }, root, handlers, await store.read());

    expect(calls.get("configure")).toBe(1);
    for (const id of [
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
    ])
      expect(calls.get(id)).toBe(2);
  });

  it("rejects resume when count or user concurrency changed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-config-"));
    const state = createBatchState(
      { ...config, count: 1, concurrency: { ...config.concurrency, jobs: 2 } },
      "batch-config",
    );

    await expect(
      runBatch(
        { ...config, count: 2, concurrency: { ...config.concurrency, jobs: 2 } },
        root,
        {},
        state,
      ),
    ).rejects.toThrow(/count changed/i);
    await expect(
      runBatch(
        { ...config, count: 1, concurrency: { ...config.concurrency, jobs: 3 } },
        root,
        {},
        state,
      ),
    ).rejects.toThrow(/concurrency changed/i);
  });

  it("holds an exclusive workspace lock and releases it in finally", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-lock-"));
    let releaseConfigure!: () => void;
    let configureStarted!: () => void;
    const started = new Promise<void>((resolve) => (configureStarted = resolve));
    const release = new Promise<void>((resolve) => (releaseConfigure = resolve));
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
          if (id === "configure") {
            configureStarted();
            await release;
          }
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;

    const first = runBatch({ ...config, count: 1 }, root, handlers);
    await started;
    await expect(runBatch({ ...config, count: 1 }, root, handlers)).rejects.toThrow(
      /locked by another process/i,
    );
    releaseConfigure();
    await first;
    await expect(access(path.join(root, ".workflow.lock"))).rejects.toThrow();
  });

  it("reclaims a workflow lock whose owner process exited", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-stale-lock-"));
    const lock = path.join(root, ".workflow.lock");
    await mkdir(lock, { recursive: true });
    await writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: 2_147_483_647, acquiredAt: new Date(0).toISOString() }),
    );
    const handlers = Object.fromEntries(
      WORKFLOW_NODES.map((id) => [
        id,
        async ({ workspace }: Parameters<NodeHandler>[0]) => {
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const result = await runBatch({ ...config, count: 1 }, root, handlers);
    expect(result.jobs[0]?.status).toBe("succeeded");
    await expect(access(lock)).rejects.toThrow();
  });

  it("reclaims an expired workflow lease even when its PID was reused", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-expired-lock-"));
    const lock = path.join(root, ".workflow.lock");
    const owner = path.join(lock, "owner.json");
    await mkdir(lock, { recursive: true });
    await writeFile(
      owner,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date(0).toISOString() }),
    );
    await utimes(owner, new Date(0), new Date(0));
    const handlers = Object.fromEntries(
      WORKFLOW_NODES.map((id) => [
        id,
        async ({ workspace }: Parameters<NodeHandler>[0]) => {
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const result = await runBatch({ ...config, count: 1 }, root, handlers);
    expect(result.jobs[0]?.status).toBe("succeeded");
  });

  it("reduces launches after a rate limit and later recovers", async () => {
    const adaptive = new AdaptiveConcurrency(4, 4, 2);
    expect(classifyFailure(new Error("HTTP 429 rate limit"))).toBe("rate-limit");
    expect(adaptive.record("rate-limit")).toBe(2);
    expect(adaptive.record("success")).toBe(2);
    expect(adaptive.record("success")).toBe(3);
  });

  it("limits the next runBatch launch wave after a rate limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-adaptive-launch-"));
    let secondActive = 0;
    let secondPeak = 0;
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
        async ({ workspace, variant }: Parameters<NodeHandler>[0]) => {
          if (id === "configure") {
            if (variant === 0) throw new Error("HTTP 429 rate limit");
            if (variant <= 3) {
              await new Promise((resolve) => setTimeout(resolve, 40));
            } else {
              secondActive += 1;
              secondPeak = Math.max(secondPeak, secondActive);
              await new Promise((resolve) => setTimeout(resolve, 80));
              secondActive -= 1;
            }
          }
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    const result = await runBatch({ ...config, count: 6 }, root, handlers);
    expect(result.jobs.filter((job) => job.status === "succeeded")).toHaveLength(6);
    expect(secondPeak).toBe(2);
  }, 15_000);

  it("writes requested and actual TTS ratios for successful jobs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-tts-report-"));
    const leadgen = taskConfigSchema.parse({
      ...config,
      mode: "leadgen",
      targetDurationSeconds: 40,
      count: 2,
      concurrency: { ...config.concurrency, jobs: 1 },
    });
    const handlers = Object.fromEntries(
      WORKFLOW_NODES.map((id) => [
        id,
        async ({ workspace, variant }: Parameters<NodeHandler>[0]) => {
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          if (id === "tts")
            await writeFile(
              path.join(workspace, "tts-report.json"),
              JSON.stringify({
                requested: variant === 0 ? "edge" : "mimo",
                actual: "mimo",
              }),
            );
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    await runBatch(leadgen, root, handlers);
    const report = JSON.parse(await readFile(path.join(root, "batch-tts-report.json"), "utf8"));
    expect(report).toEqual({
      successfulJobs: 2,
      requested: { counts: { edge: 1, mimo: 1 }, ratios: { edge: 0.5, mimo: 0.5 } },
      actual: { counts: { edge: 0, mimo: 2 }, ratios: { edge: 0, mimo: 1 } },
      fallbackCount: 1,
    });
  });

  it("fails closed when a successful leadgen job lacks its TTS report", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-missing-tts-report-"));
    const leadgen = taskConfigSchema.parse({
      ...config,
      mode: "leadgen",
      targetDurationSeconds: 40,
      count: 1,
      concurrency: { ...config.concurrency, jobs: 1 },
    });
    const handlers = Object.fromEntries(
      WORKFLOW_NODES.map((id) => [
        id,
        async ({ workspace }: Parameters<NodeHandler>[0]) => {
          const output = path.join(workspace, `${id}.json`);
          await writeFile(output, "{}");
          return { outputFiles: [output] };
        },
      ]),
    ) as Record<string, NodeHandler>;
    await expect(runBatch(leadgen, root, handlers)).rejects.toThrow(/tts-report\.json/i);
  });
});

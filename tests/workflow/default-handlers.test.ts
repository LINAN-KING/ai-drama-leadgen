import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";
import {
  createDefaultHandlers,
  createWorkflowResourceLimits,
} from "../../src/workflow/default-handlers.js";
import type { MediaProvider } from "../../src/media-providers/types.js";

const base = {
  mode: "process" as const,
  topic: "测试",
  workflow: "测试流程",
  platform: "test",
  targetDurationSeconds: 10,
  audience: "learners" as const,
  ctaKind: "comment-keyword" as const,
  ctaText: "评论",
  edgeRatio: 1,
  mimoRatio: 0,
  confirmed: true as const,
};

describe("default workflow handlers", () => {
  it("enforces configured resource peaks across concurrent jobs", async () => {
    const config = taskConfigSchema.parse({
      ...base,
      concurrency: { download: 2, agnes: 1, qa: 3, render: 1 },
    });
    const limits = createWorkflowResourceLimits(config.concurrency);
    for (const [kind, expected] of [
      ["download", 2],
      ["agnes", 1],
      ["qa", 3],
      ["render", 1],
    ] as const) {
      let active = 0;
      let peak = 0;
      await Promise.all(
        Array.from({ length: 7 }, () =>
          limits[kind].run(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
          }),
        ),
      );
      expect(peak).toBe(expected);
    }
  });

  it("writes real process configuration and scene plan", async () => {
    const config = taskConfigSchema.parse(base);
    const handlers = createDefaultHandlers(config, { providers: [] });
    const workspace = await mkdtemp(path.join(os.tmpdir(), "default-handlers-"));
    const context = {
      batchId: "b",
      jobId: "j",
      variant: 0,
      workspace,
      node: "configure" as const,
    };
    await handlers.configure(context);
    await handlers.script({ ...context, node: "script" });
    expect(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8"))).toMatchObject({
      mode: "process",
    });
    expect(
      JSON.parse(await readFile(path.join(workspace, "scene-plan.json"), "utf8")),
    ).toMatchObject({ duration: 10 });
  });

  it("fails leadgen closed without a licensed media provider", async () => {
    const config = taskConfigSchema.parse({ ...base, mode: "leadgen", targetDurationSeconds: 40 });
    const handlers = createDefaultHandlers(config);
    const workspace = await mkdtemp(path.join(os.tmpdir(), "leadgen-handlers-"));
    await expect(
      handlers.discover({ batchId: "b", jobId: "j", variant: 0, workspace, node: "discover" }),
    ).rejects.toThrow("No licensed media provider");
  });

  it("shares discovery across jobs while writing independent reports", async () => {
    let searches = 0;
    const provider: MediaProvider = {
      id: "shared",
      tier: "free",
      async isAvailable() {
        return true;
      },
      async search() {
        searches += 1;
        return [];
      },
    };
    const config = taskConfigSchema.parse({
      ...base,
      mode: "leadgen",
      targetDurationSeconds: 40,
      concurrency: { jobs: 2 },
    });
    const handlers = createDefaultHandlers(config, {
      providers: [provider],
      agnes: {
        async isAvailable() {
          return true;
        },
        async generate() {
          throw new Error("unused");
        },
      },
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "shared-discovery-"));
    const workspaces = [path.join(root, "a"), path.join(root, "b")];
    await Promise.all(
      workspaces.map(async (workspace, variant) => {
        await mkdir(workspace, { recursive: true });
        return handlers.discover({
          batchId: "b",
          jobId: `j-${variant}`,
          variant,
          workspace,
          node: "discover",
        });
      }),
    );
    expect(searches).toBe(1);
    const reports = await Promise.all(
      workspaces.map((workspace) =>
        readFile(path.join(workspace, "discovery-report.json"), "utf8"),
      ),
    );
    expect(reports[0]).toBe(reports[1]);
  });

  it("evicts a failed shared discovery so a later job can retry", async () => {
    let availabilityChecks = 0;
    const provider: MediaProvider = {
      id: "retryable",
      tier: "free",
      async isAvailable() {
        return true;
      },
      async search() {
        return [];
      },
    };
    const config = taskConfigSchema.parse({
      ...base,
      mode: "leadgen",
      targetDurationSeconds: 40,
    });
    const handlers = createDefaultHandlers(config, {
      providers: [provider],
      agnes: {
        async isAvailable() {
          availabilityChecks += 1;
          if (availabilityChecks === 1) throw new Error("temporary discovery failure");
          return true;
        },
        async generate() {
          throw new Error("unused");
        },
      },
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "retry-discovery-"));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await Promise.all([mkdir(first), mkdir(second)]);
    await expect(
      handlers.discover({
        batchId: "b",
        jobId: "j1",
        variant: 0,
        workspace: first,
        node: "discover",
      }),
    ).rejects.toThrow("temporary discovery failure");
    await expect(
      handlers.discover({
        batchId: "b",
        jobId: "j2",
        variant: 1,
        workspace: second,
        node: "discover",
      }),
    ).resolves.toBeDefined();
    expect(availabilityChecks).toBe(2);
  });

  it("renders one shared workbench and materializes independent job artifacts", async () => {
    let renders = 0;
    const config = taskConfigSchema.parse({ ...base, concurrency: { jobs: 2, render: 1 } });
    const handlers = createDefaultHandlers(config, {
      providers: [],
      async renderWorkbench(_config, workspace) {
        renders += 1;
        await mkdir(path.join(workspace, "hyperframes-project"), { recursive: true });
        await Promise.all([
          writeFile(path.join(workspace, "process-video.mp4"), "video"),
          writeFile(path.join(workspace, "preview.png"), "preview"),
          writeFile(path.join(workspace, "hyperframes-project", "index.html"), "project"),
        ]);
        return [path.join(workspace, "process-video.mp4"), path.join(workspace, "preview.png")];
      },
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "shared-workbench-"));
    const workspaces = [path.join(root, "a"), path.join(root, "b")];
    const results = await Promise.all(
      workspaces.map((workspace, variant) =>
        handlers.render({
          batchId: "b",
          jobId: `j-${variant}`,
          variant,
          workspace,
          node: "render",
        }),
      ),
    );
    expect(renders).toBe(1);
    const [first, second] = results;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.outputFiles).not.toEqual(second!.outputFiles);
    for (const workspace of workspaces) {
      expect(await readFile(path.join(workspace, "process-video.mp4"), "utf8")).toBe("video");
      expect(await readFile(path.join(workspace, "preview.png"), "utf8")).toBe("preview");
    }
  });

  it("rerenders a failed shared workbench once within the same call", async () => {
    let renders = 0;
    const config = taskConfigSchema.parse(base);
    const handlers = createDefaultHandlers(config, {
      providers: [],
      async renderWorkbench(_config, workspace) {
        renders += 1;
        if (renders === 1) throw new Error("temporary render failure");
        await mkdir(workspace, { recursive: true });
        await Promise.all([
          writeFile(path.join(workspace, "process-video.mp4"), "video"),
          writeFile(path.join(workspace, "preview.png"), "preview"),
        ]);
        return [path.join(workspace, "process-video.mp4"), path.join(workspace, "preview.png")];
      },
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "retry-workbench-"));
    const workspace = path.join(root, "a");
    await expect(
      handlers.render({
        batchId: "b",
        jobId: "j1",
        variant: 0,
        workspace,
        node: "render",
      }),
    ).resolves.toBeDefined();
    expect(renders).toBe(2);
    expect(await readFile(path.join(workspace, "process-video.mp4"), "utf8")).toBe("video");
  });

  it("rerenders once when a resolved shared workbench loses an artifact", async () => {
    let renders = 0;
    const config = taskConfigSchema.parse(base);
    const handlers = createDefaultHandlers(config, {
      providers: [],
      async renderWorkbench(_config, workspace) {
        renders += 1;
        await mkdir(workspace, { recursive: true });
        await Promise.all([
          writeFile(path.join(workspace, "process-video.mp4"), `video-${renders}`),
          writeFile(path.join(workspace, "preview.png"), `preview-${renders}`),
        ]);
        return [path.join(workspace, "process-video.mp4"), path.join(workspace, "preview.png")];
      },
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "lost-workbench-"));
    await handlers.render({
      batchId: "b",
      jobId: "j1",
      variant: 0,
      workspace: path.join(root, "a"),
      node: "render",
    });
    await rm(path.join(root, ".shared-workbench", "process-video.mp4"));
    const workspace = path.join(root, "b");
    await handlers.render({ batchId: "b", jobId: "j2", variant: 1, workspace, node: "render" });
    expect(renders).toBe(2);
    expect(await readFile(path.join(workspace, "process-video.mp4"), "utf8")).toBe("video-2");
  });
});

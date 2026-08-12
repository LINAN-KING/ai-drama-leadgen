import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";
import { createDefaultHandlers } from "../../src/workflow/default-handlers.js";

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
  it("writes real process configuration and scene plan", async () => {
    const config = taskConfigSchema.parse(base);
    const handlers = createDefaultHandlers(config);
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
});

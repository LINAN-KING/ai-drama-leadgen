import path from "node:path";
import { readTaskConfig } from "../../config/files.js";
import { runBatch } from "../../workflow/runner.js";
import { WorkflowStore } from "../../workflow/store.js";
import { createDefaultHandlers } from "../../workflow/default-handlers.js";

export async function runGenerate(configPath: string, workspace: string): Promise<void> {
  const config = await readTaskConfig(configPath);
  const single = { ...config, count: 1 };
  const state = await runBatch(single, workspace, createDefaultHandlers(single));
  process.stdout.write(
    `Workspace: ${path.resolve(workspace)}\nSuccessful jobs: ${state.jobs.filter((job) => job.status === "succeeded").length}\n`,
  );
  if (state.jobs.filter((job) => job.status === "succeeded").length < 1) process.exitCode = 1;
}

export async function runBatchCommand(configPath: string, workspace: string): Promise<void> {
  const config = await readTaskConfig(configPath);
  const state = await runBatch(config, workspace, createDefaultHandlers(config));
  process.stdout.write(
    `Workspace: ${path.resolve(workspace)}\nSuccessful jobs: ${state.jobs.filter((job) => job.status === "succeeded").length}/${config.count}\n`,
  );
  if (state.jobs.filter((job) => job.status === "succeeded").length < config.count)
    process.exitCode = 1;
}

export async function runResume(configPath: string, workspace: string): Promise<void> {
  const config = await readTaskConfig(configPath);
  const store = new WorkflowStore(workspace);
  const state = await runBatch(
    config,
    workspace,
    createDefaultHandlers(config),
    await store.read(),
  );
  process.stdout.write(
    `Resumed: ${path.resolve(workspace)}\nSuccessful jobs: ${state.jobs.filter((job) => job.status === "succeeded").length}/${config.count}\n`,
  );
  if (state.jobs.filter((job) => job.status === "succeeded").length < config.count)
    process.exitCode = 1;
}

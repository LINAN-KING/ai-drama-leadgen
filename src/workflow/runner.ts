import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { TaskConfig } from "../config/schema.js";
import { AdaptiveConcurrency, classifyFailure } from "../scheduler/adaptive.js";
import { inputHash } from "./hash.js";
import { WorkflowStore } from "./store.js";
import {
  WORKFLOW_NODES,
  type BatchState,
  type JobState,
  type NodeHandler,
  type WorkflowNodeId,
} from "./types.js";

const now = () => new Date().toISOString();

function nodeInput(config: TaskConfig, variant: number, node: WorkflowNodeId): unknown {
  const common = { mode: config.mode, variant };
  switch (node) {
    case "configure":
      return config;
    case "script":
      return {
        ...common,
        topic: config.topic,
        workflow: config.workflow,
        duration: config.targetDurationSeconds,
        audience: config.audience,
        customAudience: config.customAudience,
        ctaKind: config.ctaKind,
        ctaText: config.ctaText,
        seed: config.seed,
      };
    case "discover":
    case "media":
      return {
        ...common,
        topic: config.topic,
        aspectRatio: config.aspectRatio,
        seed: config.seed,
      };
    case "tts":
      return {
        ...common,
        edgeRatio: config.edgeRatio,
        mimoRatio: config.mimoRatio,
        voiceStyle: config.voiceStyle,
      };
    case "alignment":
      return { ...common, alignmentVersion: 1 };
    case "captions":
      return { ...common, captions: config.captions, aspectRatio: config.aspectRatio };
    case "music":
      return { ...common, style: config.style, seed: config.seed };
    case "edl":
      return {
        ...common,
        aspectRatio: config.aspectRatio,
        duration: config.targetDurationSeconds,
      };
    case "render":
      return {
        ...common,
        aspectRatio: config.aspectRatio,
        duration: config.targetDurationSeconds,
        hyperframesWorkers: config.concurrency.hyperframesWorkers,
      };
    case "qa":
      return {
        ...common,
        aspectRatio: config.aspectRatio,
        duration: config.targetDurationSeconds,
        qaVersion: 1,
      };
  }
}

function nodeState(id: WorkflowNodeId) {
  return {
    id,
    status: "pending" as const,
    inputHash: "",
    attempts: 0,
    outputFiles: [] as string[],
  };
}
function createJob(batchId: string, variant: number): JobState {
  return {
    id: `${batchId}-job-${String(variant + 1).padStart(3, "0")}`,
    variant,
    status: "pending",
    createdAt: now(),
    updatedAt: now(),
    nodes: Object.fromEntries(WORKFLOW_NODES.map((id) => [id, nodeState(id)])) as JobState["nodes"],
  };
}

export function createBatchState(config: TaskConfig, batchId: string): BatchState {
  return {
    id: batchId,
    requestedCount: config.count,
    maxAttempts: Math.ceil(config.count * 1.5),
    createdAt: now(),
    updatedAt: now(),
    jobs: [],
    currentConcurrency: config.concurrency.jobs,
    userConcurrency: config.concurrency.jobs,
  };
}

async function outputsExist(files: string[]): Promise<boolean> {
  if (!files.length) return false;
  return (
    await Promise.all(
      files.map(async (file) => {
        try {
          await access(file);
          return true;
        } catch {
          return false;
        }
      }),
    )
  ).every(Boolean);
}

export async function runJob(
  state: BatchState,
  job: JobState,
  config: TaskConfig,
  store: WorkflowStore,
  handlers: Partial<Record<WorkflowNodeId, NodeHandler>>,
): Promise<JobState> {
  job.status = "running";
  let upstreamChanged = false;
  for (const id of WORKFLOW_NODES) {
    const node = job.nodes[id];
    const hash = inputHash(nodeInput(config, job.variant, id));
    if (
      !upstreamChanged &&
      node.status === "succeeded" &&
      node.inputHash === hash &&
      (await outputsExist(node.outputFiles))
    )
      continue;
    upstreamChanged = true;
    node.status = "running";
    node.inputHash = hash;
    node.attempts += 1;
    node.startedAt = now();
    delete node.error;
    await store.write({ ...state, updatedAt: now() });
    try {
      const handler = handlers[id];
      if (!handler) throw new Error(`Missing workflow handler: ${id}`);
      const workspace = path.join(store.workspace, "jobs", job.id);
      await mkdir(workspace, { recursive: true });
      const result = await handler({
        batchId: state.id,
        jobId: job.id,
        variant: job.variant,
        workspace,
        node: id,
      });
      node.status = "succeeded";
      node.outputFiles = result.outputFiles;
      node.completedAt = now();
    } catch (error) {
      node.status = "failed";
      node.error = error instanceof Error ? error.message : String(error);
      node.completedAt = now();
      job.status = "failed";
      job.updatedAt = now();
      await store.write({ ...state, updatedAt: now() });
      throw error;
    }
  }
  job.status = "succeeded";
  job.updatedAt = now();
  await store.write({ ...state, updatedAt: now() });
  return job;
}

export async function runBatch(
  config: TaskConfig,
  workspace: string,
  handlers: Partial<Record<WorkflowNodeId, NodeHandler>>,
  existing?: BatchState,
): Promise<BatchState> {
  const batchId = existing?.id ?? `batch-${config.seed}-${Date.now()}`;
  const state = existing ?? createBatchState(config, batchId);
  const store = new WorkflowStore(workspace);
  const adaptive = new AdaptiveConcurrency(state.userConcurrency, state.currentConcurrency);
  let nextVariant = state.jobs.length;
  for (const job of state.jobs.filter((candidate) => candidate.status === "succeeded")) {
    try {
      await runJob(state, job, config, store, handlers);
      adaptive.record("success");
    } catch (error) {
      adaptive.record(classifyFailure(error, process.memoryUsage().rss / os.totalmem()));
    }
    state.currentConcurrency = adaptive.current;
  }
  const queued = state.jobs.filter(
    (candidate) => candidate.status === "failed" || candidate.status === "running",
  );
  const active = new Set<Promise<void>>();
  const succeeded = () => state.jobs.filter((job) => job.status === "succeeded").length;

  const launch = (job: JobState) => {
    const task = runJob(state, job, config, store, handlers)
      .then(() => {
        adaptive.record("success");
      })
      .catch((error: unknown) => {
        adaptive.record(classifyFailure(error, process.memoryUsage().rss / os.totalmem()));
      })
      .finally(() => {
        state.currentConcurrency = adaptive.current;
        active.delete(task);
      });
    active.add(task);
  };

  while (succeeded() < state.requestedCount) {
    while (
      active.size < adaptive.current &&
      succeeded() + active.size < state.requestedCount &&
      (queued.length > 0 || state.jobs.length < state.maxAttempts)
    ) {
      const job = queued.shift() ?? createJob(state.id, nextVariant++);
      if (!state.jobs.includes(job)) {
        state.jobs.push(job);
        await store.write(state);
      }
      launch(job);
    }
    if (!active.size) break;
    await Promise.race(active);
  }
  await Promise.all(active);
  state.updatedAt = now();
  await store.write(state);
  return state;
}

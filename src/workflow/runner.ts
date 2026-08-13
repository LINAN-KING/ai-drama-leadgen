import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
  type OutputIntegrity,
  type WorkflowNodeId,
  parseBatchState,
} from "./types.js";
import type { TtsProviderId } from "../tts/types.js";

const now = () => new Date().toISOString();

export const WORKFLOW_NODE_VERSIONS: Record<WorkflowNodeId, number> = {
  configure: 1,
  script: 1,
  discover: 2,
  media: 2,
  tts: 4,
  alignment: 4,
  captions: 1,
  music: 2,
  edl: 2,
  render: 2,
  qa: 2,
};

function nodeInput(config: TaskConfig, variant: number, node: WorkflowNodeId): unknown {
  const common = {
    mode: config.mode,
    variant,
    implementationVersion: WORKFLOW_NODE_VERSIONS[node],
  };
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
        workflow: config.workflow,
        platform: config.platform,
        aspectRatio: config.aspectRatio,
        seed: config.seed,
        discoveryConfiguration: {
          agentReachServer: process.env.AGENT_REACH_SERVER ?? "exa",
          firecrawlUrl: process.env.FIRECRAWL_URL ?? null,
          firecrawlConfigured: Boolean(process.env.FIRECRAWL_API_KEY),
          searxngUrl: process.env.SEARXNG_URL ?? null,
          crawl4aiEnabled: true,
          crawl4aiPython: process.env.DRAMA_LEADGEN_PYTHON ?? null,
          pexelsConfigured: Boolean(process.env.PEXELS_API_KEY),
          pixabayConfigured: Boolean(process.env.PIXABAY_API_KEY),
          europeanaConfigured: Boolean(process.env.EUROPEANA_API_KEY),
          smithsonianConfigured: Boolean(process.env.SMITHSONIAN_API_KEY),
        },
      };
    case "tts":
      return {
        ...common,
        edgeRatio: config.edgeRatio,
        mimoRatio: config.mimoRatio,
        voiceStyle: config.voiceStyle,
      };
    case "alignment":
      return common;
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

async function fileIntegrity(file: string): Promise<OutputIntegrity> {
  const metadata = await stat(file);
  if (!metadata.isFile()) throw new Error(`Workflow output is not a file: ${file}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { path: file, size: metadata.size, sha256: hash.digest("hex") };
}

async function outputsAreValid(node: JobState["nodes"][WorkflowNodeId]): Promise<boolean> {
  if (
    !node.outputFiles.length ||
    !node.outputIntegrity ||
    node.outputIntegrity.length !== node.outputFiles.length
  )
    return false;
  try {
    const actual = await Promise.all(node.outputFiles.map(fileIntegrity));
    return actual.every((output, index) => {
      const expected = node.outputIntegrity![index]!;
      return (
        expected.path === output.path &&
        expected.size === output.size &&
        expected.sha256 === output.sha256
      );
    });
  } catch {
    return false;
  }
}

function jobWorkspace(workspace: string, job: JobState): string {
  const jobsRoot = path.resolve(workspace, "jobs");
  const resolved = path.resolve(jobsRoot, job.id);
  if (path.dirname(resolved) !== jobsRoot) {
    throw new Error(`Unsafe job ID would escape the jobs workspace: ${job.id}`);
  }
  return resolved;
}

async function writeBatchTtsReport(
  config: TaskConfig,
  workspace: string,
  state: BatchState,
): Promise<void> {
  if (config.mode !== "leadgen") return;
  const successfulJobs = state.jobs.filter((candidate) => candidate.status === "succeeded");
  const reports = await Promise.all(
    successfulJobs.map(async (job) => {
      const report = JSON.parse(
        await readFile(path.join(jobWorkspace(workspace, job), "tts-report.json"), "utf8"),
      ) as { requested?: unknown; actual?: unknown };
      if (
        (report.requested !== "edge" && report.requested !== "mimo") ||
        (report.actual !== "edge" && report.actual !== "mimo")
      )
        throw new Error(`Invalid TTS report for successful job: ${job.id}`);
      return report as { requested: TtsProviderId; actual: TtsProviderId };
    }),
  );
  const counts = (field: "requested" | "actual") => ({
    edge: reports.filter((report) => report[field] === "edge").length,
    mimo: reports.filter((report) => report[field] === "mimo").length,
  });
  const ratios = (values: { edge: number; mimo: number }) => ({
    edge: reports.length ? Number((values.edge / reports.length).toFixed(6)) : 0,
    mimo: reports.length ? Number((values.mimo / reports.length).toFixed(6)) : 0,
  });
  const requestedCounts = counts("requested");
  const actualCounts = counts("actual");
  await writeFile(
    path.join(workspace, "batch-tts-report.json"),
    `${JSON.stringify(
      {
        successfulJobs: reports.length,
        requested: { counts: requestedCounts, ratios: ratios(requestedCounts) },
        actual: { counts: actualCounts, ratios: ratios(actualCounts) },
        fallbackCount: reports.filter((report) => report.requested !== report.actual).length,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function assertResumeCompatible(config: TaskConfig, state: BatchState): void {
  if (state.requestedCount !== config.count) {
    throw new Error(
      `Cannot resume batch: requested count changed from ${state.requestedCount} to ${config.count}`,
    );
  }
  if (state.userConcurrency !== config.concurrency.jobs) {
    throw new Error(
      `Cannot resume batch: job concurrency changed from ${state.userConcurrency} to ${config.concurrency.jobs}`,
    );
  }
}

async function acquireWorkspaceLock(workspace: string): Promise<() => Promise<void>> {
  await mkdir(workspace, { recursive: true });
  const lockPath = path.join(workspace, ".workflow.lock");
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let ownerPid: number | undefined;
      let heartbeatExpired = false;
      try {
        const ownerPath = path.join(lockPath, "owner.json");
        ownerPid = (
          JSON.parse(await readFile(ownerPath, "utf8")) as {
            pid?: number;
          }
        ).pid;
        heartbeatExpired = Date.now() - (await stat(ownerPath)).mtimeMs > 60_000;
      } catch {
        throw new Error(`Workflow workspace is locked by another process: ${workspace}`);
      }
      let ownerExited = false;
      if (typeof ownerPid === "number") {
        try {
          process.kill(ownerPid, 0);
        } catch (processError) {
          ownerExited = (processError as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
      if (!ownerExited && !heartbeatExpired)
        throw new Error(`Workflow workspace is locked by another process: ${workspace}`);
      const stalePath = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw renameError;
      }
      await rm(stalePath, { recursive: true, force: true });
    }
  }
  const ownerPath = path.join(lockPath, "owner.json");
  try {
    await writeFile(
      ownerPath,
      `${JSON.stringify({ pid: process.pid, acquiredAt: now() }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  const heartbeat = setInterval(() => {
    void writeFile(
      ownerPath,
      `${JSON.stringify({ pid: process.pid, acquiredAt: now() })}\n`,
      "utf8",
    ).catch(() => undefined);
  }, 10_000);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    await rm(lockPath, { recursive: true, force: true });
  };
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
      (await outputsAreValid(node))
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
      const workspace = jobWorkspace(store.workspace, job);
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
      node.outputIntegrity = await Promise.all(result.outputFiles.map(fileIntegrity));
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
  const releaseLock = await acquireWorkspaceLock(workspace);
  try {
    const batchId = existing?.id ?? `batch-${config.seed}-${Date.now()}`;
    const state = existing ? parseBatchState(existing) : createBatchState(config, batchId);
    if (existing) assertResumeCompatible(config, state);
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
    await writeBatchTtsReport(config, workspace, state);
    return state;
  } finally {
    await releaseLock();
  }
}

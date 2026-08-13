import { z } from "zod";

export const WORKFLOW_NODES = [
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
] as const;
export type WorkflowNodeId = (typeof WORKFLOW_NODES)[number];
export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "invalidated";

export interface OutputIntegrity {
  path: string;
  size: number;
  sha256: string;
}

export interface NodeState {
  id: WorkflowNodeId;
  status: NodeStatus;
  inputHash: string;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  outputFiles: string[];
  outputIntegrity?: OutputIntegrity[];
  error?: string;
}
export interface JobState {
  id: string;
  variant: number;
  status: "pending" | "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  nodes: Record<WorkflowNodeId, NodeState>;
}
export interface BatchState {
  id: string;
  requestedCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  jobs: JobState[];
  currentConcurrency: number;
  userConcurrency: number;
}

export interface NodeContext {
  batchId: string;
  jobId: string;
  variant: number;
  workspace: string;
  node: WorkflowNodeId;
}
export type NodeHandler = (
  context: NodeContext,
) => Promise<{ outputFiles: string[]; value?: unknown }>;

const timestampSchema = z.string().min(1);
const outputIntegritySchema = z
  .object({
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const nodeStateSchema = z
  .object({
    id: z.enum(WORKFLOW_NODES),
    status: z.enum(["pending", "running", "succeeded", "failed", "invalidated"]),
    inputHash: z.string(),
    attempts: z.number().int().nonnegative(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    outputFiles: z.array(z.string().min(1)),
    outputIntegrity: z.array(outputIntegritySchema).optional(),
    error: z.string().optional(),
  })
  .strict();
const jobStateSchema = z
  .object({
    id: z.string().regex(/^batch-[A-Za-z0-9_-]+-job-\d{3,}$/),
    variant: z.number().int().nonnegative(),
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    nodes: z.object(
      Object.fromEntries(WORKFLOW_NODES.map((id) => [id, nodeStateSchema])) as {
        [K in WorkflowNodeId]: typeof nodeStateSchema;
      },
    ),
  })
  .strict();
const batchStateSchema = z
  .object({
    id: z.string().regex(/^batch-[A-Za-z0-9_-]+$/),
    requestedCount: z.number().int().min(1).max(50),
    maxAttempts: z.number().int().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    jobs: z.array(jobStateSchema),
    currentConcurrency: z.number().int().min(1).max(8),
    userConcurrency: z.number().int().min(1).max(8),
  })
  .strict()
  .superRefine((state, context) => {
    const ids = new Set<string>();
    state.jobs.forEach((job, index) => {
      const expectedId = `${state.id}-job-${String(job.variant + 1).padStart(3, "0")}`;
      if (job.id !== expectedId) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "id"],
          message: `job ID must be ${expectedId}`,
        });
      }
      if (ids.has(job.id)) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "id"],
          message: "job IDs must be unique",
        });
      }
      ids.add(job.id);
      for (const nodeId of WORKFLOW_NODES) {
        if (job.nodes[nodeId].id !== nodeId) {
          context.addIssue({
            code: "custom",
            path: ["jobs", index, "nodes", nodeId, "id"],
            message: `node ID must be ${nodeId}`,
          });
        }
      }
    });
    if (state.maxAttempts !== Math.ceil(state.requestedCount * 1.5)) {
      context.addIssue({
        code: "custom",
        path: ["maxAttempts"],
        message: "maxAttempts must equal ceil(requestedCount * 1.5)",
      });
    }
    if (state.currentConcurrency > state.userConcurrency) {
      context.addIssue({
        code: "custom",
        path: ["currentConcurrency"],
        message: "currentConcurrency cannot exceed userConcurrency",
      });
    }
  });

export function parseBatchState(value: unknown): BatchState {
  return batchStateSchema.parse(value) as BatchState;
}

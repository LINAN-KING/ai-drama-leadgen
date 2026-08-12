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

export interface NodeState {
  id: WorkflowNodeId;
  status: NodeStatus;
  inputHash: string;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  outputFiles: string[];
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

import type { AgnesClient, AgnesRequest, AgnesArtifact } from "./agnes.js";

export interface GenerationAttempt {
  attempt: number;
  artifact?: AgnesArtifact;
  accepted: boolean;
  reason?: string;
}
export interface GenerationOutcome {
  status: "accepted" | "exhausted" | "unavailable";
  artifact?: AgnesArtifact;
  attempts: GenerationAttempt[];
}

export class GenerationBudget {
  private usedVideoShots = 0;
  constructor(
    readonly maxVideoShots = 8,
    readonly maxAttemptsPerShot = 3,
  ) {}
  reserve(kind: AgnesRequest["kind"]): void {
    if (kind === "video") {
      if (this.usedVideoShots >= this.maxVideoShots)
        throw new Error("agnes-video-budget-exhausted");
      this.usedVideoShots += 1;
    }
  }
  get videoShotsUsed(): number {
    return this.usedVideoShots;
  }
}

export async function generateWithQa(
  client: AgnesClient,
  request: AgnesRequest,
  budget: GenerationBudget,
  qa: (artifact: AgnesArtifact) => Promise<{ passed: boolean; reason?: string }>,
): Promise<GenerationOutcome> {
  if (!(await client.isAvailable())) return { status: "unavailable", attempts: [] };
  budget.reserve(request.kind);
  const attempts: GenerationAttempt[] = [];
  for (let attempt = 1; attempt <= budget.maxAttemptsPerShot; attempt += 1) {
    try {
      const artifact = await client.generate({ ...request, seed: request.seed + attempt - 1 });
      const result = await qa(artifact);
      attempts.push({ attempt, artifact, accepted: result.passed, reason: result.reason });
      if (result.passed) return { status: "accepted", artifact, attempts };
    } catch (error) {
      attempts.push({
        attempt,
        accepted: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { status: "exhausted", attempts };
}

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
  attemptTimeoutMs = 120_000,
  cancellationGraceMs = 5_000,
): Promise<GenerationOutcome> {
  if (!(await client.isAvailable())) return { status: "unavailable", attempts: [] };
  budget.reserve(request.kind);
  const attempts: GenerationAttempt[] = [];
  for (let attempt = 1; attempt <= budget.maxAttemptsPerShot; attempt += 1) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let generation: Promise<AgnesArtifact> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`agnes-attempt-timeout-${attemptTimeoutMs}ms`));
          controller.abort();
        }, attemptTimeoutMs);
      });
      generation = client.generate(
        { ...request, seed: request.seed + attempt - 1 },
        controller.signal,
      );
      const artifact = await Promise.race([generation, timeout]);
      const result = await qa(artifact);
      attempts.push({ attempt, artifact, accepted: result.passed, reason: result.reason });
      if (result.passed) return { status: "accepted", artifact, attempts };
    } catch (error) {
      attempts.push({
        attempt,
        accepted: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (timedOut && generation) {
        try {
          await Promise.race([
            generation,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`agnes-cancellation-timeout-${cancellationGraceMs}ms`)),
                cancellationGraceMs,
              ),
            ),
          ]);
        } catch {
          // Preserve the timeout as the attempt result after cancellation settles.
        }
      }
    }
  }
  return { status: "exhausted", attempts };
}

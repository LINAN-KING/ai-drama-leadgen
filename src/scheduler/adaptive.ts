export type PressureSignal = "success" | "rate-limit" | "memory" | "render-error" | "other-error";

export class AdaptiveConcurrency {
  private stableSuccesses = 0;
  current: number;
  constructor(
    readonly maximum: number,
    initial = maximum,
    readonly recoveryWindow = 5,
  ) {
    this.current = Math.min(Math.max(1, initial), maximum);
  }
  record(signal: PressureSignal): number {
    if (["rate-limit", "memory", "render-error"].includes(signal)) {
      this.current = Math.max(1, Math.floor(this.current / 2));
      this.stableSuccesses = 0;
    } else if (signal === "success") {
      this.stableSuccesses += 1;
      if (this.stableSuccesses >= this.recoveryWindow && this.current < this.maximum) {
        this.current += 1;
        this.stableSuccesses = 0;
      }
    } else this.stableSuccesses = 0;
    return this.current;
  }
}

export function classifyFailure(error: unknown, memoryUsageRatio = 0): PressureSignal {
  const message = error instanceof Error ? error.message : String(error);
  if (memoryUsageRatio > 0.8) return "memory";
  if (/\b429\b|rate.?limit/i.test(message)) return "rate-limit";
  if (/render|chrome|capture/i.test(message)) return "render-error";
  return "other-error";
}

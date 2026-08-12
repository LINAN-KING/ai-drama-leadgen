export type CapabilityStatus = "available" | "missing" | "manual-action" | "optional";

export interface CapabilityResult {
  id: string;
  label: string;
  status: CapabilityStatus;
  detail: string;
  version?: string;
  path?: string;
}

export interface CommandResult<T> {
  ok: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
}

export function success<T>(data: T, warnings: string[] = []): CommandResult<T> {
  return { ok: true, data, errors: [], warnings };
}

export function failure<T = never>(errors: string[], warnings: string[] = []): CommandResult<T> {
  return { ok: false, errors, warnings };
}

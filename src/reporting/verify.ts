import { access } from "node:fs/promises";
import path from "node:path";

export interface ArtifactVerification {
  complete: boolean;
  present: string[];
  missing: string[];
}

export async function verifyArtifacts(
  directory: string,
  required: readonly string[],
): Promise<ArtifactVerification> {
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of required) {
    try {
      await access(path.join(directory, name));
      present.push(name);
    } catch {
      missing.push(name);
    }
  }
  return { complete: missing.length === 0, present, missing };
}

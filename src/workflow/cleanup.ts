import { rm } from "node:fs/promises";
import path from "node:path";

const TEMPORARY_DIRECTORIES = [
  "downloads",
  "narration-segments",
  "whisper",
  "render-work",
] as const;

export async function cleanupJobIntermediates(workspace: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of TEMPORARY_DIRECTORIES) {
    const target = path.join(workspace, name);
    await rm(target, { recursive: true, force: true });
    removed.push(target);
  }
  return removed;
}

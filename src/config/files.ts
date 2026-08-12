import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskConfigSchema, type TaskConfig } from "./schema.js";

export async function readTaskConfig(filePath: string): Promise<TaskConfig> {
  const text = await readFile(filePath, "utf8");
  return taskConfigSchema.parse(JSON.parse(text));
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

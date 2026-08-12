import { readFile } from "node:fs/promises";
import path from "node:path";
import { taskConfigSchema } from "../../config/schema.js";
import { writeJson } from "../../config/files.js";

export async function runConfigure(input: string, output: string): Promise<void> {
  const source = JSON.parse(await readFile(input, "utf8"));
  const config = taskConfigSchema.parse(source);
  await writeJson(output, config);
  process.stdout.write(`Validated configuration: ${path.resolve(output)}\n`);
}

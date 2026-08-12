import path from "node:path";
import process from "node:process";
import { mkdir, readFile } from "node:fs/promises";
import { taskConfigSchema } from "../dist/config/schema.js";
import { createDefaultHandlers } from "../dist/workflow/default-handlers.js";

const config = taskConfigSchema.parse(
  JSON.parse(await readFile("tests/fixtures/leadgen-config.json", "utf8")),
);
const workspace = path.resolve(process.argv[2] ?? "workspaces/e2e-leadgen-audio");
await mkdir(workspace, { recursive: true });
const handlers = createDefaultHandlers(config);
const context = { batchId: "audio-e2e", jobId: "audio-e2e-job", variant: 0, workspace };
for (const node of ["configure", "script", "tts", "alignment", "captions", "music"])
  await handlers[node]({ ...context, node });
process.stdout.write(`${workspace}\n`);

import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { taskConfigSchema } from "../dist/config/schema.js";
import { createDefaultHandlers } from "../dist/workflow/default-handlers.js";

const workspace = path.resolve(process.argv[2] ?? "workspaces/e2e-leadgen-full");
const config = taskConfigSchema.parse(
  JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")),
);
const handlers = createDefaultHandlers(config);
const context = { batchId: "rerender", jobId: "rerender-job", variant: 0, workspace };
for (const node of ["captions", "render", "qa"]) await handlers[node]({ ...context, node });
process.stdout.write(`${workspace}\n`);

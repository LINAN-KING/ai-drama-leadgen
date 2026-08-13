import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { taskConfigSchema } from "../dist/config/schema.js";
import { createDefaultHandlers } from "../dist/workflow/default-handlers.js";
import { alignTranscript } from "../dist/alignment/match.js";

const workspace = path.resolve(process.argv[2] ?? "workspaces/e2e-leadgen-audio-v3");
const config = taskConfigSchema.parse(
  JSON.parse(await readFile("tests/fixtures/leadgen-config.json", "utf8")),
);
const plan = JSON.parse(await readFile(path.join(workspace, "scene-plan.json"), "utf8"));
const whisper = JSON.parse(
  await readFile(path.join(workspace, "whisper", "narration.json"), "utf8"),
);
const transcript = whisper.segments.flatMap((segment) =>
  (segment.words ?? []).map((word) => ({
    text: word.word ?? word.text,
    start: word.start,
    end: word.end,
    confidence: word.probability,
  })),
);
const report = alignTranscript(
  plan.sections.map((section) => section.narration).join(""),
  transcript,
);
if (!report.passed) throw new Error(`Offline alignment failed: ${report.failures.join(", ")}`);
await writeFile(
  path.join(workspace, "alignment-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
const handlers = createDefaultHandlers(config);
const context = { batchId: "audio-e2e", jobId: "audio-e2e-job", variant: 0, workspace };
for (const node of ["captions", "music"]) await handlers[node]({ ...context, node });
process.stdout.write(
  `${JSON.stringify({ coverage: report.coverage, medianTimingResolutionMs: report.medianTimingResolutionMs, substitutionRate: report.substitutionRate })}\n`,
);

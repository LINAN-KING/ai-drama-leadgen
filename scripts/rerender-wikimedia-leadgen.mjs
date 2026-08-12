import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { taskConfigSchema } from "../dist/config/schema.js";
import { WikimediaProvider } from "../dist/media-providers/wikimedia.js";
import { createDefaultHandlers } from "../dist/workflow/default-handlers.js";

const workspace = path.resolve(process.argv[2] ?? "workspaces/e2e-leadgen-wikimedia");
const sourceWorkspace = path.resolve("workspaces/e2e-leadgen-full");
const config = taskConfigSchema.parse(
  JSON.parse(await readFile(path.join(sourceWorkspace, "config.json"), "utf8")),
);
const base = new WikimediaProvider();
const provider = {
  id: base.id,
  tier: base.tier,
  async isAvailable() {
    return true;
  },
  async search(request, signal) {
    const queries = [
      "Chinese mythology dragon painting",
      "Chinese immortal landscape painting",
      "phoenix Asian art painting",
    ];
    const results = [];
    for (const query of queries)
      results.push(...(await base.search({ ...request, kind: "image", limit: 50, query }, signal)));
    return [...new Map(results.map((candidate) => [candidate.id, candidate])).values()];
  },
};
const handlers = createDefaultHandlers(config, {
  providers: [provider],
  assetLibraryRoot: path.join(workspace, "asset-library"),
});
const context = { batchId: "commons-e2e", jobId: "commons-e2e-job", variant: 0, workspace };
for (const name of [
  "config.json",
  "scene-plan.json",
  "narration.wav",
  "alignment-report.json",
  "captions.json",
  "subtitle.srt",
  "subtitle.ass",
  "final-mix.wav",
  "audio-quality-report.json",
  "process-video.mp4",
  "preview.png",
])
  await import("node:fs/promises").then(({ copyFile, mkdir }) =>
    mkdir(workspace, { recursive: true }).then(() =>
      copyFile(path.join(sourceWorkspace, name), path.join(workspace, name)),
    ),
  );
for (const node of ["discover", "media", "edl", "render", "qa"])
  await handlers[node]({ ...context, node });
process.stdout.write(`${workspace}\n`);

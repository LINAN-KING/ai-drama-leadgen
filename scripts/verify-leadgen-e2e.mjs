import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { taskConfigSchema } from "../dist/config/schema.js";
import { createDefaultHandlers } from "../dist/workflow/default-handlers.js";

const exec = promisify(execFile);
const config = taskConfigSchema.parse(
  JSON.parse(await readFile("tests/fixtures/leadgen-config.json", "utf8")),
);
const workspace = path.resolve(process.argv[2] ?? "workspaces/e2e-leadgen-full");
const sourceDirectory = path.join(workspace, "agnes-sources");
await mkdir(sourceDirectory, { recursive: true });
let generated = 0;
const agnes = {
  async isAvailable() {
    return true;
  },
  async generate(request) {
    const index = generated++;
    const output = path.join(sourceDirectory, `shot-${index + 1}.mp4`);
    const hue = (index * 41) % 360;
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=720x1280:rate=30:duration=${request.durationSeconds ?? 3}`,
      "-vf",
      `hue=h=${hue},drawbox=x=mod(t*${80 + index * 7}\\,w):y=${80 + index * 90}:w=180:h=180:color=0xF05A47@0.8:t=fill`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      output,
    ]);
    return {
      id: `local-${index + 1}`,
      localPath: output,
      width: 720,
      height: 1280,
      durationSeconds: request.durationSeconds ?? 3,
      model: "local-qa-generator",
    };
  },
};
const handlers = createDefaultHandlers(config, {
  providers: [],
  agnes,
  assetLibraryRoot: path.join(workspace, "asset-library"),
});
const context = { batchId: "leadgen-e2e", jobId: "leadgen-e2e-job", variant: 0, workspace };
for (const node of [
  "configure",
  "script",
  "discover",
  "media",
  "tts",
  "alignment",
  "captions",
  "music",
  "edl",
  "render",
  "qa",
])
  await handlers[node]({ ...context, node });
process.stdout.write(`${workspace}\n`);

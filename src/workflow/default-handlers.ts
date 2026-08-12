import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskConfig } from "../config/schema.js";
import { createScriptPlan } from "../script/plan.js";
import { createProviderCatalog } from "../media-providers/catalog.js";
import { analyzeMedia } from "../media-qa/analyze.js";
import { REQUIRED_PROCESS_ARTIFACTS } from "../reporting/artifacts.js";
import { verifyArtifacts } from "../reporting/verify.js";
import { runBinary } from "../ffmpeg/process.js";
import type { NodeHandler, WorkflowNodeId } from "./types.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

async function json(filePath: string, value: unknown): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function file(workspace: string, name: string) {
  return path.join(workspace, name);
}

export function createDefaultHandlers(config: TaskConfig): Record<WorkflowNodeId, NodeHandler> {
  return {
    configure: async ({ workspace }) => ({
      outputFiles: [await json(file(workspace, "config.json"), config)],
    }),
    script: async ({ workspace, variant }) => ({
      outputFiles: [
        await json(file(workspace, "scene-plan.json"), createScriptPlan(config, variant)),
      ],
    }),
    discover: async ({ workspace }) => {
      const availability = await Promise.all(
        createProviderCatalog().map(async (provider) => ({
          id: provider.id,
          tier: provider.tier,
          available: await provider.isAvailable(),
        })),
      );
      if (config.mode === "leadgen" && !availability.some((item) => item.available)) {
        throw new Error(
          "No licensed media provider or Agnes is available. Configure PEXELS_API_KEY, PIXABAY_API_KEY, or AGNES_API_KEY.",
        );
      }
      return {
        outputFiles: [await json(file(workspace, "discovery-report.json"), { availability })],
      };
    },
    media: async ({ workspace }) => ({
      outputFiles: [
        await json(file(workspace, "media-manifest.json"), {
          mode: config.mode,
          assets: [],
          note:
            config.mode === "process"
              ? "Process compositions contain generated UI only."
              : "Media acquisition must be supplied by configured providers.",
        }),
      ],
    }),
    tts: async ({ workspace }) => {
      if (config.mode === "leadgen") {
        throw new Error(
          "Leadgen TTS requires an available Edge TTS command or MiMo credential and must generate real WAV segments.",
        );
      }
      return {
        outputFiles: [
          await json(file(workspace, "audio-quality-report.json"), { applicable: false }),
        ],
      };
    },
    alignment: async ({ workspace }) => ({
      outputFiles: [await json(file(workspace, "alignment-report.json"), { applicable: false })],
    }),
    captions: async ({ workspace }) => ({
      outputFiles: [await json(file(workspace, "captions.json"), { applicable: false, cues: [] })],
    }),
    music: async ({ workspace }) => ({
      outputFiles: [await json(file(workspace, "music-report.json"), { applicable: false })],
    }),
    edl: async ({ workspace }) => ({
      outputFiles: [await json(file(workspace, "edit-decision.json"), { applicable: false })],
    }),
    render: async ({ workspace }) => {
      if (config.mode !== "process") {
        throw new Error(
          "Leadgen render requires a complete licensed EDL, narration, captions, and mix.",
        );
      }
      const ratio = config.aspectRatio.replace(":", "x");
      const project = path.join(packageRoot, "templates", "generated", `workflow-${ratio}`);
      const output = file(workspace, "process-video.mp4");
      const hyperframesCli = path.join(
        packageRoot,
        "node_modules",
        "hyperframes",
        "bin",
        "hyperframes.mjs",
      );
      await runBinary(
        process.execPath,
        [
          hyperframesCli,
          "render",
          project,
          "--output",
          output,
          "--fps",
          "30",
          "--quality",
          "draft",
          "--workers",
          String(config.concurrency.hyperframesWorkers),
          "--strict",
          "--quiet",
        ],
        600_000,
      );
      const preview = file(workspace, "preview.png");
      await runBinary("ffmpeg", ["-y", "-ss", "8", "-i", output, "-frames:v", "1", preview]);
      return { outputFiles: [output, preview] };
    },
    qa: async ({ workspace }) => {
      if (config.mode !== "process")
        throw new Error("Leadgen QA cannot pass without a final leadgen video.");
      const video = file(workspace, "process-video.mp4");
      const report = await analyzeMedia(video, {
        minWidth: 720,
        minHeight: 720,
        minDurationSeconds: 9.8,
        maxDurationSeconds: 10.2,
        maxBlackRatio: 0.05,
        maxFreezeRatio: 0.95,
      });
      const qualityPath = await json(file(workspace, "media-quality-report.json"), report);
      if (!report.passed)
        throw new Error(`Process video failed QA: ${report.hardFailures.join(", ")}`);
      const generationReport = file(workspace, "generation-report.md");
      await writeFile(
        generationReport,
        `# Generation Report\n\n- Mode: process\n- QA: passed\n- Duration: ${report.probe.durationSeconds}s\n- Canvas: ${report.probe.width}x${report.probe.height}\n`,
        "utf8",
      );
      const completeness = await verifyArtifacts(workspace, REQUIRED_PROCESS_ARTIFACTS);
      if (!completeness.complete) {
        throw new Error(`Missing process artifacts: ${completeness.missing.join(", ")}`);
      }
      return { outputFiles: [qualityPath, generationReport] };
    },
  };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskConfig } from "../config/schema.js";
import { writeJson } from "../config/files.js";
import { createScriptPlan, type ScriptPlan } from "../script/plan.js";
import { createProviderCatalog } from "../media-providers/catalog.js";
import type { MediaProvider } from "../media-providers/types.js";
import { AssetLibrary } from "../media-providers/library.js";
import { analyzeMedia } from "../media-qa/analyze.js";
import { analyzeFinalVideo } from "../media-qa/final.js";
import { REQUIRED_LEADGEN_ARTIFACTS, REQUIRED_PROCESS_ARTIFACTS } from "../reporting/artifacts.js";
import { verifyArtifacts } from "../reporting/verify.js";
import { runBinary } from "../ffmpeg/process.js";
import { renderEdl } from "../ffmpeg/render.js";
import { probeMedia } from "../media-qa/probe.js";
import type { AgnesClient } from "../generation/agnes.js";
import {
  discoverLeadgenMedia,
  acquireLeadgenMedia,
  type LeadgenDiscovery,
  type FrozenMediaAsset,
} from "./leadgen-media.js";
import { EdgeProvider, MimoProvider } from "../tts/providers.js";
import type { TtsProvider, TtsProviderId } from "../tts/types.js";
import { allocateProviders } from "../tts/scheduler.js";
import { synthesizeWithFallback } from "../tts/fallback.js";
import { normalizeNarration } from "../tts/audio.js";
import { placeNarrationSegments } from "../tts/timeline.js";
import { transcribeWithWhisper } from "../alignment/whisper.js";
import { alignTranscript } from "../alignment/match.js";
import { buildCaptions, toSrt } from "../captions/build.js";
import { toAss } from "../captions/ass.js";
import { analyzeAudio } from "../audio-qa/analyze.js";
import {
  generateProceduralEffects,
  generateProceduralMusic,
  PROCEDURAL_AUDIO_LICENSE,
} from "../music/procedural.js";
import { mixNarrationMusicAndEffects } from "../music/mix.js";
import { snapToBeat } from "../music/beats.js";
import { createLeadgenEdl } from "../editing/leadgen-edl.js";
import type { EditDecisionList } from "../editing/edl.js";
import type { NodeHandler, WorkflowNodeId } from "./types.js";
import { cleanupJobIntermediates } from "./cleanup.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
export interface WorkflowDependencies {
  providers?: MediaProvider[];
  agnes?: AgnesClient;
  ttsProviders?: Record<TtsProviderId, TtsProvider>;
  transcribe?: typeof transcribeWithWhisper;
  assetLibraryRoot?: string;
}

async function json(filePath: string, value: unknown): Promise<string> {
  return writeJson(filePath, value);
}
async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
function file(workspace: string, name: string) {
  return path.join(workspace, name);
}

async function renderWorkbench(config: TaskConfig, workspace: string): Promise<[string, string]> {
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
  return [output, preview];
}

export function createDefaultHandlers(
  config: TaskConfig,
  dependencies: WorkflowDependencies = {},
): Record<WorkflowNodeId, NodeHandler> {
  const providers = dependencies.providers ?? createProviderCatalog();
  const ttsProviders = dependencies.ttsProviders ?? {
    edge: new EdgeProvider(),
    mimo: new MimoProvider(),
  };
  const transcribe = dependencies.transcribe ?? transcribeWithWhisper;
  const ttsFailures = new Map<TtsProviderId, number>();
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
      if (config.mode === "process") {
        const availability = await Promise.all(
          providers.map(async (provider) => ({
            id: provider.id,
            tier: provider.tier,
            available: await provider.isAvailable(),
          })),
        );
        return {
          outputFiles: [await json(file(workspace, "discovery-report.json"), { availability })],
        };
      }
      const discovery = await discoverLeadgenMedia(config, providers);
      const agnesAvailable = dependencies.agnes ? await dependencies.agnes.isAvailable() : false;
      if (!discovery.candidates.length && !agnesAvailable)
        throw new Error(
          `No licensed media provider or Agnes is available. Configure PEXELS_API_KEY, PIXABAY_API_KEY, or an Agnes adapter.${discovery.failures.length ? ` Provider failures: ${discovery.failures.map((item) => `${item.provider}:${item.error}`).join("; ")}` : ""}`,
        );
      return {
        outputFiles: [
          await json(file(workspace, "discovery-report.json"), { ...discovery, agnesAvailable }),
        ],
      };
    },
    media: async ({ workspace, variant }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await json(file(workspace, "media-manifest.json"), {
              mode: config.mode,
              assets: [],
              note: "Process compositions contain generated UI only.",
            }),
          ],
        };
      const discovery = await readJson<LeadgenDiscovery>(file(workspace, "discovery-report.json"));
      const library = new AssetLibrary(
        dependencies.assetLibraryRoot ?? path.join(packageRoot, ".asset-library"),
      );
      const result = await acquireLeadgenMedia({
        config,
        variant,
        discovery,
        workspace,
        library,
        agnes: dependencies.agnes,
        required: 8,
      });
      if (result.assets.length < 8)
        throw new Error(`Insufficient qualified licensed media: ${result.gaps.join("; ")}`);
      return {
        outputFiles: [
          await json(file(workspace, "media-manifest.json"), {
            mode: "leadgen",
            assets: result.assets,
            gaps: result.gaps,
          }),
        ],
      };
    },
    tts: async ({ workspace, variant }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await json(file(workspace, "audio-quality-report.json"), { applicable: false }),
          ],
        };
      const plan = await readJson<ScriptPlan>(file(workspace, "scene-plan.json"));
      const requested = allocateProviders(config.count, config.edgeRatio, config.mimoRatio)[
        variant % config.count
      ]!;
      const segmentDirectory = file(workspace, "narration-segments");
      await mkdir(segmentDirectory, { recursive: true });
      const timeline: Array<{
        path: string;
        start: number;
        requested: TtsProviderId;
        actual: TtsProviderId;
      }> = [];
      for (const [index, section] of plan.sections.entries()) {
        const window = section.end - section.start;
        let outcome!: Awaited<ReturnType<typeof synthesizeWithFallback>>;
        let normalized = "";
        let duration = Number.POSITIVE_INFINITY;
        for (const [attempt, speed] of [1, 1.1].entries()) {
          const raw = path.join(
            segmentDirectory,
            `${String(index).padStart(2, "0")}-attempt-${attempt + 1}-raw.wav`,
          );
          normalized = path.join(segmentDirectory, `${String(index).padStart(2, "0")}.wav`);
          outcome = await synthesizeWithFallback(
            requested,
            ttsProviders,
            {
              segment: { id: section.id, text: section.narration, index },
              outputPath: raw,
              voiceStyle: config.voiceStyle,
              speed,
            },
            ttsFailures,
          );
          await normalizeNarration(raw, normalized);
          const probe = await runBinary("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            normalized,
          ]);
          duration = Number(probe.stdout.trim());
          if (Number.isFinite(duration) && duration <= window + 0.05) break;
        }
        if (!Number.isFinite(duration) || duration > window + 0.05)
          throw new Error(
            `Narration segment ${section.id} is ${duration.toFixed(3)}s after two attempts but its scene window is ${window.toFixed(3)}s`,
          );
        timeline.push({
          path: normalized,
          start: section.start,
          requested,
          actual: outcome.actual,
        });
      }
      const narration = file(workspace, "narration.wav");
      await placeNarrationSegments(timeline, config.targetDurationSeconds, narration);
      const report = await analyzeAudio(narration, -16, 2);
      if (!report.passed)
        throw new Error(`Narration failed audio QA: ${report.failures.join(", ")}`);
      return {
        outputFiles: [
          narration,
          await json(file(workspace, "tts-report.json"), { requested, timeline, qa: report }),
        ],
      };
    },
    alignment: async ({ workspace }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await json(file(workspace, "alignment-report.json"), { applicable: false }),
          ],
        };
      const plan = await readJson<ScriptPlan>(file(workspace, "scene-plan.json"));
      const source = plan.sections.map((section) => section.narration).join("");
      const words = await transcribe(file(workspace, "narration.wav"), file(workspace, "whisper"));
      const report = alignTranscript(source, words);
      if (!report.passed)
        throw new Error(`Narration alignment failed: ${report.failures.join(", ")}`);
      return { outputFiles: [await json(file(workspace, "alignment-report.json"), report)] };
    },
    captions: async ({ workspace }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await json(file(workspace, "captions.json"), { applicable: false, cues: [] }),
          ],
        };
      const alignment = await readJson<ReturnType<typeof alignTranscript>>(
        file(workspace, "alignment-report.json"),
      );
      const cues = buildCaptions(alignment.words, config.captions);
      const captions = await json(file(workspace, "captions.json"), {
        mode: config.captions,
        baselinePercent: 22,
        cues,
      });
      const subtitle = file(workspace, "subtitle.srt");
      await writeFile(subtitle, toSrt(cues), "utf8");
      const subtitleAss = file(workspace, "subtitle.ass");
      const plan = await readJson<ScriptPlan>(file(workspace, "scene-plan.json"));
      await writeFile(
        subtitleAss,
        toAss(
          cues,
          config.aspectRatio,
          plan.sections.find((section) => section.id === "cta")?.start,
        ),
        "utf8",
      );
      return { outputFiles: [captions, subtitle, subtitleAss] };
    },
    music: async ({ workspace, variant }) => {
      if (config.mode === "process")
        return {
          outputFiles: [await json(file(workspace, "music-report.json"), { applicable: false })],
        };
      const music = file(workspace, "music.wav");
      await generateProceduralMusic(music, config.targetDurationSeconds, config.seed + variant);
      const effects = await generateProceduralEffects(
        file(workspace, "effects"),
        6,
        config.seed + variant,
      );
      const beats = Array.from(
        { length: Math.ceil(config.targetDurationSeconds * 2) },
        (_, index) => index * 0.5,
      );
      const placements = effects.map((effectPath, index) => ({
        path: effectPath,
        start: snapToBeat(1.5 + index * 6.5, beats, 0.12),
        volume: 0.12,
      }));
      const mix = file(workspace, "final-mix.wav");
      await mixNarrationMusicAndEffects(
        file(workspace, "narration.wav"),
        music,
        placements,
        config.targetDurationSeconds,
        mix,
      );
      const qa = await analyzeAudio(mix, -14, 2);
      if (!qa.passed) throw new Error(`Final mix failed audio QA: ${qa.failures.join(", ")}`);
      const report = await json(file(workspace, "audio-quality-report.json"), {
        ...qa,
        music: PROCEDURAL_AUDIO_LICENSE,
        effects: effects.map((effectPath) => ({
          path: effectPath,
          license: PROCEDURAL_AUDIO_LICENSE,
        })),
      });
      return { outputFiles: [mix, report] };
    },
    edl: async ({ workspace }) => {
      if (config.mode === "process")
        return {
          outputFiles: [await json(file(workspace, "edit-decision.json"), { applicable: false })],
        };
      const [processVideo, preview] = await renderWorkbench(config, workspace);
      const plan = await readJson<ScriptPlan>(file(workspace, "scene-plan.json"));
      const manifest = await readJson<{ assets: FrozenMediaAsset[] }>(
        file(workspace, "media-manifest.json"),
      );
      const processProbe = await probeMedia(processVideo);
      const edl = createLeadgenEdl(
        config,
        plan.sections,
        manifest.assets.map((asset) => ({
          path: asset.originalPath,
          durationSeconds: asset.durationSeconds ?? asset.candidate.durationSeconds ?? 3,
        })),
        { path: processVideo, durationSeconds: processProbe.durationSeconds },
      );
      return {
        outputFiles: [
          await json(file(workspace, "edit-decision.json"), edl),
          processVideo,
          preview,
        ],
      };
    },
    render: async ({ workspace }) => {
      if (config.mode === "process") {
        const [output, preview] = await renderWorkbench(config, workspace);
        return { outputFiles: [output, preview] };
      }
      const edl = await readJson<EditDecisionList>(file(workspace, "edit-decision.json"));
      const output = file(workspace, "final-leadgen-video.mp4");
      await renderEdl(edl, {
        workDirectory: file(workspace, "render-work"),
        audioPath: file(workspace, "final-mix.wav"),
        subtitlePath: file(workspace, "subtitle.ass"),
        outputPath: output,
      });
      return { outputFiles: [output] };
    },
    qa: async ({ workspace }) => {
      if (config.mode === "process") {
        const report = await analyzeMedia(file(workspace, "process-video.mp4"), {
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
        if (!completeness.complete)
          throw new Error(`Missing process artifacts: ${completeness.missing.join(", ")}`);
        return { outputFiles: [qualityPath, generationReport] };
      }
      const finalQa = await analyzeFinalVideo(
        file(workspace, "final-leadgen-video.mp4"),
        config.aspectRatio,
        config.targetDurationSeconds,
      );
      const manifest = await readJson<{ assets: FrozenMediaAsset[] }>(
        file(workspace, "media-manifest.json"),
      );
      const captions = await readJson<{
        baselinePercent: number;
        cues: Array<{ text: string; start: number; end: number }>;
      }>(file(workspace, "captions.json"));
      const failures = [...finalQa.failures];
      if (
        manifest.assets.some(
          (asset) => !asset.license.commercialUse || !asset.license.snapshotText || !asset.sha256,
        )
      )
        failures.push("incomplete-license-manifest");
      if (
        captions.baselinePercent !== 22 ||
        captions.cues.some((cue) => cue.text.length > 14 || cue.end <= cue.start)
      )
        failures.push("invalid-caption-layout");
      const plan = await readJson<ScriptPlan>(file(workspace, "scene-plan.json"));
      if (plan.sections.find((section) => section.id === "cta")?.narration !== config.ctaText)
        failures.push("cta-not-user-supplied");
      const report = {
        ...finalQa,
        passed: failures.length === 0,
        failures: [...new Set(failures)],
      };
      const qualityPath = await json(file(workspace, "media-quality-report.json"), report);
      if (!report.passed) throw new Error(`Final video failed QA: ${report.failures.join(", ")}`);
      const generationReport = file(workspace, "generation-report.md");
      await writeFile(
        generationReport,
        `# Generation Report\n\n- Mode: leadgen\n- QA: passed\n- Duration: ${report.durationSeconds}s\n- Licensed media: ${manifest.assets.length}\n- CTA: ${config.ctaText}\n`,
        "utf8",
      );
      const completeness = await verifyArtifacts(workspace, REQUIRED_LEADGEN_ARTIFACTS);
      if (!completeness.complete)
        throw new Error(`Missing leadgen artifacts: ${completeness.missing.join(", ")}`);
      await cleanupJobIntermediates(workspace);
      return { outputFiles: [qualityPath, generationReport] };
    },
  };
}

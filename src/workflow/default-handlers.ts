import { copyFile, link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskConfig } from "../config/schema.js";
import { writeJson } from "../config/files.js";
import { createScriptPlan, type ScriptPlan } from "../script/plan.js";
import { createProviderCatalog } from "../media-providers/catalog.js";
import type { MediaProvider } from "../media-providers/types.js";
import {
  createDiscoveryPlugins,
  createDiscoveryReferenceReaders,
  type DiscoveryPlugin,
  type DiscoveryReferenceReader,
} from "../discovery/plugins.js";
import { AssetLibrary } from "../media-providers/library.js";
import { analyzeMedia } from "../media-qa/analyze.js";
import { analyzeFinalVideo } from "../media-qa/final.js";
import { REQUIRED_LEADGEN_ARTIFACTS, REQUIRED_PROCESS_ARTIFACTS } from "../reporting/artifacts.js";
import { verifyArtifacts } from "../reporting/verify.js";
import { runBinary } from "../ffmpeg/process.js";
import { renderEdl } from "../ffmpeg/render.js";
import { probeMedia } from "../media-qa/probe.js";
import type { AgnesClient } from "../generation/agnes.js";
import { AgnesApiClient } from "../generation/agnes-client.js";
import {
  discoverLeadgenMedia,
  acquireLeadgenMedia,
  type LeadgenDiscovery,
  type FrozenMediaAsset,
} from "./leadgen-media.js";
import { EdgeProvider, MimoProvider } from "../tts/providers.js";
import type { TtsProvider, TtsProviderId } from "../tts/types.js";
import { allocateProviders } from "../tts/scheduler.js";
import { synthesizeSingleProvider } from "../tts/single-provider.js";
import { createNarrationSegments } from "../tts/narration-segments.js";
import { synthesizeWithinWindow } from "../tts/windowed.js";
import { placeNarrationSegments } from "../tts/timeline.js";
import { transcribeSectionsWithWhisper, transcribeWithWhisper } from "../alignment/whisper.js";
import type { alignTranscript } from "../alignment/match.js";
import { alignWithSectionRepairs } from "../alignment/repair.js";
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
import { Semaphore } from "../scheduler/semaphore.js";
import {
  createWorkbenchPlan,
  loadWorkbenchContent,
  writeWorkbenchProject,
} from "../hyperframes/workbench.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const HARD_LINK_FALLBACK_ERRORS = new Set(["EXDEV", "EPERM", "ENOTSUP", "EEXIST"]);
export interface WorkflowDependencies {
  providers?: MediaProvider[];
  discoveryPlugins?: DiscoveryPlugin[];
  discoveryReferenceReaders?: DiscoveryReferenceReader[];
  agnes?: AgnesClient;
  ttsProviders?: Record<TtsProviderId, TtsProvider>;
  transcribe?: typeof transcribeWithWhisper;
  assetLibraryRoot?: string;
  renderWorkbench?: typeof renderWorkbench;
}

export interface WorkflowResourceLimits {
  download: Semaphore;
  agnes: Semaphore;
  qa: Semaphore;
  render: Semaphore;
}

export function createWorkflowResourceLimits(
  concurrency: TaskConfig["concurrency"],
): WorkflowResourceLimits {
  return {
    download: new Semaphore(concurrency.download),
    agnes: new Semaphore(concurrency.agnes),
    qa: new Semaphore(concurrency.qa),
    render: new Semaphore(concurrency.render),
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
function file(workspace: string, name: string) {
  return path.join(workspace, name);
}

async function renderWorkbench(config: TaskConfig, workspace: string): Promise<[string, string]> {
  const content = await loadWorkbenchContent();
  const project = await writeWorkbenchProject(
    file(workspace, "hyperframes-project"),
    createWorkbenchPlan(
      "workflow",
      config.aspectRatio,
      config.seed,
      content.workflow,
      config.targetDurationSeconds,
    ),
  );
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
  await runBinary("ffmpeg", [
    "-y",
    "-ss",
    String(Math.max(0, config.targetDurationSeconds - 2)),
    "-i",
    output,
    "-frames:v",
    "1",
    preview,
  ]);
  return [output, preview];
}

async function materializeWorkbench(
  sourceWorkspace: string,
  workspace: string,
): Promise<[string, string]> {
  const output = file(workspace, "process-video.mp4");
  const preview = file(workspace, "preview.png");
  await mkdir(workspace, { recursive: true });
  const linkOrCopy = async (source: string, destination: string) => {
    try {
      await link(source, destination);
    } catch (error) {
      if (!HARD_LINK_FALLBACK_ERRORS.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await copyFile(source, destination);
    }
  };
  await Promise.all([
    linkOrCopy(file(sourceWorkspace, "process-video.mp4"), output),
    linkOrCopy(file(sourceWorkspace, "preview.png"), preview),
  ]);
  return [output, preview];
}

export function createDefaultHandlers(
  config: TaskConfig,
  dependencies: WorkflowDependencies = {},
): Record<WorkflowNodeId, NodeHandler> {
  const providers = dependencies.providers ?? createProviderCatalog();
  const discoveryPlugins = dependencies.discoveryPlugins ?? createDiscoveryPlugins();
  const discoveryReferenceReaders =
    dependencies.discoveryReferenceReaders ?? createDiscoveryReferenceReaders();
  const ttsProviders = dependencies.ttsProviders ?? {
    edge: new EdgeProvider(),
    mimo: new MimoProvider(),
  };
  const transcribe = dependencies.transcribe ?? transcribeWithWhisper;
  const agnes = dependencies.agnes ?? new AgnesApiClient();
  const assetLibrary = new AssetLibrary(
    dependencies.assetLibraryRoot ?? path.join(packageRoot, ".asset-library"),
  );
  const resources = createWorkflowResourceLimits(config.concurrency);
  const workbenchRenderer = dependencies.renderWorkbench ?? renderWorkbench;
  let discoveryPromise: Promise<
    | { availability: Array<{ id: string; tier: MediaProvider["tier"]; available: boolean }> }
    | (LeadgenDiscovery & { agnesAvailable: boolean })
  > | null = null;
  let workbenchPromise: Promise<string> | null = null;
  const sharedDiscovery = () => {
    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        if (config.mode === "process") {
          const availability = await Promise.all(
            providers.map(async (provider) => ({
              id: provider.id,
              tier: provider.tier,
              available: await provider.isAvailable(),
            })),
          );
          return { availability };
        }
        const discovery = await discoverLeadgenMedia(
          config,
          providers,
          discoveryPlugins,
          discoveryReferenceReaders,
        );
        const agnesAvailable = await agnes.isAvailable();
        return { ...discovery, agnesAvailable };
      })().catch((error: unknown) => {
        discoveryPromise = null;
        throw error;
      });
    }
    return discoveryPromise;
  };
  const sharedWorkbench = async (
    workspace: string,
    allowRerender = true,
  ): Promise<[string, string]> => {
    const sharedWorkspace = file(path.dirname(workspace), ".shared-workbench");
    if (!workbenchPromise) {
      workbenchPromise = resources.render
        .run(async () => {
          await rm(sharedWorkspace, { recursive: true, force: true });
          await workbenchRenderer(config, sharedWorkspace);
          return sharedWorkspace;
        })
        .catch((error: unknown) => {
          workbenchPromise = null;
          throw error;
        });
    }
    try {
      return await materializeWorkbench(await workbenchPromise, workspace);
    } catch (error) {
      if (!allowRerender) throw error;
      workbenchPromise = null;
      return sharedWorkbench(workspace, false);
    }
  };
  const mediaResources = {
    download: <T>(operation: () => Promise<T>) => resources.download.run(operation),
    agnes: <T>(operation: () => Promise<T>) => resources.agnes.run(operation),
    qa: <T>(operation: () => Promise<T>) => resources.qa.run(operation),
  };
  return {
    configure: async ({ workspace }) => ({
      outputFiles: [await writeJson(file(workspace, "config.json"), config)],
    }),
    script: async ({ workspace, variant }) => ({
      outputFiles: [
        await writeJson(file(workspace, "scene-plan.json"), createScriptPlan(config, variant)),
      ],
    }),
    discover: async ({ workspace }) => {
      const report = await sharedDiscovery();
      const output = await writeJson(file(workspace, "discovery-report.json"), report);
      if (
        config.mode === "leadgen" &&
        "candidates" in report &&
        !report.candidates.length &&
        !report.agnesAvailable
      ) {
        const diagnostics = [
          ...report.failures.map((item) => `${item.provider}:${item.error}`),
          ...report.signals.failures.map((item) => `${item.plugin}:${item.error}`),
        ];
        throw new Error(
          `No licensed media provider or Agnes is available. Configure PEXELS_API_KEY, PIXABAY_API_KEY, or an Agnes adapter.${diagnostics.length ? ` Discovery failures: ${diagnostics.join("; ")}` : ""}`,
        );
      }
      return {
        outputFiles: [output],
      };
    },
    media: async ({ workspace, variant }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await writeJson(file(workspace, "media-manifest.json"), {
              mode: config.mode,
              assets: [],
              note: "Process compositions contain generated UI only.",
            }),
          ],
        };
      const discovery = await readJson<LeadgenDiscovery>(file(workspace, "discovery-report.json"));
      const result = await acquireLeadgenMedia({
        config,
        variant,
        discovery,
        workspace,
        library: assetLibrary,
        agnes,
        required: 8,
        resources: mediaResources,
      });
      if (result.assets.length < 8)
        throw new Error(`Insufficient qualified licensed media: ${result.gaps.join("; ")}`);
      return {
        outputFiles: [
          await writeJson(file(workspace, "media-manifest.json"), {
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
            await writeJson(file(workspace, "audio-quality-report.json"), { applicable: false }),
          ],
        };
      const plan = await readJson<ScriptPlan>(file(workspace, "scene-plan.json"));
      const requested = allocateProviders(config.count, config.edgeRatio, config.mimoRatio)[
        variant % config.count
      ]!;
      const segmentDirectory = file(workspace, "narration-segments");
      await mkdir(segmentDirectory, { recursive: true });
      const segments = createNarrationSegments(plan.sections);
      const outcome = await synthesizeSingleProvider({
        requested,
        providers: ttsProviders,
        segments,
        async synthesizeSegment(provider, segment) {
          const sentence = segments[segment.index]!;
          return (
            await synthesizeWithinWindow({
              provider,
              segment,
              outputDirectory: segmentDirectory,
              outputStem: `${provider.id}-${String(segment.index).padStart(2, "0")}`,
              voiceStyle: config.voiceStyle,
              windowSeconds: sentence.end - sentence.start,
            })
          ).path;
        },
      });
      const timeline = segments.map((segment, index) => ({
        id: segment.id,
        parentSectionId: segment.parentSectionId,
        narration: segment.narration,
        path: outcome.outputs[index]!,
        start: segment.start,
        end: segment.end,
        requested,
        actual: outcome.actual,
      }));
      const narration = file(workspace, "narration.wav");
      await placeNarrationSegments(timeline, config.targetDurationSeconds, narration);
      const report = await analyzeAudio(narration, -16, 2);
      if (!report.passed)
        throw new Error(`Narration failed audio QA: ${report.failures.join(", ")}`);
      return {
        outputFiles: [
          narration,
          await writeJson(file(workspace, "tts-report.json"), {
            requested,
            actual: outcome.actual,
            failures: outcome.failures,
            timeline,
            qa: report,
          }),
        ],
      };
    },
    alignment: async ({ workspace }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await writeJson(file(workspace, "alignment-report.json"), { applicable: false }),
          ],
        };
      const ttsReport = await readJson<{
        actual: TtsProviderId;
        timeline: Array<{
          id: string;
          parentSectionId: string;
          narration: string;
          path: string;
          start: number;
          end: number;
        }>;
      }>(file(workspace, "tts-report.json"));
      const timeline = ttsReport.timeline.map((item) => ({ ...item }));
      const alignedNarration = file(workspace, "aligned-narration.wav");
      await copyFile(file(workspace, "narration.wav"), alignedNarration);
      const result = await alignWithSectionRepairs({
        sections: timeline,
        initialAudioPath: alignedNarration,
        transcribe: (audioPath, attempt) =>
          dependencies.transcribe
            ? transcribe(audioPath, path.join(workspace, "whisper", `attempt-${attempt}`))
            : transcribeSectionsWithWhisper(
                audioPath,
                path.join(workspace, "whisper", `attempt-${attempt}`),
                timeline,
              ),
        async repair(sectionIndexes, attempt) {
          const provider = ttsProviders[ttsReport.actual];
          if (!(await provider.isAvailable()))
            throw new Error(`Selected TTS provider ${ttsReport.actual} became unavailable`);
          for (const index of sectionIndexes) {
            const segment = timeline[index]!;
            const repaired = await synthesizeWithinWindow({
              provider,
              segment: { id: segment.id, text: segment.narration, index },
              outputDirectory: file(workspace, "narration-segments"),
              outputStem: `repair-${attempt}-${String(index).padStart(2, "0")}`,
              voiceStyle: config.voiceStyle,
              windowSeconds: segment.end - segment.start,
            });
            timeline[index] = { ...segment, path: repaired.path };
          }
          await placeNarrationSegments(timeline, config.targetDurationSeconds, alignedNarration);
          return alignedNarration;
        },
      });
      const alignmentReport = await writeJson(file(workspace, "alignment-report.json"), {
        ...result.report,
        repairs: result.repairs,
        ttsProvider: ttsReport.actual,
      });
      if (!result.report.passed)
        throw new Error(`Narration alignment failed: ${result.report.failures.join(", ")}`);
      return {
        outputFiles: [alignedNarration, alignmentReport],
      };
    },
    captions: async ({ workspace }) => {
      if (config.mode === "process")
        return {
          outputFiles: [
            await writeJson(file(workspace, "captions.json"), { applicable: false, cues: [] }),
          ],
        };
      const alignment = await readJson<ReturnType<typeof alignTranscript>>(
        file(workspace, "alignment-report.json"),
      );
      const cues = buildCaptions(alignment.words, config.captions);
      const captions = await writeJson(file(workspace, "captions.json"), {
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
          outputFiles: [
            await writeJson(file(workspace, "music-report.json"), { applicable: false }),
          ],
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
        file(workspace, "aligned-narration.wav"),
        music,
        placements,
        config.targetDurationSeconds,
        mix,
      );
      const qa = await analyzeAudio(mix, -14, 2);
      if (!qa.passed) throw new Error(`Final mix failed audio QA: ${qa.failures.join(", ")}`);
      const report = await writeJson(file(workspace, "audio-quality-report.json"), {
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
          outputFiles: [
            await writeJson(file(workspace, "edit-decision.json"), { applicable: false }),
          ],
        };
      const [processVideo, preview] = await sharedWorkbench(workspace);
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
          await writeJson(file(workspace, "edit-decision.json"), edl),
          processVideo,
          preview,
        ],
      };
    },
    render: async ({ workspace }) => {
      if (config.mode === "process") {
        const [output, preview] = await sharedWorkbench(workspace);
        return { outputFiles: [output, preview] };
      }
      const edl = await readJson<EditDecisionList>(file(workspace, "edit-decision.json"));
      const output = file(workspace, "final-leadgen-video.mp4");
      await resources.render.run(() =>
        renderEdl(edl, {
          workDirectory: file(workspace, "render-work"),
          audioPath: file(workspace, "final-mix.wav"),
          subtitlePath: file(workspace, "subtitle.ass"),
          outputPath: output,
        }),
      );
      return { outputFiles: [output] };
    },
    qa: async ({ workspace }) => {
      if (config.mode === "process") {
        const report = await resources.qa.run(() =>
          analyzeMedia(file(workspace, "process-video.mp4"), {
            minWidth: 720,
            minHeight: 720,
            minDurationSeconds: config.targetDurationSeconds - 0.2,
            maxDurationSeconds: config.targetDurationSeconds + 0.2,
            maxBlackRatio: 0.05,
            maxFreezeRatio: 0.95,
          }),
        );
        const qualityPath = await writeJson(file(workspace, "media-quality-report.json"), report);
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
      const finalQa = await resources.qa.run(() =>
        analyzeFinalVideo(
          file(workspace, "final-leadgen-video.mp4"),
          config.aspectRatio,
          config.targetDurationSeconds,
        ),
      );
      const manifest = await readJson<{ assets: FrozenMediaAsset[] }>(
        file(workspace, "media-manifest.json"),
      );
      const ttsReport = await readJson<{ requested: TtsProviderId; actual: TtsProviderId }>(
        file(workspace, "tts-report.json"),
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
      const qualityPath = await writeJson(file(workspace, "media-quality-report.json"), report);
      if (!report.passed) throw new Error(`Final video failed QA: ${report.failures.join(", ")}`);
      const generationReport = file(workspace, "generation-report.md");
      await writeFile(
        generationReport,
        `# Generation Report\n\n- Mode: leadgen\n- QA: passed\n- Duration: ${report.durationSeconds}s\n- Licensed media: ${manifest.assets.length}\n- Media providers: ${[...new Set(manifest.assets.map((asset) => asset.provider))].join(", ")}\n- Requested TTS: ${ttsReport.requested}\n- Actual TTS: ${ttsReport.actual}\n- CTA: ${config.ctaText}\n- Publication review: required for third-party and generated-media rights\n`,
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

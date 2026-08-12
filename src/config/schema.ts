import { z } from "zod";

export const aspectRatioSchema = z.enum(["9:16", "16:9", "1:1"]);
export const modeSchema = z.enum(["process", "leadgen"]);
export const captionModeSchema = z.enum(["phrase", "word"]);
export const voiceStyleSchema = z.enum(["professional", "energetic", "friendly", "suspense"]);
export const audienceSchema = z.enum([
  "learners",
  "ip-owners",
  "enterprise-content",
  "short-video-founders",
  "custom",
]);
export const ctaKindSchema = z.enum([
  "comment-keyword",
  "direct-message",
  "download-materials",
  "join-community",
  "custom",
]);

const concurrencySchema = z.object({
  jobs: z.number().int().min(1).max(8).default(1),
  search: z.number().int().min(1).max(12).default(6),
  download: z.number().int().min(1).max(8).default(4),
  agnes: z.number().int().min(1).max(4).default(2),
  qa: z.number().int().min(1).max(6).default(3),
  render: z.number().int().min(1).max(2).default(1),
  hyperframesWorkers: z.number().int().min(1).max(8).default(4),
});

export const taskConfigSchema = z
  .object({
    mode: modeSchema,
    topic: z.string().trim().min(2).max(200),
    workflow: z.string().trim().min(2).max(500),
    platform: z.string().trim().min(1).max(100),
    aspectRatio: aspectRatioSchema.default("9:16"),
    targetDurationSeconds: z.number().min(6).max(45),
    audience: audienceSchema,
    customAudience: z.string().trim().max(200).optional(),
    ctaKind: ctaKindSchema,
    ctaText: z.string().trim().min(1).max(120),
    count: z.number().int().min(1).max(50).default(1),
    concurrency: concurrencySchema.default({
      jobs: 1,
      search: 6,
      download: 4,
      agnes: 2,
      qa: 3,
      render: 1,
      hyperframesWorkers: 4,
    }),
    captions: captionModeSchema.default("phrase"),
    edgeRatio: z.number().min(0).max(1).default(1),
    mimoRatio: z.number().min(0).max(1).default(0),
    voiceStyle: voiceStyleSchema.default("professional"),
    theme: z.string().trim().min(1).max(80).default("cinematic-workbench"),
    skin: z.string().trim().min(1).max(80).default("obsidian-coral"),
    style: z.string().trim().min(1).max(80).default("technical-cinematic"),
    motionIntensity: z.number().min(0).max(1).default(0.7),
    seed: z.number().int().min(0).max(2_147_483_647).default(20260813),
    confirmed: z.literal(true),
  })
  .superRefine((config, context) => {
    const ratioTotal = config.edgeRatio + config.mimoRatio;
    if (Math.abs(ratioTotal - 1) > 0.0001) {
      context.addIssue({
        code: "custom",
        path: ["edgeRatio"],
        message: "edgeRatio and mimoRatio must add up to 1",
      });
    }
    if (
      config.mode === "process" &&
      (config.targetDurationSeconds < 6 || config.targetDurationSeconds > 15)
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetDurationSeconds"],
        message: "process videos must be 6-15 seconds",
      });
    }
    if (
      config.mode === "leadgen" &&
      (config.targetDurationSeconds < 35 || config.targetDurationSeconds > 45)
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetDurationSeconds"],
        message: "leadgen videos must be 35-45 seconds",
      });
    }
    if (config.audience === "custom" && !config.customAudience) {
      context.addIssue({
        code: "custom",
        path: ["customAudience"],
        message: "customAudience is required",
      });
    }
  });

export type TaskConfig = z.infer<typeof taskConfigSchema>;
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
export type CaptionMode = z.infer<typeof captionModeSchema>;

export const DEFAULT_CONFIG = {
  aspectRatio: "9:16",
  count: 1,
  concurrency: {
    jobs: 1,
    search: 6,
    download: 4,
    agnes: 2,
    qa: 3,
    render: 1,
    hyperframesWorkers: 4,
  },
  captions: "phrase",
  edgeRatio: 1,
  mimoRatio: 0,
  voiceStyle: "professional",
  theme: "cinematic-workbench",
  skin: "obsidian-coral",
  style: "technical-cinematic",
  motionIntensity: 0.7,
  seed: 20260813,
} as const;

import { createRandom } from "../generation/random.js";
import type { TaskConfig } from "../config/schema.js";

export interface ScriptSection {
  id: "hook" | "quality" | "workbench" | "montage" | "proof" | "cta";
  start: number;
  end: number;
  narration: string;
}

export interface ScriptPlan {
  variant: number;
  seed: number;
  duration: number;
  sections: ScriptSection[];
}

const HOOKS = [
  "一条漫剧素材，真正费时间的不是剪辑。",
  "从一句设定到一组可投放镜头，中间发生了什么？",
  "先别看成片，看看这套漫剧工作流怎样跑起来。",
] as const;
const QUALITY = [
  "先锁定人物与世界观，再安排景别和运动。",
  "先用高质感镜头建立期待，再进入制作过程。",
] as const;
const PROOF = ["每个节点都能检查、重试和继续。", "素材、字幕和声音都经过独立检查。"] as const;

export function createScriptPlan(config: TaskConfig, variant = 0): ScriptPlan {
  const seed = config.seed + variant * 10_007;
  const random = createRandom(seed);
  if (config.mode === "process") {
    return {
      variant,
      seed,
      duration: config.targetDurationSeconds,
      sections: [
        {
          id: "workbench",
          start: 0,
          end: config.targetDurationSeconds,
          narration: config.workflow,
        },
      ],
    };
  }
  const duration = config.targetDurationSeconds;
  const scale = duration / 42;
  const boundary = (seconds: number) => Number((seconds * scale).toFixed(3));
  return {
    variant,
    seed,
    duration,
    sections: [
      { id: "hook", start: 0, end: boundary(2), narration: random.pick(HOOKS) },
      { id: "quality", start: boundary(2), end: boundary(7), narration: random.pick(QUALITY) },
      { id: "workbench", start: boundary(7), end: boundary(18), narration: config.workflow },
      {
        id: "montage",
        start: boundary(18),
        end: boundary(32),
        narration: `围绕${config.topic}组合高质感镜头。`,
      },
      { id: "proof", start: boundary(32), end: boundary(37), narration: random.pick(PROOF) },
      { id: "cta", start: boundary(37), end: duration, narration: config.ctaText },
    ],
  };
}

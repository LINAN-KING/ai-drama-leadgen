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

const HOOKS = ["漫剧开工！", "一句成片！", "工作流启动！"] as const;
const QUALITY = [
  "先锁定人物和世界观，再安排景别与动作。",
  "先建立画面期待，再拆解角色、场景和节奏。",
] as const;
const PROOF = ["每个节点都能检查、重试和继续。", "素材、字幕和声音都经过独立检查。"] as const;

function speechExcerpt(value: string, maxCharacters: number): string {
  const compact = value.replace(/\s+/g, "").replace(/[。！？!?]+$/g, "");
  return compact.length <= maxCharacters ? compact : `${compact.slice(0, maxCharacters - 1)}…`;
}

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
      {
        id: "workbench",
        start: boundary(7),
        end: boundary(18),
        narration: `工作台执行${speechExcerpt(config.workflow, 22)}，展示输入、处理、结果和完成状态。`,
      },
      {
        id: "montage",
        start: boundary(18),
        end: boundary(32),
        narration: `围绕${config.topic}选择动态镜头，按旁白语义切换，再贴近音乐节拍，让氛围、动作和信息重点彼此配合。`,
      },
      { id: "proof", start: boundary(32), end: boundary(37), narration: random.pick(PROOF) },
      { id: "cta", start: boundary(37), end: duration, narration: config.ctaText },
    ],
  };
}

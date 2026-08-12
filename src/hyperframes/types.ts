import type { AspectRatio } from "../config/schema.js";

export const WORKBENCH_TEMPLATES = [
  "prompt",
  "storyboard",
  "character",
  "scene",
  "video",
  "workflow",
] as const;
export type WorkbenchTemplate = (typeof WORKBENCH_TEMPLATES)[number];

export interface CanvasSize {
  width: number;
  height: number;
}

export const CANVAS_SIZES: Record<AspectRatio, CanvasSize> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

export interface WorkbenchContent {
  title: string;
  input: string;
  processing: string;
  result: string;
  focus: string;
}

export interface WorkbenchPlan {
  id: string;
  template: WorkbenchTemplate;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  duration: number;
  seed: number;
  content: WorkbenchContent;
  stages: Array<{ id: "input" | "processing" | "result" | "focus" | "complete"; start: number }>;
}

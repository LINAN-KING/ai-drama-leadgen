import type { AspectRatio } from "../config/schema.js";

export interface FocusPoint {
  x: number;
  y: number;
}
export interface EdlShot {
  id: string;
  sourcePath: string;
  sourceStart: number;
  sourceDuration: number;
  timelineStart: number;
  timelineDuration: number;
  speed: number;
  focus?: FocusPoint;
  role: "hook" | "quality" | "workbench" | "montage" | "proof" | "cta";
}
export interface EditDecisionList {
  aspectRatio: AspectRatio;
  fps: 30;
  duration: number;
  shots: EdlShot[];
}

export function validateEdl(edl: EditDecisionList): string[] {
  const failures: string[] = [];
  if (edl.fps !== 30) failures.push("fps-must-be-30");
  const ordered = [...edl.shots].sort((a, b) => a.timelineStart - b.timelineStart);
  ordered.forEach((shot, index) => {
    if (shot.timelineDuration < 0.8 || shot.timelineDuration > 3)
      failures.push(`${shot.id}:shot-duration-out-of-range`);
    if (shot.speed <= 0) failures.push(`${shot.id}:invalid-speed`);
    const previous = ordered[index - 1];
    if (previous && shot.timelineStart < previous.timelineStart + previous.timelineDuration - 0.001)
      failures.push(`${shot.id}:timeline-overlap`);
  });
  const end = ordered.reduce(
    (maximum, shot) => Math.max(maximum, shot.timelineStart + shot.timelineDuration),
    0,
  );
  if (Math.abs(end - edl.duration) > 0.05) failures.push("timeline-duration-mismatch");
  return failures;
}

export function cropExpression(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focus?: FocusPoint,
): string {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const cropWidth = Math.round(sourceHeight * targetRatio);
    const focusX = Math.round((focus?.x ?? 0.5) * sourceWidth);
    return (
      `crop=${cropWidth}:${sourceHeight}:max(0\\,min(iw-${cropWidth}\\,${focusX}-${Math.round(cropWidth / 2)})):` +
      "0"
    );
  }
  const cropHeight = Math.round(sourceWidth / targetRatio);
  const focusY = Math.round((focus?.y ?? 0.5) * sourceHeight);
  return `crop=${sourceWidth}:${cropHeight}:0:max(0\\,min(ih-${cropHeight}\\,${focusY}-${Math.round(cropHeight / 2)}))`;
}

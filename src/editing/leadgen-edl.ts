import type { TaskConfig } from "../config/schema.js";
import type { EditDecisionList, EdlShot } from "./edl.js";

interface SourceAsset {
  path: string;
  durationSeconds: number;
}

function chunks(duration: number): number[] {
  const count = Math.ceil(duration / 3);
  const value = duration / count;
  if (value < 0.8) throw new Error(`Cannot split ${duration}s into valid shot durations`);
  return Array.from({ length: count }, () => Number(value.toFixed(6)));
}

export function createLeadgenEdl(
  config: TaskConfig,
  sections: Array<{ id: EdlShot["role"]; start: number; end: number }>,
  media: SourceAsset[],
  processVideo: SourceAsset,
): EditDecisionList {
  if (!media.length) throw new Error("Leadgen EDL requires licensed or generated media");
  let mediaCursor = 0;
  const shots: EdlShot[] = [];
  for (const section of sections) {
    let timelineStart = section.start;
    for (const [part, timelineDuration] of chunks(section.end - section.start).entries()) {
      const useProcess = section.id === "workbench";
      const source = useProcess ? processVideo : media[mediaCursor++ % media.length]!;
      const maximumStart = Math.max(0, source.durationSeconds - timelineDuration);
      const sourceStart = useProcess
        ? Math.min(maximumStart, part * timelineDuration)
        : Math.min(maximumStart, ((mediaCursor + part) * 0.37) % Math.max(0.01, maximumStart));
      shots.push({
        id: `${section.id}-${String(part + 1).padStart(2, "0")}`,
        sourcePath: source.path,
        sourceStart: Number(sourceStart.toFixed(3)),
        sourceDuration: source.durationSeconds,
        timelineStart: Number(timelineStart.toFixed(6)),
        timelineDuration,
        speed: 1,
        focus: { x: 0.5, y: 0.45 },
        role: section.id,
      });
      timelineStart += timelineDuration;
    }
  }
  return {
    aspectRatio: config.aspectRatio,
    fps: 30,
    duration: config.targetDurationSeconds,
    shots,
  };
}

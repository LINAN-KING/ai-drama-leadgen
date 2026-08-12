import { access } from "node:fs/promises";
import { runBinary } from "../ffmpeg/process.js";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
}
interface ProbeFormat {
  duration?: string;
  size?: string;
  format_name?: string;
}

export interface MediaProbe {
  path: string;
  decodable: boolean;
  kind: "image" | "video" | "unknown";
  codec: string | null;
  width: number;
  height: number;
  durationSeconds: number;
  frameRate: number;
  sizeBytes: number;
  format: string | null;
  hasAudio: boolean;
}

function parseRate(value?: string): number {
  if (!value) return 0;
  const [numerator, denominator = "1"] = value.split("/");
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) ? result : 0;
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  await access(filePath);
  try {
    const { stdout } = await runBinary("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: ProbeFormat };
    const stream = parsed.streams?.find((item) => item.codec_type === "video");
    if (!stream) throw new Error("No visual stream");
    const duration = Number(stream.duration ?? parsed.format?.duration ?? 0);
    return {
      path: filePath,
      decodable: true,
      kind: duration > 0.1 ? "video" : "image",
      codec: stream.codec_name ?? null,
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      durationSeconds: Number.isFinite(duration) ? duration : 0,
      frameRate: parseRate(stream.avg_frame_rate),
      sizeBytes: Number(parsed.format?.size ?? 0),
      format: parsed.format?.format_name ?? null,
      hasAudio: parsed.streams?.some((item) => item.codec_type === "audio") ?? false,
    };
  } catch {
    return {
      path: filePath,
      decodable: false,
      kind: "unknown",
      codec: null,
      width: 0,
      height: 0,
      durationSeconds: 0,
      frameRate: 0,
      sizeBytes: 0,
      format: null,
      hasAudio: false,
    };
  }
}

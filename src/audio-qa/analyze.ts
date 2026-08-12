import { runBinary } from "../ffmpeg/process.js";

export interface AudioQaReport {
  passed: boolean;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  silenceRatio: number;
  failures: string[];
}

function lastNumber(log: string, pattern: RegExp): number | null {
  const matches = [...log.matchAll(pattern)];
  const value = Number(matches.at(-1)?.[1]);
  return Number.isFinite(value) ? value : null;
}

export async function analyzeAudio(
  filePath: string,
  targetLufs = -16,
  tolerance = 2,
): Promise<AudioQaReport> {
  const [loudness, silence] = await Promise.all([
    runBinary("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      filePath,
      "-filter_complex",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ]),
    runBinary("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i",
      filePath,
      "-af",
      "silencedetect=n=-45dB:d=0.3",
      "-f",
      "null",
      "-",
    ]),
  ]);
  const durationMatch = loudness.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const integratedLufs = lastNumber(loudness.stderr, /I:\s+(-?[\d.]+) LUFS/g);
  const truePeakDbtp = lastNumber(loudness.stderr, /Peak:\s+(-?[\d.]+) dBFS/g);
  const silentSeconds = [...silence.stderr.matchAll(/silence_duration: ([\d.]+)/g)].reduce(
    (sum, match) => sum + Number(match[1] ?? 0),
    0,
  );
  const silenceRatio = durationSeconds ? Math.min(1, silentSeconds / durationSeconds) : 1;
  const failures: string[] = [];
  if (integratedLufs === null || Math.abs(integratedLufs - targetLufs) > tolerance)
    failures.push("loudness-out-of-range");
  if (truePeakDbtp === null || truePeakDbtp > -1) failures.push("true-peak-above-minus-1-dbtp");
  if (silenceRatio > 0.4) failures.push("excessive-silence");
  return {
    passed: failures.length === 0,
    integratedLufs,
    truePeakDbtp,
    silenceRatio: Number(silenceRatio.toFixed(6)),
    failures,
  };
}

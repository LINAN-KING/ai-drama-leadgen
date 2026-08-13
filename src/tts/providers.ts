import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBinary } from "../ffmpeg/process.js";
import { hasWindowsCredential } from "../config/windows-credentials.js";
import type { TtsProvider, TtsSynthesisRequest } from "./types.js";

export class MimoProvider implements TtsProvider {
  readonly id = "mimo" as const;
  constructor(
    private readonly scriptPath = process.env.MIMO_SCRIPT_PATH ??
      path.join(os.homedir(), ".codex", "skills", "mimo-tts", "scripts", "synthesize.py"),
  ) {}
  async isAvailable(): Promise<boolean> {
    try {
      await access(this.scriptPath);
      return (
        Boolean(process.env.MIMO_API_KEY) || (await hasWindowsCredential("ai-commerce-mimo-tts"))
      );
    } catch {
      return false;
    }
  }
  async synthesize(request: TtsSynthesisRequest): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), "mimo-tts-"));
    try {
      const textPath = path.join(root, `${request.segment.id}.txt`);
      await writeFile(textPath, request.segment.text, "utf8");
      const style = `${request.voiceStyle}中文口播，吐字清晰，语速${request.speed.toFixed(2)}倍。`;
      await runBinary(
        "python",
        [
          this.scriptPath,
          "--text-file",
          textPath,
          "--out",
          request.outputPath,
          "--voice",
          "冰糖",
          "--style",
          style,
        ],
        180_000,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

export class EdgeProvider implements TtsProvider {
  readonly id = "edge" as const;
  constructor(private readonly command = "edge-tts") {}
  async isAvailable(): Promise<boolean> {
    try {
      await runBinary(this.command, ["--version"], 10_000);
      return true;
    } catch {
      return false;
    }
  }
  async synthesize(request: TtsSynthesisRequest): Promise<void> {
    const rate = Math.round((request.speed - 1) * 100);
    await runBinary(
      this.command,
      [
        "--text",
        request.segment.text,
        "--voice",
        "zh-CN-YunxiNeural",
        "--rate",
        `${rate >= 0 ? "+" : ""}${rate}%`,
        "--write-media",
        request.outputPath,
      ],
      120_000,
    );
  }
}

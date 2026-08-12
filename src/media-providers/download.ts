import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runBinary } from "../ffmpeg/process.js";

export async function downloadMedia(url: string, outputPath: string, timeoutMs = 120_000) {
  if (url.startsWith("local://")) throw new Error(`Cannot download unresolved local URL: ${url}`);
  if (path.isAbsolute(url)) return url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${randomUUID()}.tmp`;
    try {
      if (process.platform === "win32" && new URL(url).hostname === "upload.wikimedia.org")
        throw new Error("Use the Windows system network stack for Wikimedia downloads");
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok)
        throw new Error(`Media download failed: ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error("Media download returned an empty body");
      const body = response.body as Parameters<typeof Readable.fromWeb>[0];
      await pipeline(Readable.fromWeb(body), createWriteStream(temporary, { flags: "wx" }));
    } catch (error) {
      if (process.platform !== "win32" || controller.signal.aborted) {
        await rm(temporary, { force: true });
        throw error;
      }
      try {
        await runBinary(
          "curl.exe",
          [
            "-fsSL",
            "--retry",
            "2",
            "--retry-all-errors",
            "--retry-delay",
            "1",
            "--connect-timeout",
            "15",
            "--max-time",
            String(Math.ceil(timeoutMs / 1000)),
            "-A",
            "ai-drama-leadgen/0.1",
            "-o",
            temporary,
            url,
          ],
          timeoutMs + 5_000,
        );
      } catch (curlError) {
        await rm(temporary, { force: true });
        throw curlError;
      }
    }
    if ((await stat(temporary)).size === 0) {
      await rm(temporary, { force: true });
      throw new Error("Media download returned an empty file");
    }
    await rename(temporary, outputPath);
    return outputPath;
  } finally {
    clearTimeout(timeout);
  }
}

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runBinary } from "../ffmpeg/process.js";
import {
  assertSafeNetworkUrl,
  resolveSafePublicAddresses,
  withSafeDispatcher,
} from "./safe-network.js";

export function assertSafeDownloadUrl(value: string | URL): URL {
  return assertSafeNetworkUrl(value);
}

async function fetchSafe(url: URL, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    assertSafeDownloadUrl(current);
    const response = await fetch(
      current,
      withSafeDispatcher({ signal, redirect: "manual" }) as RequestInit,
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Media redirect did not include a location");
    if (redirects === 5) throw new Error("Media download exceeded 5 redirects");
    current = assertSafeDownloadUrl(new URL(location, current));
  }
  throw new Error("Media download exceeded 5 redirects");
}

export async function downloadMedia(url: string, outputPath: string, timeoutMs = 120_000) {
  if (url.startsWith("local://")) throw new Error(`Cannot download unresolved local URL: ${url}`);
  if (path.isAbsolute(url)) return url;
  const parsedUrl = assertSafeDownloadUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let temporary: string | undefined;
  let published = false;
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    temporary = `${outputPath}.${randomUUID()}.tmp`;
    try {
      if (process.platform === "win32" && parsedUrl.hostname === "upload.wikimedia.org")
        throw new Error("Use the Windows system network stack for Wikimedia downloads");
      const response = await fetchSafe(parsedUrl, controller.signal);
      if (!response.ok)
        throw new Error(`Media download failed: ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error("Media download returned an empty body");
      const body = response.body as Parameters<typeof Readable.fromWeb>[0];
      await pipeline(Readable.fromWeb(body), createWriteStream(temporary, { flags: "wx" }));
    } catch (error) {
      if (
        process.platform !== "win32" ||
        parsedUrl.hostname !== "upload.wikimedia.org" ||
        controller.signal.aborted
      ) {
        await rm(temporary, { force: true });
        throw error;
      }
      try {
        const pinnedAddress = (await resolveSafePublicAddresses(parsedUrl.hostname))[0]!.address;
        await runBinary(
          "curl.exe",
          [
            "-fsS",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--retry",
            "2",
            "--retry-all-errors",
            "--retry-delay",
            "1",
            "--connect-timeout",
            "15",
            "--resolve",
            `${parsedUrl.hostname}:443:${pinnedAddress}`,
            "--max-time",
            String(Math.ceil(timeoutMs / 1000)),
            "-A",
            "ai-drama-leadgen/0.1",
            "-o",
            temporary,
            parsedUrl.toString(),
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
    published = true;
    return outputPath;
  } finally {
    clearTimeout(timeout);
    if (temporary && !published) await rm(temporary, { force: true });
  }
}

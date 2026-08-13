import { access } from "node:fs/promises";
import path from "node:path";
import { runBinary, type ProcessOutput } from "../ffmpeg/process.js";

export type McporterRunner = (
  args: string[],
  timeout?: number,
  signal?: AbortSignal,
) => Promise<ProcessOutput>;

export async function runMcporter(
  args: string[],
  timeout = 60_000,
  signal?: AbortSignal,
): Promise<ProcessOutput> {
  const entry = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "mcporter",
    "dist",
    "cli.js",
  );
  let hasBundledEntry = false;
  try {
    await access(entry);
    hasBundledEntry = true;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
  }
  if (hasBundledEntry) return runBinary(process.execPath, [entry, ...args], timeout, signal);
  if (process.platform === "win32") {
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!directory) continue;
      const shim = path.join(directory, "mcporter.ps1");
      let exists = false;
      try {
        await access(shim);
        exists = true;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
      }
      if (exists)
        return runBinary(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", shim, ...args],
          timeout,
          signal,
        );
    }
    throw new Error("mcporter was not found in the Node installation or PATH");
  }
  return runBinary("mcporter", args, timeout, signal);
}

interface McporterServerStatus {
  mode?: string;
  name?: string;
  status?: string;
  tools?: Array<{ name?: string }>;
}

export async function inspectAgentReachServer(
  server: string,
  runner: McporterRunner = runMcporter,
  signal?: AbortSignal,
): Promise<boolean> {
  const output = await runner(["list", server, "--json"], 15_000, signal);
  try {
    const status = JSON.parse(output.stdout) as McporterServerStatus;
    return (
      status.mode === "server" &&
      status.name === server &&
      status.status === "ok" &&
      Boolean(status.tools?.some((tool) => tool.name === "web_search_exa"))
    );
  } catch {
    return false;
  }
}

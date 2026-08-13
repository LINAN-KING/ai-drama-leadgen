import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessOutput {
  stdout: string;
  stderr: string;
}

export async function runBinary(
  command: string,
  args: string[],
  timeout = 120_000,
  signal?: AbortSignal,
): Promise<ProcessOutput> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    windowsHide: true,
    timeout,
    signal,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout, stderr };
}

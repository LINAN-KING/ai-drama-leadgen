import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function hasWindowsCredential(target: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync("cmdkey", ["/list"], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.toLowerCase().includes(`target=${target}`.toLowerCase());
  } catch {
    return false;
  }
}

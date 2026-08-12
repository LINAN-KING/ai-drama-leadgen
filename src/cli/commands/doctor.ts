import { execFile } from "node:child_process";
import { access, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { writeJson } from "../../config/files.js";
import type { CapabilityResult } from "../../reporting/result.js";
import { hasWindowsCredential } from "../../config/windows-credentials.js";

const execFileAsync = promisify(execFile);

interface DoctorReport {
  generatedAt: string;
  platform: { os: string; release: string; architecture: string; supported: boolean };
  hardware: { cpuLogicalCores: number; memoryBytes: number; freeDiskBytes: number | null };
  capabilities: CapabilityResult[];
  summary: { available: number; missing: number; manualAction: number; optional: number };
}

const COMMANDS = [
  { id: "node", label: "Node.js 22+", command: "node", args: ["--version"], required: true },
  {
    id: "npm",
    label: "npm",
    command: process.platform === "win32" ? process.execPath : "npm",
    args:
      process.platform === "win32"
        ? [
            path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
            "--version",
          ]
        : ["--version"],
    required: true,
  },
  {
    id: "pwsh",
    label: "PowerShell 7",
    command: "pwsh",
    args: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
    required: true,
  },
  { id: "git", label: "Git", command: "git", args: ["--version"], required: true },
  { id: "ffmpeg", label: "FFmpeg", command: "ffmpeg", args: ["-version"], required: true },
  { id: "ffprobe", label: "FFprobe", command: "ffprobe", args: ["-version"], required: true },
  { id: "python", label: "Python", command: "python", args: ["--version"], required: false },
  { id: "edge-tts", label: "Edge TTS", command: "edge-tts", args: ["--version"], required: false },
  { id: "whisper", label: "Whisper", command: "whisper", args: ["--help"], required: false },
  {
    id: "agent-reach",
    label: "Agent Reach",
    command: "agent-reach",
    args: ["--help"],
    required: false,
  },
  {
    id: "crawl4ai",
    label: "Crawl4AI",
    command: "crawl4ai-doctor",
    args: ["--help"],
    required: false,
  },
] as const;

async function inspectCommand(spec: (typeof COMMANDS)[number]): Promise<CapabilityResult> {
  try {
    const { stdout, stderr } = await execFileAsync(spec.command, spec.args, {
      windowsHide: true,
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
    });
    const version = `${stdout}${stderr}`.trim().split(/\r?\n/, 1)[0] ?? "unknown";
    const incompatible = spec.id === "node" && Number(version.match(/v(\d+)/)?.[1] ?? 0) < 22;
    return {
      id: spec.id,
      label: spec.label,
      status: incompatible ? "missing" : "available",
      detail: incompatible
        ? `Detected ${version}; Node.js 22 or newer is required`
        : "Detected on PATH",
      version,
    };
  } catch (error) {
    return {
      id: spec.id,
      label: spec.label,
      status: spec.required ? "missing" : "optional",
      detail: error instanceof Error ? error.message : "Not detected on PATH",
    };
  }
}

function inspectCredential(id: string, label: string, variables: string[]): CapabilityResult {
  const found = variables.some((name) => Boolean(process.env[name]));
  return {
    id,
    label,
    status: found ? "available" : "manual-action",
    detail: found
      ? `Credential detected via ${variables.join(" or ")}`
      : `Set ${variables.join(" or ")} to enable`,
  };
}

async function inspectMimoCredential(): Promise<CapabilityResult> {
  if (process.env.MIMO_API_KEY) return inspectCredential("mimo", "MiMo TTS", ["MIMO_API_KEY"]);
  const found = await hasWindowsCredential("ai-commerce-mimo-tts");
  return {
    id: "mimo",
    label: "MiMo TTS",
    status: found ? "available" : "manual-action",
    detail: found
      ? "Credential detected in Windows Credential Manager"
      : "Store target ai-commerce-mimo-tts or set MIMO_API_KEY to enable",
  };
}

async function detectChrome(): Promise<CapabilityResult> {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env.PROGRAMFILES ?? "C:\\Program Files",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
          path.join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
          path.join(
            process.env.LOCALAPPDATA ?? "",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return {
        id: "chrome",
        label: "Chrome",
        status: "available",
        detail: "Browser detected",
        path: candidate,
      };
    } catch {
      // Try the next conventional install path.
    }
  }
  return {
    id: "chrome",
    label: "Chrome",
    status: "missing",
    detail: "Chrome was not found in a standard install path",
  };
}

export async function collectDoctorReport(cwd = process.cwd()): Promise<DoctorReport> {
  const capabilities = await Promise.all(COMMANDS.map(inspectCommand));
  capabilities.push(await detectChrome());
  capabilities.push(
    inspectCredential("free-media", "Free media providers", ["PIXABAY_API_KEY", "PEXELS_API_KEY"]),
  );
  capabilities.push(inspectCredential("agnes", "Agnes generation", ["AGNES_API_KEY"]));
  capabilities.push(await inspectMimoCredential());
  capabilities.push(inspectCredential("freesound", "Freesound effects", ["FREESOUND_API_KEY"]));
  capabilities.push(
    inspectCredential("firecrawl", "Firecrawl", ["FIRECRAWL_API_KEY", "FIRECRAWL_URL"]),
  );
  let freeDiskBytes: number | null = null;
  try {
    const disk = await statfs(cwd);
    freeDiskBytes = disk.bavail * disk.bsize;
  } catch {
    // Disk reporting is advisory and must not hide other diagnostics.
  }
  const count = (status: CapabilityResult["status"]) =>
    capabilities.filter((item) => item.status === status).length;
  return {
    generatedAt: new Date().toISOString(),
    platform: {
      os: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      supported: os.platform() === "win32",
    },
    hardware: { cpuLogicalCores: os.cpus().length, memoryBytes: os.totalmem(), freeDiskBytes },
    capabilities,
    summary: {
      available: count("available"),
      missing: count("missing"),
      manualAction: count("manual-action"),
      optional: count("optional"),
    },
  };
}

export async function runDoctor(output: string): Promise<void> {
  const report = await collectDoctorReport();
  await writeJson(output, report);
  process.stdout.write(`${JSON.stringify(report.summary)}\nReport: ${path.resolve(output)}\n`);
  if (!report.platform.supported || report.summary.missing > 0) process.exitCode = 1;
}

import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("Windows installer", () => {
  it("pins HyperFrames and gates mutating installation", async () => {
    const source = await readFile(path.resolve("installer/install.ps1"), "utf8");
    expect(source).toContain("0.7.107");
    expect(source).toContain("InstallSafeDependencies");
    expect(source).toContain("InstallOptionalTools");
    expect(source).toContain("playwright install chromium");
    expect(source).toContain("openai-whisper");
    expect(source).toContain("crawl4ai");
    expect(source).toContain("ShouldProcess");
    expect(source).not.toMatch(/cookie|password/i);
  });

  it("ships all five thin adapters", async () => {
    for (const agent of ["codex", "trae", "hermes", "codebuddy", "workbuddy"]) {
      const source = await readFile(path.resolve(`adapters/${agent}/SKILL.md`), "utf8");
      expect(source).toContain("drama-leadgen");
      expect(source).toContain("Do not generate media directly");
    }
  });

  it("installs self-contained adapters into all five agent roots", async () => {
    if (process.platform !== "win32") return;
    const profile = await mkdtemp(path.join(os.tmpdir(), "adapter-install-"));
    const report = path.join(profile, "doctor.json");
    await promisify(execFile)(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        path.resolve("installer/install.ps1"),
        "-InstallAdapters",
        "-ReportPath",
        report,
      ],
      { env: { ...process.env, USERPROFILE: profile }, timeout: 60_000, windowsHide: true },
    );
    for (const agent of ["codex", "trae", "hermes", "codebuddy", "workbuddy"]) {
      const root = path.join(profile, `.${agent}`, "skills", "ai-drama-leadgen");
      const installed = await readFile(path.join(root, "SKILL.md"), "utf8");
      const command = JSON.parse(await readFile(path.join(root, "COMMAND.json"), "utf8")) as {
        repository: string;
        command: string;
      };
      expect(installed).not.toContain("{{REPO_ROOT}}");
      expect(installed).toContain(path.resolve("SKILL.md"));
      expect(command.repository).toBe(path.resolve("."));
      expect(command.command).toContain("dist\\cli\\index.js");
    }
  }, 90_000);
});

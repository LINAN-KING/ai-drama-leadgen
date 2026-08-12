import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows installer", () => {
  it("pins HyperFrames and gates mutating installation", async () => {
    const source = await readFile(path.resolve("installer/install.ps1"), "utf8");
    expect(source).toContain("0.7.107");
    expect(source).toContain("InstallSafeDependencies");
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
});

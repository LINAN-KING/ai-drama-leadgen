import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileWorkbenchHtml,
  createWorkbenchPlan,
  loadWorkbenchContent,
  writeAllWorkbenchProjects,
} from "../../src/hyperframes/workbench.js";
import { CANVAS_SIZES, WORKBENCH_TEMPLATES } from "../../src/hyperframes/types.js";

describe("workbench compositions", () => {
  it("generates six templates across all three aspect ratios", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "drama-workbench-"));
    const projects = await writeAllWorkbenchProjects(root, 42);
    expect(projects).toHaveLength(18);
    for (const directory of projects)
      expect(await readFile(path.join(directory, "index.html"), "utf8")).toContain(
        "window.__timelines",
      );
  });

  it("contains every required process stage and HyperFrames contract", async () => {
    const content = await loadWorkbenchContent();
    for (const template of WORKBENCH_TEMPLATES) {
      for (const ratio of ["9:16", "16:9", "1:1"] as const) {
        const plan = createWorkbenchPlan(template, ratio, 42, content[template]);
        const html = compileWorkbenchHtml(plan);
        expect(plan).toMatchObject(CANVAS_SIZES[ratio]);
        expect(plan.stages.map((stage) => stage.id)).toEqual([
          "input",
          "processing",
          "result",
          "focus",
          "complete",
        ]);
        expect(html).toContain("data-composition-id=");
        expect(html).toContain('data-track-index="0"');
        expect(html).toContain("gsap.timeline({paused:true})");
        expect(html).not.toContain("Math.random");
        expect(html).not.toContain("repeat:-1");
      }
    }
  });

  it("is byte-identical for the same plan and seed", async () => {
    const content = await loadWorkbenchContent();
    const plan = createWorkbenchPlan("prompt", "9:16", 99, content.prompt);
    expect(compileWorkbenchHtml(plan)).toBe(compileWorkbenchHtml(plan));
  });
});

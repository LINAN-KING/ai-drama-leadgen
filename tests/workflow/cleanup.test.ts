import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupJobIntermediates } from "../../src/workflow/cleanup.js";

describe("job disk management", () => {
  it("removes regenerable directories and preserves final artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workflow-cleanup-"));
    for (const name of ["downloads", "narration-segments", "whisper", "render-work"]) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, "temporary.bin"), "temporary");
    }
    const final = path.join(root, "final-leadgen-video.mp4");
    await writeFile(final, "final");
    await cleanupJobIntermediates(root);
    await expect(access(final)).resolves.toBeUndefined();
    for (const name of ["downloads", "narration-segments", "whisper", "render-work"])
      await expect(access(path.join(root, name))).rejects.toThrow();
  });
});

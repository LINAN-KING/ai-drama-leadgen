import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_PROCESS_ARTIFACTS } from "../../src/reporting/artifacts.js";
import { verifyArtifacts } from "../../src/reporting/verify.js";

describe("artifact completeness", () => {
  it("reports exact missing deliverables", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "artifacts-"));
    await writeFile(path.join(root, "config.json"), "{}");
    const result = await verifyArtifacts(root, REQUIRED_PROCESS_ARTIFACTS);
    expect(result.complete).toBe(false);
    expect(result.present).toEqual(["config.json"]);
    expect(result.missing).toContain("process-video.mp4");
  });
});

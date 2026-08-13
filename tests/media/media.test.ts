import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetLibrary } from "../../src/media-providers/library.js";
import type { MediaCandidate } from "../../src/media-providers/types.js";
import {
  evaluateCandidate,
  rankCandidates,
  rejectAdjacentSimilarity,
} from "../../src/media-qa/filter.js";
import { freezeShot } from "../../src/editing/freeze.js";

const licensed: MediaCandidate = {
  id: "pexels-1",
  provider: "pexels",
  tier: "free",
  kind: "video",
  previewUrl: "https://example.test/preview.jpg",
  sourceUrl: "https://example.test/item",
  downloadUrl: "https://example.test/video.mp4",
  author: "Creator",
  width: 1920,
  height: 1080,
  durationSeconds: 3,
  watermarked: false,
  motionScore: 0.8,
  semanticScore: 0.9,
  compositionScore: 0.8,
  styleScore: 0.7,
  perceptualHash: "00001111",
  license: {
    name: "Pexels License",
    url: "https://example.test/license",
    commercialUse: true,
    attributionRequired: false,
    snapshotText: "Commercial use allowed",
    capturedAt: "2026-08-13T00:00:00.000Z",
  },
};

describe("media licensing and persistence", () => {
  it("hard-rejects unknown licensing and watermarks", () => {
    expect(evaluateCandidate({ ...licensed, license: undefined }, 0).accepted).toBe(false);
    expect(evaluateCandidate({ ...licensed, watermarked: true }, 0).hardFailures).toContain(
      "watermark",
    );
    expect(() =>
      freezeShot(
        { ...licensed, license: undefined },
        { sha256: "a".repeat(64), localPath: "x.mp4" },
        { shotId: "s1", start: 0, duration: 2 },
      ),
    ).toThrow("Cannot freeze");
  });

  it("penalizes recent use and prevents adjacent near-duplicates", () => {
    const newer = { ...licensed, id: "new", semanticScore: 0.82, perceptualHash: "11110000" };
    expect(rankCandidates([licensed, newer], new Map([[licensed.id, 8]]))[0]?.candidate.id).toBe(
      "new",
    );
    expect(
      rejectAdjacentSimilarity([licensed, { ...licensed, id: "same", perceptualHash: "00001110" }]),
    ).toHaveLength(1);
  });

  it("stores originals by SHA-256 and persists cross-batch use counts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asset-library-"));
    const source = path.join(root, "source.mp4");
    await writeFile(source, "licensed original");
    const library = new AssetLibrary(path.join(root, "library"));
    const record = await library.importOriginal(licensed, source);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(record.originalPath, "utf8")).toBe("licensed original");
    await library.incrementUse(licensed.id);
    expect((await new AssetLibrary(path.join(root, "library")).usageMap()).get(licensed.id)).toBe(
      1,
    );
  });

  it("preserves concurrent mutations from independent library instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asset-library-concurrent-"));
    const source = path.join(root, "source.mp4");
    await writeFile(source, "independent-library-content");
    const libraryRoot = path.join(root, "library");
    await Promise.all(
      ["one", "two"].map((id) =>
        new AssetLibrary(libraryRoot).importOriginal({ ...licensed, id }, source),
      ),
    );
    const usage = await new AssetLibrary(libraryRoot).usageMap();
    expect([...usage.keys()].sort()).toEqual(["one", "two"]);
  });

  it("reclaims an expired asset-library lease after PID reuse", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asset-library-expired-"));
    const libraryRoot = path.join(root, "library");
    const lock = path.join(libraryRoot, ".index.lock");
    const owner = path.join(lock, "owner.json");
    const source = path.join(root, "source.mp4");
    await mkdir(lock, { recursive: true });
    await writeFile(
      owner,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date(0).toISOString() }),
    );
    await utimes(owner, new Date(0), new Date(0));
    await writeFile(source, "licensed original");
    const record = await new AssetLibrary(libraryRoot).importAndRecordUse(licensed, source);
    expect(record.useCount).toBe(1);
  });
});

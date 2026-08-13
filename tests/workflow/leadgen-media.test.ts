import { execFile } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { taskConfigSchema } from "../../src/config/schema.js";
import type { DiscoverySignals } from "../../src/discovery/plugins.js";
import type { DiscoveryPlugin } from "../../src/discovery/plugins.js";
import type { AgnesClient } from "../../src/generation/agnes.js";
import { AssetLibrary } from "../../src/media-providers/library.js";
import type { MediaProvider } from "../../src/media-providers/types.js";
import { acquireLeadgenMedia, discoverLeadgenMedia } from "../../src/workflow/leadgen-media.js";

const exec = promisify(execFile);
const noSignals: DiscoverySignals = {
  keywords: [],
  references: [],
  failures: [],
  unavailable: [],
};
const config = taskConfigSchema.parse({
  mode: "leadgen",
  topic: "东方奇幻漫剧",
  workflow: "角色到分镜",
  platform: "test",
  aspectRatio: "9:16",
  targetDurationSeconds: 40,
  audience: "learners",
  ctaKind: "comment-keyword",
  ctaText: "评论漫剧领取流程",
  count: 1,
  concurrency: { jobs: 1 },
  edgeRatio: 1,
  mimoRatio: 0,
  confirmed: true,
});

describe("leadgen media acquisition", () => {
  it("completes with no media API by using at most eight Agnes shots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agnes-only-"));
    const generated: string[] = [];
    const agnes: AgnesClient = {
      async isAvailable() {
        return true;
      },
      async generate(request) {
        const output = path.join(root, `generated-${generated.length}.mp4`);
        await exec("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=720x1280:rate=24:duration=${request.durationSeconds ?? 3}`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          output,
        ]);
        generated.push(output);
        return {
          id: String(generated.length),
          localPath: output,
          width: 720,
          height: 1280,
          durationSeconds: request.durationSeconds,
          model: "test-agnes",
          temporary: true,
        };
      },
    };
    const result = await acquireLeadgenMedia({
      config,
      variant: 0,
      discovery: {
        signals: noSignals,
        request: { query: "x", kind: "video", limit: 80, orientation: "portrait" },
        candidates: [],
        failures: [],
        unavailable: [],
      },
      workspace: path.join(root, "job"),
      library: new AssetLibrary(path.join(root, "library")),
      agnes,
      required: 8,
    });
    expect(result.assets).toHaveLength(8);
    expect(generated).toHaveLength(8);
    expect(
      result.assets.every((asset) => asset.license.commercialUse && asset.sha256.length === 64),
    ).toBe(true);
    await Promise.all(generated.map((file) => expect(access(file)).rejects.toThrow()));
    await Promise.all(
      result.assets.map((asset) => expect(access(asset.originalPath)).resolves.toBeUndefined()),
    );
  }, 120_000);

  it("preserves licensed candidates when another provider fails", async () => {
    const failed: MediaProvider = {
      id: "rate-limited",
      tier: "free",
      async isAvailable() {
        return true;
      },
      async search() {
        throw new Error("HTTP 429 rate limit");
      },
    };
    const healthy: MediaProvider = {
      id: "healthy",
      tier: "free",
      async isAvailable() {
        return true;
      },
      async search() {
        return [
          {
            id: "healthy-1",
            provider: "healthy",
            tier: "free",
            kind: "video",
            previewUrl: "https://example.test/preview",
            sourceUrl: "https://example.test/source",
            downloadUrl: "https://example.test/video",
            author: "author",
            width: 1080,
            height: 1920,
            durationSeconds: 3,
            watermarked: false,
            motionScore: 0.8,
            semanticScore: 0.8,
            compositionScore: 0.8,
            styleScore: 0.8,
            license: {
              name: "Commercial",
              url: "https://example.test/license",
              commercialUse: true,
              attributionRequired: false,
              snapshotText: "Commercial reuse permitted.",
              capturedAt: new Date().toISOString(),
            },
          },
        ];
      },
    };
    const result = await discoverLeadgenMedia(config, [failed, healthy]);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["healthy-1"]);
    expect(result.failures).toEqual([{ provider: "rate-limited", error: "HTTP 429 rate limit" }]);
  });

  it("uses discovery keywords only to expand the provider query", async () => {
    let providerQuery = "";
    const provider: MediaProvider = {
      id: "media",
      tier: "free",
      async isAvailable() {
        return true;
      },
      async search(request) {
        providerQuery = request.query;
        return [];
      },
    };
    const discoveryPlugin: DiscoveryPlugin = {
      id: "trends",
      async isAvailable() {
        return true;
      },
      async discover() {
        return {
          keywords: ["reborn revenge", "cliffhanger"],
          references: [
            {
              source: "trends",
              title: "Reference only",
              url: "https://example.test/trend",
            },
          ],
        };
      },
    };
    const result = await discoverLeadgenMedia(config, [provider], [discoveryPlugin]);
    expect(providerQuery).toContain("reborn revenge cliffhanger");
    expect(result.signals.references).toHaveLength(1);
    expect(result.candidates).toEqual([]);
  });

  it("preserves the original provider query when all discovery plugins are unavailable", async () => {
    let providerQuery = "";
    const provider: MediaProvider = {
      id: "media",
      tier: "free",
      async isAvailable() {
        return true;
      },
      async search(request) {
        providerQuery = request.query;
        return [];
      },
    };
    const unavailable: DiscoveryPlugin = {
      id: "missing",
      async isAvailable() {
        return false;
      },
      async discover() {
        throw new Error("must not run");
      },
    };
    const result = await discoverLeadgenMedia(config, [provider], [unavailable]);
    expect(providerQuery).toBe(`${config.topic} cinematic fantasy AI`);
    expect(result.signals.unavailable).toEqual(["missing"]);
  });

  it("uses Agnes after a provider candidate fails acquisition", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "provider-agnes-fallback-"));
    const generated = path.join(root, "generated.mp4");
    const agnes: AgnesClient = {
      async isAvailable() {
        return true;
      },
      async generate() {
        await exec("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=720x1280:rate=24:duration=3",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          generated,
        ]);
        return {
          id: "fallback",
          localPath: generated,
          width: 720,
          height: 1280,
          durationSeconds: 3,
          model: "test-agnes",
        };
      },
    };
    const broken = {
      id: "broken",
      provider: "broken",
      tier: "free" as const,
      kind: "video" as const,
      previewUrl: "https://invalid.test/preview",
      sourceUrl: "https://invalid.test/source",
      downloadUrl: path.join(root, "missing.mp4"),
      author: "author",
      width: 720,
      height: 1280,
      durationSeconds: 3,
      watermarked: false,
      motionScore: 0.8,
      semanticScore: 0.8,
      compositionScore: 0.8,
      styleScore: 0.8,
      license: {
        name: "Commercial",
        url: "https://invalid.test/license",
        commercialUse: true,
        attributionRequired: false,
        snapshotText: "Commercial use permitted",
        capturedAt: new Date().toISOString(),
      },
    };
    const result = await acquireLeadgenMedia({
      config,
      variant: 0,
      discovery: {
        signals: noSignals,
        request: { query: "x", kind: "video", limit: 40, orientation: "portrait" },
        candidates: [broken],
        failures: [],
        unavailable: [],
      },
      workspace: path.join(root, "job"),
      library: new AssetLibrary(path.join(root, "library")),
      agnes,
      required: 1,
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.provider).toBe("agnes");
    expect(result.gaps.some((gap) => gap.startsWith("broken:"))).toBe(true);
  }, 60_000);

  it("stops filling gaps when Agnes is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agnes-unavailable-"));
    let checks = 0;
    const result = await acquireLeadgenMedia({
      config,
      variant: 0,
      discovery: {
        signals: noSignals,
        request: { query: "x", kind: "video", limit: 40, orientation: "portrait" },
        candidates: [],
        failures: [],
        unavailable: [],
      },
      workspace: path.join(root, "job"),
      library: new AssetLibrary(path.join(root, "library")),
      agnes: {
        async isAvailable() {
          checks += 1;
          return false;
        },
        async generate() {
          throw new Error("must-not-generate");
        },
      },
      required: 8,
    });
    expect(checks).toBe(1);
    expect(result.assets).toHaveLength(0);
    expect(result.gaps).toContain("agnes-shot-1:unavailable");
    expect(result.gaps).toContain("qualified-media:0/8");
  });

  it("uses resource concurrency within one job and preserves candidate order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "candidate-concurrency-"));
    const source = path.join(root, "source.mp4");
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=720x1280:rate=24:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const candidates = Array.from({ length: 4 }, (_, index) => ({
      id: `candidate-${index}`,
      provider: "local",
      tier: "free" as const,
      kind: "video" as const,
      previewUrl: "https://example.test/preview",
      sourceUrl: "https://example.test/source",
      downloadUrl: source,
      author: "author",
      width: 720,
      height: 1280,
      durationSeconds: 1,
      watermarked: false,
      motionScore: 0.9 - index * 0.01,
      semanticScore: 0.9 - index * 0.01,
      compositionScore: 0.9,
      styleScore: 0.9,
      license: {
        name: "Commercial",
        url: "https://example.test/license",
        commercialUse: true,
        attributionRequired: false,
        snapshotText: "Commercial use permitted",
        capturedAt: "2026-08-13T00:00:00.000Z",
      },
    }));
    const peaks = { download: 0, qa: 0 };
    const active = { download: 0, qa: 0 };
    const resource =
      (kind: keyof typeof active) =>
      async <T>(operation: () => Promise<T>): Promise<T> => {
        active[kind] += 1;
        peaks[kind] = Math.max(peaks[kind], active[kind]);
        await new Promise((resolve) => setTimeout(resolve, 30));
        try {
          return await operation();
        } finally {
          active[kind] -= 1;
        }
      };
    const result = await acquireLeadgenMedia({
      config,
      variant: 0,
      discovery: {
        signals: noSignals,
        request: { query: "x", kind: "video", limit: 40, orientation: "portrait" },
        candidates,
        failures: [],
        unavailable: [],
      },
      workspace: path.join(root, "job"),
      library: new AssetLibrary(path.join(root, "library")),
      required: 4,
      resources: { download: resource("download"), qa: resource("qa"), agnes: resource("qa") },
    });
    expect(peaks.download).toBeGreaterThan(1);
    expect(peaks.qa).toBeGreaterThan(1);
    expect(result.assets.map((asset) => asset.mediaId)).toEqual(
      candidates.map((candidate) => candidate.id),
    );
  }, 60_000);
});

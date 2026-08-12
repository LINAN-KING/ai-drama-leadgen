import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMedia } from "../../src/media-providers/download.js";

afterEach(() => vi.unstubAllGlobals());

describe("streaming media downloads", () => {
  it("writes a non-empty response atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "media-download-"));
    const output = path.join(root, "asset.mp4");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("licensed media")));

    await expect(downloadMedia("https://example.test/asset.mp4", output)).resolves.toBe(output);
    await expect(readFile(output, "utf8")).resolves.toBe("licensed media");
    expect(await readdir(root)).toEqual(["asset.mp4"]);
  });

  it("rejects an empty response without publishing the target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "empty-media-download-"));
    const output = path.join(root, "asset.mp4");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));

    await expect(downloadMedia("https://example.test/asset.mp4", output)).rejects.toThrow(
      "empty file",
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("removes a partial file when the response stream fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "failed-media-download-"));
    const output = path.join(root, "asset.mp4");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new Error("stream failed"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(downloadMedia("https://example.invalid/asset.mp4", output, 100)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
});

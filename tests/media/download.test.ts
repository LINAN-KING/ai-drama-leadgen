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

  it.each([
    "http://example.test/asset.mp4",
    "file:///etc/passwd",
    "https://localhost/asset.mp4",
    "https://127.0.0.1/asset.mp4",
    "https://10.0.0.1/asset.mp4",
    "https://192.168.1.1/asset.mp4",
    "https://172.16.0.1/asset.mp4",
    "https://[::1]/asset.mp4",
  ])("rejects unsafe download URL %s", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadMedia(url, path.join(os.tmpdir(), "unsafe.mp4"))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a fetch redirect that resolves to an unsafe host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "redirect-download-"));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private.mp4" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadMedia("https://example.test/asset.mp4", path.join(root, "asset.mp4")),
    ).rejects.toThrow("Unsafe media request host");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toEqual([]);
  });
});

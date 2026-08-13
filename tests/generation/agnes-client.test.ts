import { afterEach, describe, expect, it, vi } from "vitest";
import { AgnesApiClient } from "../../src/generation/agnes-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Agnes API client", () => {
  it("creates, polls by video_id, and downloads the completed video", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (url: URL, init?: RequestInit) => {
        requests.push({ url: url.toString(), init });
        return new Response(
          JSON.stringify({ video_id: "video-1", task_id: "task-1", status: "queued" }),
        );
      })
      .mockImplementationOnce(async (url: URL, init?: RequestInit) => {
        requests.push({ url: url.toString(), init });
        return new Response(JSON.stringify({ video_id: "video-1", status: "in_progress" }));
      })
      .mockImplementationOnce(async (url: URL, init?: RequestInit) => {
        requests.push({ url: url.toString(), init });
        return new Response(
          JSON.stringify({
            video_id: "video-1",
            status: "completed",
            seconds: "3.0",
            size: "448x832",
            metadata: { url: "https://outputs.example.test/video.mp4" },
          }),
        );
      });
    vi.stubGlobal("fetch", fetchMock);
    const downloads: string[] = [];
    const client = new AgnesApiClient({
      credential: async () => "secret",
      pollIntervalMs: 0,
      download: async (url, output) => {
        downloads.push(`${url}:${output}`);
      },
      outputRoot: "C:\\agnes-output",
    });
    const artifact = await client.generate({
      prompt: "cinematic",
      kind: "video",
      aspectRatio: "9:16",
      durationSeconds: 3,
      seed: 42,
    });
    expect(requests[0]?.url).toBe("https://apihub.agnes-ai.com/v1/videos");
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      model: "agnes-video-v2.0",
      prompt: "cinematic",
      width: 448,
      height: 832,
      num_frames: 73,
      frame_rate: 24,
      seed: 42,
    });
    expect(requests.slice(1).map(({ url }) => url)).toEqual([
      "https://apihub.agnes-ai.com/agnesapi?video_id=video-1",
      "https://apihub.agnes-ai.com/agnesapi?video_id=video-1",
    ]);
    expect(downloads[0]).toContain("https://outputs.example.test/video.mp4");
    expect(artifact).toMatchObject({
      id: "video-1",
      width: 448,
      height: 832,
      durationSeconds: 3,
      model: "agnes-video-v2.0",
    });
  });

  it("fails closed on terminal errors and missing credentials", async () => {
    const noCredential = new AgnesApiClient({ credential: async () => null });
    await expect(noCredential.isAvailable()).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ video_id: "v", status: "queued" })))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ video_id: "v", status: "failed", error: "blocked" })),
        ),
    );
    const failed = new AgnesApiClient({
      credential: async () => "secret",
      pollIntervalMs: 0,
    });
    await expect(
      failed.generate({ prompt: "x", kind: "video", aspectRatio: "1:1", seed: 1 }),
    ).rejects.toThrow("Agnes generation failed");
  });

  it("does not replay a video creation request after an ambiguous transport failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection reset after request upload");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new AgnesApiClient({ credential: async () => "secret" });
    await expect(
      client.generate({ prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 }),
    ).rejects.toThrow("connection reset after request upload");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a terminal failure returned by the final poll", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ video_id: "video-1", status: "queued" })),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              video_id: "video-1",
              status: "failed",
              error: "quota exhausted",
            }),
          ),
        ),
    );
    const client = new AgnesApiClient({
      credential: async () => "secret",
      pollIntervalMs: 0,
      maxPolls: 1,
    });
    await expect(
      client.generate({ prompt: "x", kind: "video", aspectRatio: "9:16", seed: 1 }),
    ).rejects.toThrow(/quota exhausted/);
  });
});

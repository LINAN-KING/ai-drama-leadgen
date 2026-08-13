import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../../src/media-providers/http.js";

afterEach(() => vi.unstubAllGlobals());

describe("provider HTTP recovery", () => {
  it("allows non-idempotent callers to disable retries", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection reset after upload");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchJson(
        new URL("https://example.test/create"),
        { method: "POST", body: "payload" },
        undefined,
        30_000,
        1,
      ),
    ).rejects.toThrow("connection reset after upload");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit and returns the later response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson(new URL("https://example.test"), {})).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated transport failures", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson(new URL("https://example.test"), {})).rejects.toThrow("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("aborts each hung attempt within its own timeout", async () => {
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson(new URL("https://example.test"), {}, undefined, 5)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("composes caller cancellation with the attempt timeout", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchJson(new URL("https://example.test"), {}, controller.signal, 30_000);
    controller.abort(new Error("caller stopped"));
    await expect(pending).rejects.toThrow("caller stopped");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a private redirect before requesting its target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://127.0.0.1/api" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson(new URL("https://example.test"), {})).rejects.toThrow(
      "Unsafe media request host",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.every(([url]) => new URL(String(url)).hostname === "example.test"),
    ).toBe(true);
  });

  it("strips credentials from a cross-origin redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.test/result" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchJson(new URL("https://api.example.test/search"), {
        headers: { Authorization: "secret", Cookie: "session=secret" },
      }),
    ).resolves.toEqual({ ok: true });
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.has("authorization")).toBe(false);
    expect(secondHeaders.has("cookie")).toBe(false);
  });

  it("rejects an oversized declared JSON response before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { headers: { "content-length": String(6 * 1024 * 1024) } }),
        ),
    );
    await expect(fetchJson(new URL("https://example.test"), {})).rejects.toThrow(
      "response exceeded",
    );
  });

  it("stops reading an oversized streamed JSON response", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
              controller.close();
            },
          }),
        ),
      ),
    );
    await expect(fetchJson(new URL("https://example.test"), {})).rejects.toThrow(
      "response exceeded",
    );
  });

  it("bounds an oversized error response body", async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(1_000_000)));
        },
        cancel: cancelled,
      }),
      { status: 400 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(fetchJson(new URL("https://example.test"), {})).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/x{500}$/),
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });
});

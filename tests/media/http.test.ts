import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../../src/media-providers/http.js";

afterEach(() => vi.unstubAllGlobals());

describe("provider HTTP recovery", () => {
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
});

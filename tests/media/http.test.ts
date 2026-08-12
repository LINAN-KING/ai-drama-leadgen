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
});

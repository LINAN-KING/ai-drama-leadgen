import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReferenceHtml } from "../../src/discovery/crawl4ai.js";

afterEach(() => vi.unstubAllGlobals());

describe("Crawl4AI reference snapshots", () => {
  it("rejects unsafe hosts before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchReferenceHtml("https://127.0.0.1/private")).rejects.toThrow("Unsafe");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow redirects", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 302, headers: { location: "https://example.test/next" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchReferenceHtml("https://example.test/start")).rejects.toThrow(
      "redirects are not followed",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("accepts bounded HTML and rejects other content types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<main>Reference</main>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ),
    );
    await expect(fetchReferenceHtml("https://example.test/page")).resolves.toBe(
      "<main>Reference</main>",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })),
    );
    await expect(fetchReferenceHtml("https://example.test/data")).rejects.toThrow(
      "unsupported content type",
    );
  });

  it("rejects declared oversized pages before reading the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("small", {
            headers: {
              "content-type": "text/html",
              "content-length": String(1024 * 1024 + 1),
            },
          }),
      ),
    );
    await expect(fetchReferenceHtml("https://example.test/huge")).rejects.toThrow(
      "exceeded 1048576 bytes",
    );
  });
});

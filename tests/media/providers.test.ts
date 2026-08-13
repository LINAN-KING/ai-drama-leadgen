import { afterEach, describe, expect, it, vi } from "vitest";
import { PexelsProvider } from "../../src/media-providers/pexels.js";
import { PixabayProvider } from "../../src/media-providers/pixabay.js";
import {
  UnconfiguredProvider,
  availableMediaProviders,
  createProviderCatalog,
} from "../../src/media-providers/catalog.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("licensed provider adapters", () => {
  it("maps Pexels videos and chooses the highest-resolution MP4", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              videos: [
                {
                  id: 7,
                  duration: 3,
                  url: "https://pexels.test/7",
                  user: { name: "A" },
                  image: "preview",
                  video_files: [
                    {
                      id: 1,
                      quality: "sd",
                      file_type: "video/mp4",
                      width: 640,
                      height: 360,
                      link: "small",
                    },
                    {
                      id: 2,
                      quality: "hd",
                      file_type: "video/mp4",
                      width: 1920,
                      height: 1080,
                      link: "large",
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const [candidate] = await new PexelsProvider("key").search({
      query: "fantasy",
      kind: "video",
      limit: 40,
      orientation: "portrait",
    });
    expect(candidate?.downloadUrl).toBe("large");
    expect(candidate?.license?.commercialUse).toBe(true);
    expect(candidate?.author).toBe("A");
    expect(candidate?.license?.capturedAt).toBe("2026-08-13T00:00:00.000Z");
    expect(candidate?.license?.evidenceKind).toBe("manual-summary");
    expect(candidate?.license?.snapshotSha256).toBeUndefined();
  });

  it("maps Pixabay images with source and license evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              hits: [
                {
                  id: 9,
                  pageURL: "source",
                  user: "B",
                  imageWidth: 2000,
                  imageHeight: 1200,
                  previewURL: "preview",
                  largeImageURL: "original",
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const [candidate] = await new PixabayProvider("key").search({
      query: "castle",
      kind: "image",
      limit: 40,
      orientation: "landscape",
    });
    expect(candidate).toMatchObject({ sourceUrl: "source", downloadUrl: "original", author: "B" });
    expect(candidate?.license?.snapshotText).toContain("Royalty-free");
    expect(candidate?.license?.capturedAt).toBe("2026-08-13T00:00:00.000Z");
    expect(candidate?.license?.evidenceKind).toBe("manual-summary");
    expect(candidate?.license?.snapshotSha256).toBeUndefined();
  });

  it("does no network work when credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await new PexelsProvider(undefined).search({
        query: "x",
        kind: "image",
        limit: 40,
        orientation: "square",
      }),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps catalog placeholders unavailable even when their credential exists", async () => {
    vi.stubEnv("FREEPIK_API_KEY", "present");
    const placeholder = new UnconfiguredProvider("freepik", "paid", "FREEPIK_API_KEY");
    expect(await placeholder.isAvailable()).toBe(false);
    expect(
      await placeholder.search({ query: "x", kind: "image", limit: 1, orientation: "square" }),
    ).toEqual([]);
    expect(await availableMediaProviders([placeholder])).toEqual([]);
  });

  it("accepts Wikimedia as the only credential-free concrete provider", async () => {
    vi.stubEnv("PEXELS_API_KEY", "");
    vi.stubEnv("PIXABAY_API_KEY", "");
    vi.stubEnv("AGNES_API_KEY", "credential-without-client");
    expect((await availableMediaProviders(createProviderCatalog())).map(({ id }) => id)).toEqual([
      "wikimedia",
    ]);
  });
});

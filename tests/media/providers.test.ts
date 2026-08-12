import { afterEach, describe, expect, it, vi } from "vitest";
import { PexelsProvider } from "../../src/media-providers/pexels.js";
import { PixabayProvider } from "../../src/media-providers/pixabay.js";

afterEach(() => vi.unstubAllGlobals());

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
});

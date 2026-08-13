import { afterEach, describe, expect, it, vi } from "vitest";
import { PexelsProvider } from "../../src/media-providers/pexels.js";
import { PixabayProvider } from "../../src/media-providers/pixabay.js";
import { EuropeanaProvider } from "../../src/media-providers/europeana.js";
import { InternetArchiveProvider } from "../../src/media-providers/internet-archive.js";
import { SmithsonianProvider } from "../../src/media-providers/smithsonian.js";
import { openLicenseEvidence } from "../../src/media-providers/open-license.js";
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

  it("accepts only recognized commercial open-license URIs", () => {
    expect(openLicenseEvidence("https://creativecommons.org/publicdomain/zero/1.0/")?.name).toBe(
      "CC0 1.0",
    );
    expect(
      openLicenseEvidence("https://creativecommons.org/licenses/by/4.0/")?.attributionRequired,
    ).toBe(true);
    expect(openLicenseEvidence("https://creativecommons.org/licenses/by-nc/4.0/")).toBeNull();
    expect(openLicenseEvidence("https://creativecommons.org/licenses/by-nd/4.0/")).toBeNull();
    expect(openLicenseEvidence("https://example.test/custom-license")).toBeNull();
    expect(
      openLicenseEvidence(
        "https://evil.example/?license=https://creativecommons.org/licenses/by/4.0/",
      ),
    ).toBeNull();
    expect(openLicenseEvidence("https://creativecommons.org/licenses/by/4.0/extra")).toBeNull();
    expect(openLicenseEvidence("not-a-url")).toBeNull();
  });

  it("maps only resource-level CC0 Smithsonian media with explicit dimensions", async () => {
    const response = {
      response: {
        rows: [
          {
            id: "record:1",
            title: "Castle",
            content: {
              freetext: { name: [{ label: "Artist", content: "Artist A" }] },
              descriptiveNonRepeating: {
                record_link: "https://si.test/record",
                online_media: {
                  media: [
                    {
                      id: "blocked",
                      type: "Images",
                      usage: { access: "Usage conditions apply" },
                      resources: [
                        {
                          label: "High-resolution JPEG",
                          url: "https://ids.si.edu/blocked.jpg",
                          width: 3000,
                          height: 2000,
                        },
                      ],
                    },
                    {
                      id: "open",
                      type: "Images",
                      usage: { access: "CC0" },
                      thumbnail: "https://ids.si.edu/thumb.jpg",
                      resources: [
                        {
                          label: "High-resolution JPEG",
                          url: "https://ids.si.edu/open.jpg",
                          width: 3000,
                          height: 2000,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })),
    );
    const candidates = await new SmithsonianProvider("key").search({
      query: "castle",
      kind: "video",
      limit: 40,
      orientation: "portrait",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "image",
      downloadUrl: "https://ids.si.edu/open.jpg",
      author: "Artist A",
      width: 3000,
      height: 2000,
    });
    expect(candidates[0]?.license?.evidenceKind).toBe("provider-response");
  });

  it("requires HTTPS, dimensions, and open resource rights for Europeana candidates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "/collection/1",
                rights: ["http://creativecommons.org/publicdomain/zero/1.0/"],
                provider: ["Museum"],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: {
              europeanaAggregation: { edmLandingPage: "https://europeana.eu/item/1" },
              aggregations: [
                {
                  edmRights: { def: ["http://creativecommons.org/publicdomain/zero/1.0/"] },
                  webResources: [
                    {
                      about: "https://source.test/no-resource-rights.jpg",
                      ebucoreHasMimeType: "image/jpeg",
                      ebucoreWidth: 2000,
                      ebucoreHeight: 1200,
                    },
                    {
                      about: "http://source.test/insecure.jpg",
                      ebucoreHasMimeType: "image/jpeg",
                      ebucoreWidth: 2000,
                      ebucoreHeight: 1200,
                      webResourceEdmRights: {
                        def: ["http://creativecommons.org/publicdomain/zero/1.0/"],
                      },
                    },
                    {
                      about: "https://source.test/open.jpg",
                      ebucoreHasMimeType: "image/jpeg",
                      ebucoreWidth: 2000,
                      ebucoreHeight: 1200,
                      webResourceEdmRights: {
                        def: ["http://creativecommons.org/publicdomain/zero/1.0/"],
                      },
                    },
                  ],
                },
              ],
              proxies: [{ dcCreator: { def: ["Creator"] } }],
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const candidates = await new EuropeanaProvider("key").search({
      query: "castle",
      kind: "video",
      limit: 40,
      orientation: "portrait",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "image",
      downloadUrl: "https://source.test/open.jpg",
      author: "Creator",
    });
  });

  it("rejects noncommercial and dimensionless Internet Archive files", async () => {
    const responses = [
      {
        response: {
          docs: [
            {
              identifier: "open",
              creator: "Creator",
              licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/",
            },
            {
              identifier: "nc",
              creator: "Creator",
              licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/",
            },
          ],
        },
      },
      {
        files: [
          { name: "unknown.jpg", source: "original", format: "JPEG" },
          {
            name: "usable.jpg",
            source: "original",
            format: "JPEG",
            width: "2400",
            height: "1600",
          },
        ],
      },
    ];
    let requests = 0;
    const candidates = await new InternetArchiveProvider(async <T>() => {
      const response = responses[requests++];
      return response as T;
    }).search({
      query: "castle",
      kind: "image",
      limit: 40,
      orientation: "landscape",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      downloadUrl: "https://archive.org/download/open/usable.jpg",
      width: 2400,
      height: 1600,
    });
    expect(requests).toBe(2);
  });

  it("rejects Internet Archive videos outside the media QA duration bound", async () => {
    const responses = [
      {
        response: {
          docs: [
            {
              identifier: "video",
              creator: "Creator",
              licenseurl: "https://creativecommons.org/licenses/by/4.0/",
            },
          ],
        },
      },
      {
        files: [
          {
            name: "long.mp4",
            source: "original",
            format: "MPEG4",
            width: "1280",
            height: "720",
            length: "149.37",
          },
          {
            name: "usable.mp4",
            source: "original",
            format: "MPEG4",
            width: "1280",
            height: "720",
            length: "12.5",
          },
        ],
      },
    ];
    let requests = 0;
    const candidates = await new InternetArchiveProvider(
      async <T>() => responses[requests++] as T,
    ).search({ query: "castle", kind: "video", limit: 40, orientation: "landscape" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      downloadUrl: "https://archive.org/download/video/usable.mp4",
      durationSeconds: 12.5,
    });
  });

  it("rejects attribution-required open assets without a named creator", async () => {
    const responses = [
      {
        response: {
          docs: [
            {
              identifier: "missing-creator",
              licenseurl: "https://creativecommons.org/licenses/by/4.0/",
            },
          ],
        },
      },
      {
        files: [
          {
            name: "asset.jpg",
            source: "original",
            format: "JPEG",
            width: "1280",
            height: "720",
          },
        ],
      },
    ];
    let requests = 0;
    const candidates = await new InternetArchiveProvider(
      async <T>() => responses[requests++] as T,
    ).search({ query: "castle", kind: "image", limit: 40, orientation: "landscape" });
    expect(candidates).toEqual([]);
  });

  it("surfaces a provider error when every Internet Archive metadata request fails", async () => {
    let requests = 0;
    const provider = new InternetArchiveProvider(async <T>() => {
      requests += 1;
      if (requests === 1)
        return {
          response: {
            docs: [
              {
                identifier: "broken",
                licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/",
              },
            ],
          },
        } as T;
      throw new Error("metadata timeout");
    });
    await expect(
      provider.search({ query: "castle", kind: "image", limit: 40, orientation: "landscape" }),
    ).rejects.toThrow("Internet Archive metadata requests failed");
  });

  it("accepts Wikimedia and Internet Archive as credential-free concrete providers", async () => {
    vi.stubEnv("PEXELS_API_KEY", "");
    vi.stubEnv("PIXABAY_API_KEY", "");
    vi.stubEnv("AGNES_API_KEY", "credential-without-client");
    expect((await availableMediaProviders(createProviderCatalog())).map(({ id }) => id)).toEqual([
      "wikimedia",
      "internet-archive",
    ]);
  });
});

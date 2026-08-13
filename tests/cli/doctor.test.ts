import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { collectDoctorReport, inspectDiscoveryEndpoint } from "../../src/cli/commands/doctor.js";

describe("doctor", () => {
  const originalSearxngUrl = process.env.SEARXNG_URL;
  let report: Awaited<ReturnType<typeof collectDoctorReport>>;
  beforeAll(async () => {
    report = await collectDoctorReport();
  }, 15_000);

  it("detects the npm launcher on Windows", () => {
    const npm = report.capabilities.find((item) => item.id === "npm");
    expect(npm?.status).toBe("available");
    expect(npm?.version).toMatch(/^\d+\.\d+/);
  });

  it("detects MiMo from Windows Credential Manager without exposing its value", () => {
    const mimo = report.capabilities.find((item) => item.id === "mimo");
    expect(mimo?.status).toBe("available");
    expect(mimo?.detail).toContain("Windows Credential Manager");
  });

  it("reports every runtime discovery capability explicitly", () => {
    expect(report.capabilities.map((item) => item.id)).toEqual(
      expect.arrayContaining(["agent-reach", "crawl4ai", "firecrawl", "searxng"]),
    );
  });

  it.each(["http://example.test", "https://127.0.0.1:8080", "not-a-url"])(
    "does not report unsafe SearXNG endpoint %s as available",
    async (url) => {
      process.env.SEARXNG_URL = url;
      await expect(
        inspectDiscoveryEndpoint(
          "searxng",
          "SearXNG discovery",
          ["SEARXNG_URL"],
          "SEARXNG_URL",
          async () => [{ address: "8.8.8.8", family: 4 }],
        ),
      ).resolves.toMatchObject({
        status: "manual-action",
      });
    },
  );

  it("does not report a private-resolving discovery hostname as available", async () => {
    process.env.SEARXNG_URL = "https://search.example.test";
    await expect(
      inspectDiscoveryEndpoint(
        "searxng",
        "SearXNG discovery",
        ["SEARXNG_URL"],
        "SEARXNG_URL",
        async () => {
          throw new Error("Unsafe DNS result for media host: search.example.test");
        },
      ),
    ).resolves.toMatchObject({ status: "manual-action" });
  });

  afterEach(() => {
    if (originalSearxngUrl === undefined) delete process.env.SEARXNG_URL;
    else process.env.SEARXNG_URL = originalSearxngUrl;
  });
});

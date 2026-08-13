import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentReachDiscoveryPlugin,
  collectDiscoverySignals,
  FirecrawlDiscoveryPlugin,
  SearxngDiscoveryPlugin,
  type DiscoveryPlugin,
} from "../../src/discovery/plugins.js";

afterEach(() => vi.unstubAllGlobals());

function plugin(
  id: string,
  result: Awaited<ReturnType<DiscoveryPlugin["discover"]>>,
): DiscoveryPlugin {
  return {
    id,
    async isAvailable() {
      return true;
    },
    async discover() {
      return result;
    },
  };
}

describe("discovery plugins", () => {
  it("returns an empty deterministic report for an empty plugin list", async () => {
    await expect(collectDiscoverySignals([], "query")).resolves.toEqual({
      keywords: [],
      references: [],
      failures: [],
      unavailable: [],
    });
  });

  it("isolates failures and unavailable plugins", async () => {
    const failed: DiscoveryPlugin = {
      id: "failed",
      async isAvailable() {
        return true;
      },
      async discover() {
        throw new Error("temporary failure");
      },
    };
    const unavailable: DiscoveryPlugin = {
      id: "missing",
      async isAvailable() {
        return false;
      },
      async discover() {
        throw new Error("must not run");
      },
    };
    const result = await collectDiscoverySignals([failed, unavailable], "query", 2);
    expect(result.failures).toEqual([{ plugin: "failed", error: "temporary failure" }]);
    expect(result.unavailable).toEqual(["missing"]);
  });

  it("sanitizes, deduplicates, bounds keywords and retains only HTTPS references", async () => {
    const result = await collectDiscoverySignals(
      [
        plugin("source", {
          keywords: [
            "Alpha!",
            "alpha",
            "x",
            "video",
            ...Array.from({ length: 12 }, (_, index) => `key-${index}`),
          ],
          references: [
            { source: "spoofed", title: "Trend\u0000 Signal", url: "https://example.test/a" },
            { source: "spoofed", title: "Unsafe", url: "http://example.test/b" },
            { source: "spoofed", title: "Broken", url: "not-a-url" },
          ],
        }),
      ],
      "query",
    );
    expect(result.keywords).toHaveLength(8);
    expect(result.keywords).toContain("Alpha");
    expect(result.references).toEqual([
      { source: "source", title: "Trend Signal", url: "https://example.test/a" },
    ]);
  });

  it("does no network work when optional services are not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const plugins = [
      new FirecrawlDiscoveryPlugin(undefined, undefined),
      new SearxngDiscoveryPlugin(undefined),
    ];
    const result = await collectDiscoverySignals(plugins, "query");
    expect(result.unavailable).toEqual(["firecrawl", "searxng"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    new FirecrawlDiscoveryPlugin("http://127.0.0.1:3002", "secret"),
    new SearxngDiscoveryPlugin("https://127.0.0.1:8080"),
  ])("rejects unsafe configured service URLs", async (unsafePlugin) => {
    const result = await collectDiscoverySignals([unsafePlugin], "query");
    expect(result.failures[0]?.plugin).toBe(unsafePlugin.id);
    expect(result.failures[0]?.error).toMatch(/HTTPS|Unsafe/);
  });

  it("forwards cancellation to plugins", async () => {
    const controller = new AbortController();
    const waiting: DiscoveryPlugin = {
      id: "waiting",
      async isAvailable() {
        return true;
      },
      async discover(_query, signal) {
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    const pending = collectDiscoverySignals([waiting], "query", 1, controller.signal);
    controller.abort(new Error("caller stopped"));
    await expect(pending).rejects.toThrow("caller stopped");
  });

  it("rejects an exit-zero mcporter response for an unknown server", async () => {
    const agentReach = new AgentReachDiscoveryPlugin(
      async () => ({
        stdout: "Unknown MCP server 'missing'.",
        stderr: "",
      }),
      "missing",
    );
    await expect(agentReach.isAvailable()).resolves.toBe(false);
  });

  it("accepts a ready mcporter server with the required search tool", async () => {
    const agentReach = new AgentReachDiscoveryPlugin(
      async () => ({
        stdout: JSON.stringify({
          mode: "server",
          name: "exa",
          status: "ok",
          tools: [{ name: "web_search_exa" }],
        }),
        stderr: "",
      }),
      "exa",
    );
    await expect(agentReach.isAvailable()).resolves.toBe(true);
  });
});

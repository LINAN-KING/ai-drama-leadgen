import { describe, expect, it } from "vitest";
import { discoverCandidates } from "../../src/discovery/discover.js";
import type { MediaProvider } from "../../src/media-providers/types.js";

function provider(id: string, behavior: "ok" | "fail" | "missing"): MediaProvider {
  return {
    id,
    tier: "free",
    async isAvailable() {
      return behavior !== "missing";
    },
    async search() {
      if (behavior === "fail") throw new Error("timeout");
      return [];
    },
  };
}

describe("discovery degradation", () => {
  it("isolates provider failures and reports unavailable providers", async () => {
    const result = await discoverCandidates(
      [provider("ok", "ok"), provider("bad", "fail"), provider("off", "missing")],
      { query: "fantasy", kind: "video", limit: 40, orientation: "portrait" },
      3,
    );
    expect(result.failures).toEqual([{ provider: "bad", error: "timeout" }]);
    expect(result.unavailable).toEqual(["off"]);
  });
});

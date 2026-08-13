import { describe, expect, it } from "vitest";
import { runBinary } from "../../src/ffmpeg/process.js";

describe("bounded child processes", () => {
  it("terminates an in-flight process when its signal aborts", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = runBinary(
      process.execPath,
      ["-e", "setTimeout(() => undefined, 30_000)"],
      60_000,
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 25);
    await expect(running).rejects.toThrow(/cancelled|abort/i);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

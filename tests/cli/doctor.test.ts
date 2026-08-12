import { describe, expect, it } from "vitest";
import { collectDoctorReport } from "../../src/cli/commands/doctor.js";

describe("doctor", () => {
  it("detects the npm launcher on Windows", async () => {
    const report = await collectDoctorReport();
    const npm = report.capabilities.find((item) => item.id === "npm");
    expect(npm?.status).toBe("available");
    expect(npm?.version).toMatch(/^\d+\.\d+/);
  });
});

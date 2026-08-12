import { describe, expect, it } from "vitest";
import { collectDoctorReport } from "../../src/cli/commands/doctor.js";

describe("doctor", () => {
  it("detects the npm launcher on Windows", async () => {
    const report = await collectDoctorReport();
    const npm = report.capabilities.find((item) => item.id === "npm");
    expect(npm?.status).toBe("available");
    expect(npm?.version).toMatch(/^\d+\.\d+/);
  });

  it("detects MiMo from Windows Credential Manager without exposing its value", async () => {
    const report = await collectDoctorReport();
    const mimo = report.capabilities.find((item) => item.id === "mimo");
    expect(mimo?.status).toBe("available");
    expect(mimo?.detail).toContain("Windows Credential Manager");
  });
});

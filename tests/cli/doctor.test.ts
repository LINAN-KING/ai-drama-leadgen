import { beforeAll, describe, expect, it } from "vitest";
import { collectDoctorReport } from "../../src/cli/commands/doctor.js";

describe("doctor", () => {
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
});

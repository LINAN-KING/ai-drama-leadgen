import { readTaskConfig } from "../../config/files.js";
import { collectDoctorReport } from "./doctor.js";

export async function runValidate(configPath: string): Promise<void> {
  const config = await readTaskConfig(configPath);
  const doctor = await collectDoctorReport();
  const requiredMissing = doctor.capabilities.filter((item) => item.status === "missing");
  const providerAvailable = doctor.capabilities.some(
    (item) => ["free-media", "agnes"].includes(item.id) && item.status === "available",
  );
  const errors = requiredMissing.map((item) => `${item.label}: ${item.detail}`);
  if (config.mode === "leadgen" && !providerAvailable) {
    errors.push("leadgen requires at least one usable media source: a free provider or Agnes");
  }
  const result = {
    ok: errors.length === 0,
    config: {
      mode: config.mode,
      count: config.count,
      jobs: config.concurrency.jobs,
      targetDurationSeconds: config.targetDurationSeconds,
    },
    errors,
    warnings: doctor.capabilities
      .filter((item) => item.status === "manual-action")
      .map((item) => `${item.label}: ${item.detail}`),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

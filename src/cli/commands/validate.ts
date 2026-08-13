import { readTaskConfig } from "../../config/files.js";
import { collectDoctorReport } from "./doctor.js";
import { availableMediaProviders } from "../../media-providers/catalog.js";
import { AgnesApiClient } from "../../generation/agnes-client.js";

export async function runValidate(configPath: string): Promise<void> {
  const config = await readTaskConfig(configPath);
  const doctor = await collectDoctorReport();
  const requiredMissing = doctor.capabilities.filter((item) => item.status === "missing");
  const availableProviders = await availableMediaProviders();
  const agnesAvailable = await new AgnesApiClient().isAvailable();
  const errors = requiredMissing.map((item) => `${item.label}: ${item.detail}`);
  if (config.mode === "leadgen" && availableProviders.length === 0 && !agnesAvailable) {
    errors.push("leadgen requires an implemented licensed media provider or Agnes generation");
  }
  const result = {
    ok: errors.length === 0,
    config: {
      mode: config.mode,
      count: config.count,
      jobs: config.concurrency.jobs,
      targetDurationSeconds: config.targetDurationSeconds,
      mediaProviders: availableProviders.map((provider) => provider.id),
      agnesAvailable,
    },
    errors,
    warnings: doctor.capabilities
      .filter((item) => item.status === "manual-action")
      .map((item) => `${item.label}: ${item.detail}`),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

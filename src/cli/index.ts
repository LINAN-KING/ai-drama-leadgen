#!/usr/bin/env node
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runConfigure } from "./commands/configure.js";
import { runValidate } from "./commands/validate.js";

const program = new Command()
  .name("drama-leadgen")
  .description("Generate deterministic AI drama process and lead-generation videos")
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("doctor")
  .description("Inspect local runtime and optional provider capabilities")
  .option("-o, --output <path>", "report path", "doctor-report.json")
  .action(async ({ output }: { output: string }) => runDoctor(output));

program
  .command("configure")
  .description("Validate and persist a confirmed task configuration")
  .requiredOption("-i, --input <path>", "input JSON file")
  .option("-o, --output <path>", "normalized config path", "config.json")
  .action(async ({ input, output }: { input: string; output: string }) =>
    runConfigure(input, output),
  );

program
  .command("validate")
  .description("Validate configuration and local prerequisites without rendering")
  .requiredOption("-c, --config <path>", "task config JSON")
  .action(async ({ config }: { config: string }) => runValidate(config));

for (const name of ["generate", "batch", "resume"] as const) {
  program
    .command(name)
    .description(`${name} workflow`)
    .allowUnknownOption(false)
    .action(() => {
      throw new Error(`${name} is unavailable until the generation pipeline is initialized`);
    });
}

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

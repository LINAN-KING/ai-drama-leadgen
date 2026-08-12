#!/usr/bin/env node
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runConfigure } from "./commands/configure.js";
import { runValidate } from "./commands/validate.js";
import { runScaffold } from "./commands/scaffold.js";
import { runBatchCommand, runGenerate, runResume } from "./commands/workflow.js";

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

program
  .command("scaffold")
  .description("Generate the six deterministic workbench templates in three aspect ratios")
  .option("-o, --output <path>", "output directory", "templates/generated")
  .option("--seed <number>", "deterministic seed", (value) => Number.parseInt(value, 10), 20260813)
  .action(async ({ output, seed }: { output: string; seed: number }) => runScaffold(output, seed));

program
  .command("generate")
  .description("Generate one video in an isolated resumable workspace")
  .requiredOption("-c, --config <path>")
  .option("-w, --workspace <path>", "workspace", "workspaces/generate")
  .action(({ config, workspace }: { config: string; workspace: string }) =>
    runGenerate(config, workspace),
  );
program
  .command("batch")
  .description("Generate the configured number of QA-passing videos")
  .requiredOption("-c, --config <path>")
  .option("-w, --workspace <path>", "workspace", "workspaces/batch")
  .action(({ config, workspace }: { config: string; workspace: string }) =>
    runBatchCommand(config, workspace),
  );
program
  .command("resume")
  .description("Resume failed or invalidated nodes in a workspace")
  .requiredOption("-c, --config <path>")
  .requiredOption("-w, --workspace <path>")
  .action(({ config, workspace }: { config: string; workspace: string }) =>
    runResume(config, workspace),
  );

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

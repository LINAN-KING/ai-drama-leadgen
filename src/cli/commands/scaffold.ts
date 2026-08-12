import path from "node:path";
import { writeAllWorkbenchProjects } from "../../hyperframes/workbench.js";

export async function runScaffold(output: string, seed: number): Promise<void> {
  const projects = await writeAllWorkbenchProjects(output, seed);
  process.stdout.write(
    `Generated ${projects.length} workbench projects in ${path.resolve(output)}\n`,
  );
}

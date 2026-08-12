import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BatchState } from "./types.js";

export class WorkflowStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly workspace: string) {}
  private get statePath() {
    return path.join(this.workspace, "batch-state.json");
  }
  async read(): Promise<BatchState> {
    return JSON.parse(await readFile(this.statePath, "utf8")) as BatchState;
  }
  async write(state: BatchState): Promise<void> {
    const snapshot = `${JSON.stringify(state, null, 2)}\n`;
    const persist = async () => {
      await mkdir(this.workspace, { recursive: true });
      const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, "utf8");
      await rename(temporary, this.statePath);
    };
    this.writeQueue = this.writeQueue.then(persist, persist);
    await this.writeQueue;
  }
}

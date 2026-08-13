import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseBatchState, type BatchState } from "./types.js";
import { writeAtomicDurable } from "./atomic-file.js";

export class WorkflowStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(readonly workspace: string) {}
  private get statePath() {
    return path.join(this.workspace, "batch-state.json");
  }
  async read(): Promise<BatchState> {
    try {
      return parseBatchState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid persisted batch state at ${this.statePath}: ${detail}`, {
        cause: error,
      });
    }
  }
  async write(state: BatchState): Promise<void> {
    const snapshot = `${JSON.stringify(state, null, 2)}\n`;
    const persist = () => writeAtomicDurable(this.statePath, snapshot);
    this.writeQueue = this.writeQueue.then(persist, persist);
    await this.writeQueue;
  }
}

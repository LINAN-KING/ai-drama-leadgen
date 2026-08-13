import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaCandidate } from "./types.js";
import { evaluateCandidate } from "../media-qa/filter.js";
import { writeAtomicDurable } from "../workflow/atomic-file.js";

export interface AssetRecord {
  mediaId: string;
  sha256: string;
  originalPath: string;
  sourceUrl: string;
  author: string;
  provider: string;
  license: NonNullable<MediaCandidate["license"]>;
  downloadedAt: string;
  width: number;
  height: number;
  durationSeconds?: number;
  qualityScore: number;
  useCount: number;
}

interface LibraryIndex {
  assets: Record<string, AssetRecord>;
}

export class AssetLibrary {
  private readonly indexPath: string;
  private readonly originalsPath: string;
  private readonly lockPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly root: string) {
    this.indexPath = path.join(root, "index.json");
    this.originalsPath = path.join(root, "originals");
    this.lockPath = path.join(root, ".index.lock");
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true });
    const startedAt = Date.now();
    for (;;) {
      try {
        await mkdir(this.lockPath);
        const ownerPath = path.join(this.lockPath, "owner.json");
        await writeFile(
          ownerPath,
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          "utf8",
        );
        const heartbeat = setInterval(() => {
          void writeFile(
            ownerPath,
            `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
            "utf8",
          ).catch(() => undefined);
        }, 10_000);
        heartbeat.unref();
        return async () => {
          clearInterval(heartbeat);
          await rm(this.lockPath, { recursive: true, force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stale = false;
        try {
          const owner = JSON.parse(
            await readFile(path.join(this.lockPath, "owner.json"), "utf8"),
          ) as { pid?: number };
          let livenessKnown = false;
          if (typeof owner.pid === "number") {
            try {
              process.kill(owner.pid, 0);
              livenessKnown = true;
            } catch (processError) {
              const code = (processError as NodeJS.ErrnoException).code;
              stale = code === "ESRCH";
              livenessKnown = code === "ESRCH" || code === "EPERM";
            }
          }
          const heartbeatExpired =
            Date.now() - (await stat(path.join(this.lockPath, "owner.json"))).mtimeMs > 60_000;
          if (!livenessKnown || heartbeatExpired) stale ||= heartbeatExpired;
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
          stale = Date.now() - (await stat(this.lockPath)).mtimeMs > 60_000;
        }
        if (stale) {
          const stalePath = `${this.lockPath}.stale.${process.pid}.${randomUUID()}`;
          try {
            await rename(this.lockPath, stalePath);
          } catch (renameError) {
            if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw renameError;
          }
          await rm(stalePath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() - startedAt > 30_000)
          throw new Error(`Timed out waiting for asset library lock: ${this.root}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async readIndex(): Promise<LibraryIndex> {
    try {
      return JSON.parse(await readFile(this.indexPath, "utf8")) as LibraryIndex;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { assets: {} };
      throw error;
    }
  }

  private async writeIndex(index: LibraryIndex): Promise<void> {
    await writeAtomicDurable(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }

  private async mutateIndex<T>(mutation: (index: LibraryIndex) => T | Promise<T>): Promise<T> {
    let result!: T;
    const apply = async () => {
      const release = await this.acquireLock();
      try {
        const index = await this.readIndex();
        result = await mutation(index);
        await this.writeIndex(index);
      } finally {
        await release();
      }
    };
    this.mutationQueue = this.mutationQueue.then(apply, apply);
    await this.mutationQueue;
    return result;
  }

  private async importOriginalWithUsage(
    candidate: MediaCandidate,
    sourcePath: string,
    usageIncrement: number,
  ): Promise<AssetRecord> {
    const decision = evaluateCandidate(candidate, 0);
    if (!decision.accepted)
      throw new Error(`Rejected candidate ${candidate.id}: ${decision.hardFailures.join(", ")}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(sourcePath)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const extension =
      path.extname(sourcePath).toLowerCase() || (candidate.kind === "video" ? ".mp4" : ".jpg");
    await mkdir(this.originalsPath, { recursive: true });
    const originalPath = path.join(this.originalsPath, `${sha256}${extension}`);
    try {
      await copyFile(sourcePath, originalPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return this.mutateIndex((index) => {
      const existing = index.assets[candidate.id];
      const record: AssetRecord = {
        mediaId: candidate.id,
        sha256,
        originalPath,
        sourceUrl: candidate.sourceUrl,
        author: candidate.author,
        provider: candidate.provider,
        license: candidate.license!,
        downloadedAt: existing?.downloadedAt ?? new Date().toISOString(),
        width: candidate.width,
        height: candidate.height,
        durationSeconds: candidate.durationSeconds,
        qualityScore: decision.score,
        useCount: (existing?.useCount ?? 0) + usageIncrement,
      };
      index.assets[candidate.id] = record;
      return record;
    });
  }

  async importOriginal(candidate: MediaCandidate, sourcePath: string): Promise<AssetRecord> {
    return this.importOriginalWithUsage(candidate, sourcePath, 0);
  }

  async importAndRecordUse(candidate: MediaCandidate, sourcePath: string): Promise<AssetRecord> {
    return this.importOriginalWithUsage(candidate, sourcePath, 1);
  }

  async incrementUse(mediaId: string): Promise<AssetRecord> {
    return this.mutateIndex((index) => {
      const record = index.assets[mediaId];
      if (!record) throw new Error(`Unknown media asset: ${mediaId}`);
      record.useCount += 1;
      return record;
    });
  }

  async usageMap(): Promise<Map<string, number>> {
    await this.mutationQueue;
    const index = await this.readIndex();
    return new Map(Object.values(index.assets).map((record) => [record.mediaId, record.useCount]));
  }
}

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaCandidate } from "./types.js";
import { evaluateCandidate } from "../media-qa/filter.js";

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

  constructor(private readonly root: string) {
    this.indexPath = path.join(root, "index.json");
    this.originalsPath = path.join(root, "originals");
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
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.indexPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await import("node:fs/promises").then(({ rename }) => rename(temporary, this.indexPath));
  }

  async importOriginal(candidate: MediaCandidate, sourcePath: string): Promise<AssetRecord> {
    const decision = evaluateCandidate(candidate, 0);
    if (!decision.accepted)
      throw new Error(`Rejected candidate ${candidate.id}: ${decision.hardFailures.join(", ")}`);
    const bytes = await readFile(sourcePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const extension =
      path.extname(sourcePath).toLowerCase() || (candidate.kind === "video" ? ".mp4" : ".jpg");
    await mkdir(this.originalsPath, { recursive: true });
    const originalPath = path.join(this.originalsPath, `${sha256}${extension}`);
    try {
      await copyFile(sourcePath, originalPath, (await import("node:fs")).constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const index = await this.readIndex();
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
      useCount: existing?.useCount ?? 0,
    };
    index.assets[candidate.id] = record;
    await this.writeIndex(index);
    return record;
  }

  async incrementUse(mediaId: string): Promise<AssetRecord> {
    const index = await this.readIndex();
    const record = index.assets[mediaId];
    if (!record) throw new Error(`Unknown media asset: ${mediaId}`);
    record.useCount += 1;
    await this.writeIndex(index);
    return record;
  }

  async usageMap(): Promise<Map<string, number>> {
    const index = await this.readIndex();
    return new Map(Object.values(index.assets).map((record) => [record.mediaId, record.useCount]));
  }
}

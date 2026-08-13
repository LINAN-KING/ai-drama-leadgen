import { randomUUID } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";

export async function writeAtomicDurable(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, filePath);
  try {
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch (error) {
    if (!new Set(["EINVAL", "EPERM", "EISDIR"]).has((error as NodeJS.ErrnoException).code ?? ""))
      throw error;
  }
}

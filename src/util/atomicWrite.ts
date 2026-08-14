import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Writes `contents` to `targetPath` via temp-file-then-rename, creating parent directories as needed. */
export async function atomicWriteFile(targetPath: string, contents: string): Promise<void> {
  const dir = dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, targetPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export function toJsonWithTrailingNewline(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

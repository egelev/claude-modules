import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFile } from "../util/atomicWrite.js";
import { validateProfileName } from "./profileName.js";

const FILE_NAME = ".claude-profiles";

/** The `.claude-profiles` file: a newline-separated list of profile names, used by `enable --persist` and `reload`. */
export class ProfileListFile {
  /** Walks from `startDir` up to (and including) `repoRoot` looking for a `.claude-profiles` file. */
  async findUpward(startDir: string, repoRoot: string): Promise<string | null> {
    let dir = startDir;
    for (;;) {
      const found = await this.findAt(dir);
      if (found) return found;

      if (dir === repoRoot) return null;
      const parentDir = dirname(dir);
      if (parentDir === dir) return null;
      dir = parentDir;
    }
  }

  /** Checks for `.claude-profiles` directly in `dir`, without searching upward. */
  async findAt(dir: string): Promise<string | null> {
    const candidate = join(dir, FILE_NAME);
    const exists = await stat(candidate)
      .then((s) => s.isFile())
      .catch(() => false);
    return exists ? candidate : null;
  }

  async read(path: string): Promise<string[]> {
    const raw = await readFile(path, "utf8");
    const names = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    names.forEach(validateProfileName);
    return names;
  }

  /** Resolves the path `write` would use, without touching the filesystem. */
  resolvePath(cwd: string, filePath?: string): string {
    return filePath ? resolve(cwd, filePath) : join(cwd, FILE_NAME);
  }

  /**
   * Writes `profileNames` to `filePath` (resolved against `cwd` if relative), or to the
   * default `<cwd>/.claude-profiles` if `filePath` is omitted. Returns the path written to.
   */
  async write(cwd: string, profileNames: readonly string[], filePath?: string): Promise<string> {
    profileNames.forEach(validateProfileName);
    const targetPath = this.resolvePath(cwd, filePath);
    const contents = `${profileNames.join("\n")}\n`;
    await atomicWriteFile(targetPath, contents);
    return targetPath;
  }
}

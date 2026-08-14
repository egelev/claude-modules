import { readFile } from "node:fs/promises";
import { Paths } from "../util/Paths.js";
import { InstalledPluginsFile } from "./types.js";

/** Reads Claude Code's own plugin cache registry (~/.claude/plugins/installed_plugins.json), read-only. */
export class InstalledPluginsCache {
  constructor(private readonly paths: Paths) {}

  /**
   * Keys are "<plugin>@<marketplace>", regardless of which scope(s) installed them — a
   * user-scope install counts as "already cached" even when later applying at project/local scope.
   */
  async keys(): Promise<Set<string>> {
    const file = await this.readFile();
    return new Set(Object.keys(file.plugins));
  }

  private async readFile(): Promise<InstalledPluginsFile> {
    const raw = await readFile(this.paths.installedPluginsFile, "utf8").catch((err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (raw === null) return { plugins: {} };
    const parsed = JSON.parse(raw) as Partial<InstalledPluginsFile>;
    return { ...parsed, plugins: parsed.plugins ?? {} };
  }
}

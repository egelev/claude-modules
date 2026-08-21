import { Paths } from "../util/Paths.js";
import { readOptionalJsonFile } from "../util/jsonFile.js";
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
    const parsed = await readOptionalJsonFile<Partial<InstalledPluginsFile>>(
      this.paths.installedPluginsFile,
      () => ({}),
      `Claude Code's installed_plugins.json (${this.paths.installedPluginsFile})`
    );
    return { ...parsed, plugins: parsed.plugins ?? {} };
  }
}

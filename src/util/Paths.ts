import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves filesystem locations derived from two independent env-controlled homes:
 * this tool's own ($CLAUDE_PROFILES_HOME, defaults to ~/.claude-profiles), and
 * Claude Code's ($CLAUDE_CONFIG_DIR, defaults to ~/.claude).
 */
export class Paths {
  readonly home: string;
  readonly claudeHome: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.home = env.CLAUDE_PROFILES_HOME?.trim() || join(homedir(), ".claude-profiles");
    this.claudeHome = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  }

  get profilesDir(): string {
    return join(this.home, "profiles");
  }

  profileFile(name: string): string {
    return join(this.profilesDir, `${name}.json`);
  }

  get globalSettingsFile(): string {
    return join(this.home, "settings.json");
  }

  get knownMarketplacesFile(): string {
    return join(this.claudeHome, "plugins", "known_marketplaces.json");
  }

  get installedPluginsFile(): string {
    return join(this.claudeHome, "plugins", "installed_plugins.json");
  }
}

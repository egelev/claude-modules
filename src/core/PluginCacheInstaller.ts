import { execFile } from "node:child_process";
import pc from "picocolors";
import { promisify } from "node:util";
import { KnownMarketplacesCache } from "./KnownMarketplacesCache.js";
import { InstalledPluginsCache } from "./InstalledPluginsCache.js";
import { parsePluginKey } from "./pluginKey.js";
import { Logger } from "../util/Logger.js";

const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 120_000;
const STDERR_PREVIEW_LENGTH = 300;

/** `stdout` is captured because read-only queries (`plugin list --json`) need it; installs ignore it. */
export type ClaudeRunResult = { ok: true; stdout: string } | { ok: false; detail: string };

/** Runs `claude <args>`, inheriting `env`. Swaps out in tests to avoid a real `claude` binary. */
export type ClaudeRunner = (args: string[], env: NodeJS.ProcessEnv) => Promise<ClaudeRunResult>;

export async function defaultClaudeRunner(args: string[], env: NodeJS.ProcessEnv): Promise<ClaudeRunResult> {
  try {
    const { stdout } = await execFileAsync("claude", args, { env, timeout: INSTALL_TIMEOUT_MS });
    return { ok: true, stdout };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string };
    if (nodeErr.code === "ENOENT") {
      return { ok: false, detail: "'claude' not found on PATH" };
    }
    if (nodeErr.killed || nodeErr.signal === "SIGTERM") {
      return { ok: false, detail: `timed out after ${INSTALL_TIMEOUT_MS / 1000}s` };
    }
    const stderr = (nodeErr.stderr ?? nodeErr.message ?? "").trim().slice(0, STDERR_PREVIEW_LENGTH);
    return { ok: false, detail: stderr || "unknown error" };
  }
}

/**
 * Ensures plugins enabled by this tool are actually materialized in Claude Code's own plugin
 * cache, by shelling out to `claude plugin install` — never by reimplementing its cache layout.
 * Best-effort: every failure path is a logged warning, never a thrown error, since the module/
 * settings write this runs alongside is the primary, reliable operation.
 */
export class PluginCacheInstaller {
  constructor(
    private readonly knownMarketplacesCache: KnownMarketplacesCache,
    private readonly installedPluginsCache: InstalledPluginsCache,
    private readonly logger: Logger,
    private readonly env: NodeJS.ProcessEnv,
    private readonly runClaude: ClaudeRunner = defaultClaudeRunner
  ) {}

  async ensureCached(pluginKeys: Iterable<string>, dryRun: boolean): Promise<void> {
    const installed = await this.installedPluginsCache.keys();
    for (const pluginKey of pluginKeys) {
      if (installed.has(pluginKey)) {
        this.logger.debug(`'${pc.bold(pluginKey)}' already cached by Claude Code.`);
        continue;
      }
      if (dryRun) {
        this.logger.info(
          `${pc.dim("[dry-run]")} '${pc.bold(pluginKey)}' is not cached by Claude Code — would run 'claude plugin ` +
            `install ${pluginKey} --scope user -y'.`
        );
        continue;
      }
      await this.installOne(pluginKey);
    }
  }

  private async installOne(pluginKey: string): Promise<void> {
    const { marketplace } = parsePluginKey(pluginKey);
    const known = await this.knownMarketplacesCache.get(marketplace);
    if (known === undefined) {
      this.logger.warn(
        `'${pc.bold(pluginKey)}' isn't cached by Claude Code, and marketplace '${pc.bold(marketplace)}' isn't in ` +
          `its known_marketplaces.json either.\n  Run 'claude plugin marketplace add' for it, then retry, or a ` +
          `new session in a repo using this module will fail with 'not cached'.`
      );
      return;
    }

    const result = await this.runClaude(["plugin", "install", pluginKey, "--scope", "user", "-y"], this.env);
    if (result.ok) {
      this.logger.info(
        `Plugin '${pc.bold(pluginKey)}' was not cached by Claude Code yet — installed it now via ` +
          `'claude plugin install' (scope: user) so sessions in repos using this module won't fail at startup.`
      );
    } else {
      this.logger.warn(
        `Failed to install '${pc.bold(pluginKey)}' into Claude Code's cache (${result.detail}).\n  It's enabled ` +
          `in the module/settings, but a new session may fail with 'not cached' until you run ` +
          `'claude plugin install ${pluginKey} --scope user' manually.`
      );
    }
  }
}

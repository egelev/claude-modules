import pc from "picocolors";
import { EnabledPluginsReport } from "./EnabledPluginsReporter.js";
import { CliError } from "../util/errors.js";
import { commandHint } from "../util/outputStyle.js";

export interface InstallCheckInput {
  report: EnabledPluginsReport;
  enabledPluginNames: ReadonlySet<string>;
  marketplaceNames: ReadonlySet<string>;
  uncachedMarketplaceNames: readonly string[];
}

/**
 * Shared by `EnableCommand`/`ReloadCommand`: after `--install`, fail loudly if anything this run's
 * own module selection touched is still missing from Claude Code's cache/known-marketplaces —
 * `--install`'s whole point is to make the plugin usable, not just to have attempted it.
 */
export function assertInstallCached(input: InstallCheckInput): void {
  const { report, enabledPluginNames, marketplaceNames, uncachedMarketplaceNames } = input;
  const uncachedMarketplaces = new Set(uncachedMarketplaceNames);
  const stillMissingMarketplaces = [...marketplaceNames].filter((name) => uncachedMarketplaces.has(name)).sort();
  const uncachedPlugins = new Set(report.uncachedPluginKeys);
  const stillMissingPlugins = [...enabledPluginNames].filter((key) => uncachedPlugins.has(key)).sort();

  const messages: string[] = [];
  if (stillMissingMarketplaces.length > 0) {
    messages.push(
      `${stillMissingMarketplaces.length} marketplace(s) still not known to Claude Code after --install: ` +
        `${stillMissingMarketplaces.map((name) => pc.bold(name)).join(", ")}. See the warnings above for why, or ` +
        `add manually with ${commandHint("'claude plugin marketplace add <source> --scope user'")}.`
    );
  }
  if (stillMissingPlugins.length > 0) {
    messages.push(
      `${stillMissingPlugins.length} plugin(s) still not cached by Claude Code after --install: ` +
        `${stillMissingPlugins.map((key) => pc.bold(key)).join(", ")}. See the warnings above for why, or install ` +
        `manually with ${commandHint("'claude plugin install <plugin>@<marketplace> --scope user -y'")}.`
    );
  }
  if (messages.length > 0) {
    throw new CliError(messages.join("\n\n"), 2);
  }
}

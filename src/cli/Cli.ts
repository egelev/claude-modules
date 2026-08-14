import { parseArgs } from "node:util";
import { Command } from "./commands/Command.js";
import { ListProfilesCommand } from "./commands/ListProfilesCommand.js";
import { InfoCommand } from "./commands/InfoCommand.js";
import { CreateProfileCommand } from "./commands/CreateProfileCommand.js";
import { RemoveProfileCommand } from "./commands/RemoveProfileCommand.js";
import { InstallCommand } from "./commands/InstallCommand.js";
import { UninstallCommand } from "./commands/UninstallCommand.js";
import { AddMarketplaceCommand } from "./commands/AddMarketplaceCommand.js";
import { RemoveMarketplaceCommand } from "./commands/RemoveMarketplaceCommand.js";
import { EnableCommand } from "./commands/EnableCommand.js";
import { DisableCommand } from "./commands/DisableCommand.js";
import { DisableAllCommand } from "./commands/DisableAllCommand.js";
import { ReloadCommand } from "./commands/ReloadCommand.js";
import { StatusCommand } from "./commands/StatusCommand.js";
import { Paths } from "../util/Paths.js";
import { Logger, LogLevel } from "../util/Logger.js";
import { CliError } from "../util/errors.js";
import { RepoLocator } from "../core/RepoLocator.js";
import { ScopeResolver } from "../core/ScopeResolver.js";
import { ProfileStore } from "../core/ProfileStore.js";
import { ProfileResolver } from "../core/ProfileResolver.js";
import { MarketplaceRegistry } from "../core/MarketplaceRegistry.js";
import { KnownMarketplacesCache } from "../core/KnownMarketplacesCache.js";
import { InstalledPluginsCache } from "../core/InstalledPluginsCache.js";
import { PluginCacheInstaller } from "../core/PluginCacheInstaller.js";
import { SettingsRepository } from "../core/SettingsRepository.js";
import { SettingsApplier } from "../core/SettingsApplier.js";
import { ProfileListFile } from "../core/ProfileListFile.js";
import { ApplyProfilesUseCase } from "../core/ApplyProfilesUseCase.js";
import { DisableProfilesUseCase } from "../core/DisableProfilesUseCase.js";
import { EnabledPluginsReporter } from "../core/EnabledPluginsReporter.js";
import { ProfileDriftReporter } from "../core/ProfileDriftReporter.js";
import { Scope, SCOPES } from "../core/types.js";

const GLOBAL_HELP = `claude-profiles — composable Claude Code plugin profiles, applied across user/project/local scopes

Usage: claude-profiles <command> [options]

Commands:
  list                                    List available profiles
  info <profile>                          Show a profile's plugins and marketplaces
  create <profile>                        Create an empty profile
  remove <profile>                        Remove a profile
  install <plugin>@<marketplace>          Enable a plugin inside a profile
    --profile <profile>                   Profile to modify (required)
    [--source '<json>']                   Explicit marketplace source, bypassing the registry
  uninstall <plugin>@<marketplace>        Disable a plugin inside a profile
    --profile <profile>                   Profile to modify (required)
  add-marketplace <spec>                  Register a marketplace in the global registry
    [--name <name>]                       Override the inferred marketplace name
    [--source '<json>']                   Skip auto-detection; store this source verbatim
  remove-marketplace <name>               Unregister a marketplace from the global registry
  enable <profile...>                     Enable the union of profiles' plugins in a scope
    [--scope user|project|local]          Which settings.json to write (default: local)
    [--only]                              Also override plugins inherited from broader scopes
    [--persist[=<path>]]                  Save the selected profile names for later use by 'reload'
  disable <profile...>                    Disable the union of profiles' plugins in a scope
    [--scope user|project|local]          Which settings.json to write (default: local)
  disable-all                             Disable every currently-known plugin in a scope
    [--scope user|project|local]          Which settings.json to write (default: local)
  reload                                  Re-apply persisted profiles
    [--scope user|project|local]          Which settings.json to write (default: local)
    [--file <path>]                       Read profile names from this file instead of searching
  status                                  Audit a scope's enabled plugins against Claude Code's cache
                                           and, if a .claude-profiles file applies, against it too
    [--scope user|project|local]          Which settings.json to read (default: local)

Scopes (used by --scope in 'enable', 'disable', 'disable-all', 'reload', and 'status'):
  user     ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json, if set)
  project  <repo_root>/.claude/settings.json
  local    <repo_root>/.claude/settings.local.json (default)

  project/local require a git repository; use --scope user outside of one.

Global options:
  -h, --help   Show help (also works after any command, e.g. 'claude-profiles install --help')
  --verbose    Enable debug logging
  --dry-run    Preview a mutating command's effect without writing anything or running external
               commands (no-op on 'list'/'info'/'status', which never write). Supported by:
               create, remove, install, uninstall, add-marketplace, remove-marketplace, enable,
               disable, disable-all, reload.

Run 'claude-profiles <command> --help' for a command's full options and examples.
`;

const COMMAND_HELP: Record<string, string> = {
  list: `Usage: claude-profiles list

List every profile under $CLAUDE_PROFILES_HOME/profiles, with its enabled-plugin
and known-marketplace counts.
`,

  info: `Usage: claude-profiles info <profile>

Show a profile's enabled plugins and additional known marketplaces.

Example:
  claude-profiles info backend-dev
`,

  create: `Usage: claude-profiles create <profile> [--dry-run]

Create a new, empty profile (no enabled plugins, no known marketplaces).
Errors if a profile with that name already exists.

Options:
  --dry-run   Report whether this would succeed, without creating the profile.

Example:
  claude-profiles create backend-dev
`,

  remove: `Usage: claude-profiles remove <profile> [--dry-run]

Delete a profile file. Only removes the profile itself:
  - does not touch any scope's settings.json — plugins already applied from
    this profile stay enabled until the next 'enable'/'reload' that omits it
  - does not clean up references to this profile in any '.claude-profiles'
    file; running 'enable'/'reload' against a stale reference afterward fails
    with "Profile '<name>' does not exist"

Idempotent: if the profile doesn't exist, this logs a warning rather than
failing.

Options:
  --dry-run   Report whether this would remove the profile, without doing so.

Example:
  claude-profiles remove backend-dev
`,

  install: `Usage: claude-profiles install <plugin>@<marketplace> --profile <profile> [--source '<json>'] [--dry-run]

Enable a plugin inside a profile. If the marketplace isn't already known to
the profile, its source is resolved in this order:
  1. --source '<json>', if given (stored on this profile only)
  2. the global marketplace registry (see 'add-marketplace')
  3. Claude Code's own local known_marketplaces.json cache, if the marketplace
     was already added there (e.g. via '/plugin' inside Claude Code) — copied
     onto the profile as a snapshot, not a live reference
  4. otherwise: error, naming the remedies above

Also ensures the plugin is materialized in Claude Code's own plugin cache
(shells out to 'claude plugin install' if it isn't yet).

Options:
  --profile <profile>   Profile to modify (required)
  --source '<json>'     Explicit marketplace source, bypassing the registry
  --dry-run             Resolve the marketplace source and report what would
                         be installed and cached, without writing the profile
                         or running 'claude plugin install'

Examples:
  claude-profiles install typescript-lsp@claude-plugins --profile backend-dev
  claude-profiles install foo@custom-mp --profile backend-dev \\
    --source '{"source":{"source":"github","repo":"me/custom"}}'
`,

  uninstall: `Usage: claude-profiles uninstall <plugin>@<marketplace> --profile <profile> [--dry-run]

Disable a plugin inside a profile — the reciprocal of 'install'. Only edits
the profile's enabledPlugins: it never touches Claude Code's own plugin
cache (other profiles on this machine may still depend on it being cached)
and never removes the plugin's marketplace from extraKnownMarketplaces,
even if it was the last plugin referencing it.

If the plugin isn't currently enabled in the profile, this is a no-op that
logs a warning rather than an error.

Options:
  --profile <profile>   Profile to modify (required)
  --dry-run             Report whether this would uninstall the plugin,
                         without editing the profile

Example:
  claude-profiles uninstall typescript-lsp@claude-plugins --profile backend-dev
`,

  "add-marketplace": `Usage: claude-profiles add-marketplace <spec> [--name <name>] [--source '<json>'] [--dry-run]

Register a marketplace in the global registry at $CLAUDE_PROFILES_HOME/settings.json,
so 'install' can resolve it without repeating --source every time. Mirrors
'/plugin marketplace add <spec>': <spec> may be a GitHub 'owner/repo' shorthand,
a git URL, or a local path — the type is auto-detected from its shape.

Options:
  --name <name>        Override the inferred marketplace name
  --source '<json>'    Skip auto-detection; store this source verbatim
  --dry-run            Resolve the name/source and report what would be
                        registered, without writing the registry

Note: only the GitHub 'owner/repo' shorthand has a documented settings.json
shape. Git-URL and local-path shapes are best-effort — verify the registered
entry, or pass --source explicitly if it looks wrong.

Examples:
  claude-profiles add-marketplace anthropics/claude-plugins
  claude-profiles add-marketplace anthropics/claude-plugins --name official
`,

  "remove-marketplace": `Usage: claude-profiles remove-marketplace <name> [--dry-run]

Unregister a marketplace from the global registry at $CLAUDE_PROFILES_HOME/settings.json —
the reciprocal of 'add-marketplace'. Only edits the global registry:
  - does not touch any profile's extraKnownMarketplaces — marketplaces already resolved
    onto a profile were copied as a snapshot, not a live reference, so they're unaffected
  - does not touch Claude Code's own known_marketplaces.json cache
  - a future 'install' that needs this marketplace and can't fall back to Claude Code's
    cache will fail until it's registered again

Idempotent: if the marketplace isn't registered, this logs a warning rather
than failing.

Options:
  --dry-run   Report whether this would remove the marketplace, without doing so.

Example:
  claude-profiles remove-marketplace official
`,

  enable: `Usage: claude-profiles enable <profile...> [--scope user|project|local] [--only] [--persist[=<path>]] [--dry-run]

Compute the union of enabled plugins and known marketplaces across the given
profiles, and write it into the target scope's settings.json:
  - plugins in the union are enabled; every other previously-known plugin is
    disabled (its key is kept, never deleted)
  - marketplaces in the union are added if missing; existing ones are never
    removed or overwritten
  - every other setting in the file (permissions, theme, etc.) is untouched

Afterward, logs the plugins now enabled in the target scope. For 'local' and
'project' scopes, it also logs a further paragraph per less-specific scope
('project' and 'user' for 'local'; just 'user' for 'project') listing what's
enabled there too, so it's clear which plugin comes from which scope. Since
Claude Code resolves 'enabledPlugins' with local taking precedence over
project over user, an entry from a less-specific scope is annotated when a
more-specific scope explicitly disables it (it's listed there, but inactive).

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --only                       Ensure only the given profiles' plugins end up
                                active by also disabling, in the target
                                scope's own file, any plugin that's enabled in
                                a broader scope but isn't part of the union
                                just applied here ('project' and 'user' for
                                'local'; just 'user' for 'project'; a no-op
                                for 'user', which has no broader scope). The
                                broader scope's own file is only ever read,
                                never written. Logs which plugins were
                                overridden and which scope they came from.
  --persist[=<path>]           Also write the selected profile names, one per
                                line, for later use by 'reload'.
                                  - bare '--persist' writes to the default
                                    location, <repo_root>/.claude-profiles (or
                                    ./.claude-profiles for --scope user, which
                                    has no repo root) — the same root
                                    settings.json was just resolved against,
                                    so 'reload' finds it from any subdirectory
                                  - '--persist=<path>' writes to <path>
                                    instead (relative paths are resolved
                                    against the current directory, not the
                                    repo root); pass the same path to
                                    'reload --file' later
                                Note: the value must use '=' (--persist=path),
                                not a following argument (--persist path) —
                                the latter would be ambiguous with profile
                                names.
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing: the target scope's
                                settings.json, the '--persist' file, and any
                                'claude plugin install' cache calls are all
                                skipped.

Scopes:
  user     ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json, if set)
  project  <repo_root>/.claude/settings.json
  local    <repo_root>/.claude/settings.local.json

project/local (including the default) require a git repository; use --scope
user outside of one.

Examples:
  claude-profiles enable backend-dev
  claude-profiles enable backend-dev shared-tools --scope project --persist
  claude-profiles enable backend-dev --persist=./config/team-profiles.list
  claude-profiles enable backend-dev --scope project --only
  claude-profiles enable backend-dev --scope project --dry-run
`,

  disable: `Usage: claude-profiles disable <profile...> [--scope user|project|local] [--dry-run]

The reciprocal of 'enable': computes the union of enabled plugins across the
given profiles and flips each one to disabled in the target scope's
settings.json:
  - only plugin keys already present in that scope's settings.json are
    touched; a plugin never enabled there has nothing to disable
  - a touched key is kept and set to false, never deleted
  - marketplaces and every other setting in the file are untouched
  - a profile that enables no plugins is a no-op that logs a warning rather
    than an error

Afterward, logs the plugins now enabled in the target scope, the same report
'enable' prints (see 'enable --help' for details on the less-specific-scope
paragraphs).

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing.

Example:
  claude-profiles disable backend-dev --scope project
`,

  "disable-all": `Usage: claude-profiles disable-all [--scope user|project|local] [--dry-run]

Disables every plugin key currently known to the target scope's
settings.json, without needing a profile:
  - every key is kept and set to false, never deleted
  - marketplaces and every other setting in the file are untouched

Afterward, logs the plugins now enabled in the target scope, the same report
'enable' prints (see 'enable --help' for details on the less-specific-scope
paragraphs).

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing.

Example:
  claude-profiles disable-all --scope local
`,

  reload: `Usage: claude-profiles reload [--scope user|project|local] [--file <path>] [--dry-run]

Re-run 'enable' with a previously-persisted list of profile names (see
'enable --persist').

  - by default, finds the nearest '.claude-profiles' file by walking up from
    the current directory to the repository root; this requires a git
    repository (needed to bound the upward search)
  - '--file <path>' reads the profile list from <path> directly instead,
    skipping the upward search entirely (no git repository required).
    Relative paths are resolved against the current directory.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --file <path>                Read profile names from this file instead of
                                searching for one
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing (see 'enable --help').

Examples:
  claude-profiles reload --scope project
  claude-profiles reload --file ./config/team-profiles.list
  claude-profiles reload --dry-run
`,

  status: `Usage: claude-profiles status [--scope user|project|local]

Read-only audit, against two independent sources of truth:

1. Claude Code's own plugin cache: prints the same enabled-plugins report
   'enable' does (see 'enable --help'), but each effectively-enabled plugin —
   one not overridden by a more-specific scope — is cross-checked against the
   cache and annotated '(not cached by Claude Code — run ...)' when missing.
   This is the check 'install'/'enable'/'reload' can't give you after the
   fact: their own caching step is best-effort, so a caching failure never
   blocks the settings write, and their success output alone can't tell you
   it happened.

2. The '.claude-profiles' file that applies to the target scope, if any:
   finds it the same way 'reload' does — walking up from the current
   directory to the repository root (scope-blind, same file regardless of
   --scope) — falling back to checking the current directory directly only
   when no repository is found at all (covers bare 'enable --scope user
   --persist' run outside a repo, which 'reload' can't read back). Unlike
   'reload', a missing file is not an error — it just means there's nothing
   to compare against. When found, its listed profiles are resolved (same as
   'enable'/'reload') and diffed against the target scope's own settings.json:
     - 'Missing': a listed profile wants a plugin enabled, but it isn't
     - 'Stale': a plugin is enabled, but no listed profile declares it
       (explicit-'false' entries from 'enable --only' are never reported as
       stale — they were never "enabled" to begin with)

Both checks always run and both report, so neither hides the other. Writes
nothing and runs no external commands.

Exit codes (so a CI/pre-session caller can tell these apart):
  0   clean: every effectively-enabled plugin is cached, and settings.json
      matches the listed profile(s) (if any)
  1   status itself couldn't run (bad --scope, no repo root, ...)
  2   it ran fine, but found a problem — uncached plugins, missing/stale
      plugins relative to the listed profiles, or the listed profiles
      couldn't be resolved (e.g. one no longer exists) — see the messages
      logged above

Options:
  --scope user|project|local   Which settings.json to read (default: local)

project/local (including the default) require a git repository; use --scope
user outside of one.

Examples:
  claude-profiles status
  claude-profiles status --scope project
`,
};

function parseScope(value: string | undefined): Scope {
  if (value === undefined) return Scope.Local;
  if (!SCOPES.includes(value as Scope)) {
    throw new CliError(`Invalid --scope '${value}'. Expected one of: ${SCOPES.join(", ")}.`);
  }
  return value as Scope;
}

/**
 * Pulls `--persist` / `--persist=<path>` out of `args` before the rest goes through `parseArgs`.
 * `--persist` has to stay a bare boolean-or-string flag for backward compatibility (it used to be
 * boolean-only), which `parseArgs` can't express directly — a `type: "string"` option requires a
 * value, rejecting a bare `--persist`. The value is only accepted via `=` (never as the following
 * argument), since enable's positionals are a variadic profile-name list and a space-separated
 * value would be ambiguous with the next profile name.
 */
function extractPersistFlag(args: readonly string[]): {
  persist: boolean;
  persistPath: string | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let persist = false;
  let persistPath: string | undefined;
  for (const arg of args) {
    if (arg === "--persist") {
      persist = true;
    } else if (arg.startsWith("--persist=")) {
      persist = true;
      persistPath = arg.slice("--persist=".length);
    } else {
      rest.push(arg);
    }
  }
  return { persist, persistPath, rest };
}

function printAndExit(text: string): Command {
  return {
    execute: async () => {
      process.stdout.write(text);
    },
  };
}

// Declared on every command's parseArgs options (via the spread below) purely so `--dry-run`
// doesn't trip parseArgs's strict unknown-option check; the actual decision uses the `dryRun`
// sniffed from argv in `run()`, exactly mirroring how `--verbose` already works.
const HELP_OPTION = { help: { type: "boolean" as const, short: "h" }, "dry-run": { type: "boolean" as const } };

/** Commands that write state — the only ones `--dry-run` has anything to preview. */
const MUTATING_COMMANDS = new Set([
  "create",
  "remove",
  "install",
  "uninstall",
  "add-marketplace",
  "remove-marketplace",
  "enable",
  "disable",
  "disable-all",
  "reload",
]);

/** Parses argv and dispatches to the appropriate Command, wiring up dependencies along the way. */
export class Cli {
  constructor(
    private readonly cwd: string = process.cwd(),
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async run(argv: string[]): Promise<number> {
    const verbose = argv.includes("--verbose");
    const dryRun = argv.includes("--dry-run");
    const logger = new Logger(verbose ? LogLevel.DEBUG : LogLevel.INFO);

    if (dryRun && MUTATING_COMMANDS.has(argv[0] ?? "")) {
      logger.info("[dry-run] Preview mode: no files will be written, no external commands will run.");
    }

    try {
      const command = this.buildCommand(argv, logger, dryRun);
      await command.execute();
      return 0;
    } catch (err) {
      if (err instanceof CliError) {
        logger.error(err.message);
        return err.exitCode;
      }
      logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      return 1;
    }
  }

  private buildCommand(argv: string[], logger: Logger, dryRun: boolean): Command {
    const [commandName, ...rest] = argv;

    if (commandName === undefined || commandName === "help" || commandName === "--help" || commandName === "-h") {
      return printAndExit(GLOBAL_HELP);
    }
    if (commandName in COMMAND_HELP && (rest.includes("-h") || rest.includes("--help"))) {
      return printAndExit(COMMAND_HELP[commandName]!);
    }

    const paths = new Paths(this.env);
    const repoLocator = new RepoLocator();
    const scopeResolver = new ScopeResolver(repoLocator, paths);
    const profileStore = new ProfileStore(paths);
    const profileResolver = new ProfileResolver(profileStore, logger);
    const marketplaceRegistry = new MarketplaceRegistry(paths);
    const knownMarketplacesCache = new KnownMarketplacesCache(paths);
    const installedPluginsCache = new InstalledPluginsCache(paths);
    const pluginCacheInstaller = new PluginCacheInstaller(
      knownMarketplacesCache,
      installedPluginsCache,
      logger,
      this.env
    );
    const settingsRepository = new SettingsRepository();
    const settingsApplier = new SettingsApplier();
    const profileListFile = new ProfileListFile();
    const enabledPluginsReporter = new EnabledPluginsReporter(
      scopeResolver,
      settingsRepository,
      installedPluginsCache,
      logger
    );
    const profileDriftReporter = new ProfileDriftReporter(repoLocator, profileListFile, profileResolver, logger);
    const applyProfilesUseCase = new ApplyProfilesUseCase(
      scopeResolver,
      profileResolver,
      settingsRepository,
      settingsApplier,
      pluginCacheInstaller,
      enabledPluginsReporter,
      logger
    );
    const disableProfilesUseCase = new DisableProfilesUseCase(
      scopeResolver,
      profileResolver,
      settingsRepository,
      settingsApplier,
      enabledPluginsReporter,
      logger
    );

    switch (commandName) {
      case "list": {
        return new ListProfilesCommand(profileStore, logger);
      }

      case "info": {
        const { positionals } = parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        const name = requirePositional(positionals, 0, "info");
        return new InfoCommand(name, profileStore, logger);
      }

      case "create": {
        const { positionals } = parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        const name = requirePositional(positionals, 0, "create");
        return new CreateProfileCommand(name, profileStore, logger, dryRun);
      }

      case "remove": {
        const { positionals } = parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        const name = requirePositional(positionals, 0, "remove");
        return new RemoveProfileCommand(name, profileStore, logger, dryRun);
      }

      case "install": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: {
            profile: { type: "string" },
            source: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const pluginKey = requirePositional(positionals, 0, "install");
        if (!values.profile) {
          throw new CliError("install requires --profile <profile>. Run 'claude-profiles install --help' for usage.");
        }
        return new InstallCommand(
          pluginKey,
          values.profile,
          values.source,
          profileStore,
          marketplaceRegistry,
          knownMarketplacesCache,
          pluginCacheInstaller,
          logger,
          dryRun
        );
      }

      case "uninstall": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: {
            profile: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const pluginKey = requirePositional(positionals, 0, "uninstall");
        if (!values.profile) {
          throw new CliError("uninstall requires --profile <profile>. Run 'claude-profiles uninstall --help' for usage.");
        }
        return new UninstallCommand(pluginKey, values.profile, profileStore, logger, dryRun);
      }

      case "add-marketplace": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: {
            name: { type: "string" },
            source: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const spec = requirePositional(positionals, 0, "add-marketplace");
        return new AddMarketplaceCommand(spec, values.name, values.source, marketplaceRegistry, logger, dryRun);
      }

      case "remove-marketplace": {
        const { positionals } = parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        const name = requirePositional(positionals, 0, "remove-marketplace");
        return new RemoveMarketplaceCommand(name, marketplaceRegistry, logger, dryRun);
      }

      case "enable": {
        const { persist, persistPath, rest: restWithoutPersist } = extractPersistFlag(rest);
        const { values, positionals } = parseArgs({
          args: restWithoutPersist,
          options: {
            scope: { type: "string" },
            only: { type: "boolean" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        if (positionals.length === 0) {
          throw new CliError("enable requires at least one profile name. Run 'claude-profiles enable --help' for usage.");
        }
        const scope = parseScope(values.scope);
        return new EnableCommand(
          positionals,
          scope,
          values.only ?? false,
          persist,
          persistPath,
          this.cwd,
          applyProfilesUseCase,
          profileListFile,
          logger,
          dryRun
        );
      }

      case "disable": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        if (positionals.length === 0) {
          throw new CliError("disable requires at least one profile name. Run 'claude-profiles disable --help' for usage.");
        }
        const scope = parseScope(values.scope);
        return new DisableCommand(positionals, scope, this.cwd, disableProfilesUseCase, dryRun);
      }

      case "disable-all": {
        const { values } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        return new DisableAllCommand(scope, this.cwd, disableProfilesUseCase, dryRun);
      }

      case "reload": {
        const { values } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            file: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        return new ReloadCommand(
          scope,
          this.cwd,
          repoLocator,
          profileListFile,
          applyProfilesUseCase,
          logger,
          dryRun,
          values.file
        );
      }

      case "status": {
        const { values } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            verbose: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        return new StatusCommand(
          scope,
          this.cwd,
          scopeResolver,
          settingsRepository,
          enabledPluginsReporter,
          profileDriftReporter,
          logger
        );
      }

      default:
        throw new CliError(`Unknown command '${commandName}'. Run 'claude-profiles --help' for usage.`);
    }
  }
}

function requirePositional(positionals: string[], index: number, commandName: string): string {
  const value = positionals[index];
  if (!value) {
    throw new CliError(`Missing required argument. Run 'claude-profiles ${commandName} --help' for usage.`);
  }
  return value;
}

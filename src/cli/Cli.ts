import { parseArgs } from "node:util";
import pc from "picocolors";
import { Command } from "./commands/Command.js";
import { HelpCommand } from "./commands/HelpCommand.js";
import { VersionCommand } from "./commands/VersionCommand.js";
import { ListModulesCommand } from "./commands/ListModulesCommand.js";
import { ListMarketplacesCommand } from "./commands/ListMarketplacesCommand.js";
import { InfoCommand } from "./commands/InfoCommand.js";
import { CreateModuleCommand } from "./commands/CreateModuleCommand.js";
import { RemoveModuleCommand } from "./commands/RemoveModuleCommand.js";
import { InstallCommand } from "./commands/InstallCommand.js";
import { UninstallCommand } from "./commands/UninstallCommand.js";
import { AddMarketplaceCommand } from "./commands/AddMarketplaceCommand.js";
import { RemoveMarketplaceCommand } from "./commands/RemoveMarketplaceCommand.js";
import { ComposeAddCommand } from "./commands/ComposeAddCommand.js";
import { ComposeRemoveCommand } from "./commands/ComposeRemoveCommand.js";
import { EnableCommand } from "./commands/EnableCommand.js";
import { DisableCommand } from "./commands/DisableCommand.js";
import { DisableAllCommand } from "./commands/DisableAllCommand.js";
import { ReloadCommand } from "./commands/ReloadCommand.js";
import { StatusCommand } from "./commands/StatusCommand.js";
import { UpdateCommand } from "./commands/UpdateCommand.js";
import { ExportModuleCommand } from "./commands/ExportModuleCommand.js";
import { ImportModuleCommand } from "./commands/ImportModuleCommand.js";
import { Logger, LogLevel } from "../util/Logger.js";
import { CliError } from "../util/errors.js";
import { Scope, SCOPES } from "../core/types.js";
import { GLOBAL_HELP, COMMAND_HELP, GROUP_HELP } from "./help.js";
import { buildServices } from "./services.js";

/** Top-level names that are groups, and the subcommands each accepts. */
export const COMMAND_GROUPS: Record<string, readonly string[]> = {
  marketplace: ["add", "remove", "list"],
  plugin: ["install", "uninstall"],
  compose: ["add", "remove"],
};

function parseScope(value: string | undefined): Scope {
  if (value === undefined) return Scope.Local;
  if (!SCOPES.includes(value as Scope)) {
    throw new CliError(`Invalid --scope '${value}'. Expected one of: ${SCOPES.join(", ")}.`);
  }
  return value as Scope;
}

/**
 * Pulls `--save` / `--save=<path>` out of `args` before the rest goes through `parseArgs`.
 * `--save` has to stay a bare boolean-or-string flag for backward compatibility (it used to be
 * boolean-only), which `parseArgs` can't express directly — a `type: "string"` option requires a
 * value, rejecting a bare `--save`. The value is only accepted via `=` (never as the following
 * argument), since enable's positionals are a variadic module-name list and a space-separated
 * value would be ambiguous with the next module name.
 */
function extractSaveFlag(args: readonly string[]): {
  save: boolean;
  savePath: string | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let save = false;
  let savePath: string | undefined;
  for (const arg of args) {
    if (arg === "--save") {
      save = true;
    } else if (arg.startsWith("--save=")) {
      save = true;
      savePath = arg.slice("--save=".length);
    } else {
      rest.push(arg);
    }
  }
  return { save, savePath, rest };
}

/**
 * Returns the first sentence of a `parseArgs` failure (the part that names the offending option),
 * or `undefined` if `err` isn't one. Everything parseArgs appends after that first sentence is a
 * hint about passing positionals starting with `-`, which is rarely the actual mistake.
 */
function asParseArgsError(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code !== "string" || !code.startsWith("ERR_PARSE_ARGS")) return undefined;
  const message = (err as Error).message;
  const firstSentence = message.split(". ")[0]!;
  return firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
}

// Declared on every command's parseArgs options (via the spread below) purely so the options
// `GLOBAL_HELP` advertises as global don't trip parseArgs's strict unknown-option check; the actual
// decisions use the `verbose`/`dryRun` sniffed from argv in `run()`.
const HELP_OPTION = {
  help: { type: "boolean" as const, short: "h" },
  "dry-run": { type: "boolean" as const },
  verbose: { type: "boolean" as const },
};

/** Commands that write state — the only ones `--dry-run` has anything to preview. */
export const MUTATING_COMMANDS = new Set([
  "create",
  "remove",
  "export",
  "import",
  "plugin install",
  "plugin uninstall",
  "marketplace add",
  "marketplace remove",
  "compose add",
  "compose remove",
  "enable",
  "disable",
  "disable-all",
  "reload",
  "update",
]);

/**
 * Resolves argv's dispatch key: `"<group> <subcommand>"` for a grouped command (see
 * `COMMAND_GROUPS`), otherwise just the bare command name. Used everywhere a flat `argv[0]`
 * lookup used to be enough, before `marketplace`/`plugin` introduced a second token.
 */
function resolveDispatchKey(argv: readonly string[]): string {
  const [commandName, subCommandName] = argv;
  if (commandName !== undefined && commandName in COMMAND_GROUPS && subCommandName !== undefined) {
    return `${commandName} ${subCommandName}`;
  }
  return commandName ?? "";
}

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

    if (dryRun && MUTATING_COMMANDS.has(resolveDispatchKey(argv))) {
      logger.info(`${pc.dim("[dry-run]")} Preview mode: no files will be written, no external commands will run.`);
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
      // parseArgs rejects unknown/malformed options with a raw Node TypeError whose stack points
      // into node:internal — useless to a CLI user. Keep its first sentence (which names the
      // offending option) and drop the rest, including its trailing '--' positional hint.
      const parseArgsMessage = asParseArgsError(err);
      if (parseArgsMessage !== undefined) {
        logger.error(`${parseArgsMessage} Run 'claude-modules ${resolveDispatchKey(argv)} --help' for usage.`);
        return 1;
      }
      logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      return 1;
    }
  }

  private buildCommand(argv: string[], logger: Logger, dryRun: boolean): Command {
    const [commandName, ...rest] = argv;

    if (commandName === undefined || commandName === "help" || commandName === "--help" || commandName === "-h") {
      return new HelpCommand(GLOBAL_HELP);
    }
    if (commandName === "--version" || commandName === "-v" || commandName === "version") {
      return new VersionCommand();
    }
    let dispatchKey = commandName;
    let commandRest = rest;
    if (commandName in COMMAND_GROUPS) {
      const [subCommandName, ...afterSub] = rest;
      // A missing subcommand, an explicit help request, or any leading flag (so 'plugin
      // --verbose' doesn't get misread as an attempt to run subcommand "--verbose") all mean
      // "no subcommand given" — show the group's help, same as bare 'claude-modules' prints
      // GLOBAL_HELP today.
      if (subCommandName === undefined || subCommandName === "help" || subCommandName.startsWith("-")) {
        return new HelpCommand(GROUP_HELP[commandName]!);
      }
      if (!COMMAND_GROUPS[commandName]!.includes(subCommandName)) {
        throw new CliError(
          `Unknown subcommand '${subCommandName}' for '${commandName}'. Run 'claude-modules ${commandName} --help' for usage.`
        );
      }
      dispatchKey = `${commandName} ${subCommandName}`;
      commandRest = afterSub;
    }

    if (dispatchKey in COMMAND_HELP && (commandRest.includes("-h") || commandRest.includes("--help"))) {
      return new HelpCommand(COMMAND_HELP[dispatchKey]!);
    }

    const {
      moduleStore,
      compositionResolver,
      moduleResolver,
      moduleArchiver,
      marketplaceRegistry,
      knownMarketplacesCache,
      marketplaceCacheInstaller,
      pluginCacheInstaller,
      moduleUpdater,
      moduleListFile,
      scopeResolver,
      settingsRepository,
      enabledPluginsReporter,
      moduleDriftReporter,
      enabledPluginsVerifier,
      applyModulesUseCase,
      disableModulesUseCase,
    } = buildServices(this.env, logger);

    switch (dispatchKey) {
      case "list": {
        // Parsed purely so an unknown option is rejected here too, rather than silently ignored.
        parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        return new ListModulesCommand(moduleStore, logger);
      }

      case "info": {
        const { positionals } = parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        const name = requirePositional(positionals, 0, "info");
        return new InfoCommand(name, moduleStore, logger);
      }

      case "create": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: { "from-scope": { type: "string" }, compose: { type: "string", multiple: true }, ...HELP_OPTION },
          allowPositionals: true,
        });
        const name = requirePositional(positionals, 0, "create");
        const fromScope = values["from-scope"] === undefined ? undefined : parseScope(values["from-scope"]);
        const composeOf = values.compose ?? [];
        return new CreateModuleCommand(
          name,
          moduleStore,
          logger,
          dryRun,
          fromScope,
          this.cwd,
          scopeResolver,
          settingsRepository,
          compositionResolver,
          composeOf
        );
      }

      case "remove": {
        const { positionals } = parseArgs({ args: rest, options: HELP_OPTION, allowPositionals: true });
        const name = requirePositional(positionals, 0, "remove");
        return new RemoveModuleCommand(name, moduleStore, moduleListFile, this.cwd, logger, dryRun);
      }

      case "export": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: { output: { type: "string" }, ...HELP_OPTION },
          allowPositionals: true,
        });
        const name = requirePositional(positionals, 0, "export");
        return new ExportModuleCommand(name, values.output, this.cwd, moduleArchiver, logger, dryRun);
      }

      case "import": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: { name: { type: "string" }, "composed-prefix": { type: "string" }, ...HELP_OPTION },
          allowPositionals: true,
        });
        const archivePath = requirePositional(positionals, 0, "import");
        return new ImportModuleCommand(
          archivePath,
          values.name,
          values["composed-prefix"],
          this.cwd,
          moduleArchiver,
          logger,
          dryRun
        );
      }

      case "plugin install": {
        const { values, positionals } = parseArgs({
          args: commandRest,
          options: {
            source: { type: "string" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        if (positionals.length < 2) {
          throw new CliError(
            "plugin install requires <module> <plugin>@<marketplace>. Run 'claude-modules plugin install --help' for usage."
          );
        }
        const moduleName = requirePositional(positionals, 0, "plugin install");
        const pluginKey = requirePositional(positionals, 1, "plugin install");
        return new InstallCommand(
          pluginKey,
          moduleName,
          values.source,
          moduleStore,
          marketplaceRegistry,
          knownMarketplacesCache,
          marketplaceCacheInstaller,
          pluginCacheInstaller,
          logger,
          dryRun
        );
      }

      case "plugin uninstall": {
        const { values, positionals } = parseArgs({
          args: commandRest,
          options: {
            disable: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        if (positionals.length < 2) {
          throw new CliError(
            "plugin uninstall requires <module> <plugin>@<marketplace>. Run 'claude-modules plugin uninstall --help' for usage."
          );
        }
        const moduleName = requirePositional(positionals, 0, "plugin uninstall");
        const pluginKey = requirePositional(positionals, 1, "plugin uninstall");
        return new UninstallCommand(pluginKey, moduleName, values.disable ?? false, moduleStore, logger, dryRun);
      }

      case "marketplace add": {
        const { values, positionals } = parseArgs({
          args: commandRest,
          options: {
            name: { type: "string" },
            source: { type: "string" },
            module: { type: "string" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const spec = requirePositional(positionals, 0, "marketplace add");
        return new AddMarketplaceCommand(
          spec,
          values.name,
          values.source,
          values.module,
          marketplaceRegistry,
          moduleStore,
          marketplaceCacheInstaller,
          logger,
          dryRun
        );
      }

      case "marketplace remove": {
        const { values, positionals } = parseArgs({
          args: commandRest,
          options: { module: { type: "string" }, ...HELP_OPTION },
          allowPositionals: true,
        });
        const name = requirePositional(positionals, 0, "marketplace remove");
        return new RemoveMarketplaceCommand(name, values.module, marketplaceRegistry, moduleStore, logger, dryRun);
      }

      case "marketplace list": {
        const { values } = parseArgs({
          args: commandRest,
          options: { module: { type: "string" }, ...HELP_OPTION },
          allowPositionals: true,
        });
        return new ListMarketplacesCommand(values.module, marketplaceRegistry, moduleStore, logger);
      }

      case "compose add": {
        const { positionals } = parseArgs({ args: commandRest, options: HELP_OPTION, allowPositionals: true });
        if (positionals.length < 2) {
          throw new CliError(
            "compose add requires a module and at least one composed module. Run 'claude-modules compose add --help' for usage."
          );
        }
        const moduleName = requirePositional(positionals, 0, "compose add");
        const composedNames = positionals.slice(1);
        return new ComposeAddCommand(moduleName, composedNames, moduleStore, compositionResolver, logger, dryRun);
      }

      case "compose remove": {
        const { positionals } = parseArgs({ args: commandRest, options: HELP_OPTION, allowPositionals: true });
        if (positionals.length < 2) {
          throw new CliError(
            "compose remove requires a module and at least one composed module. Run 'claude-modules compose remove --help' for usage."
          );
        }
        const moduleName = requirePositional(positionals, 0, "compose remove");
        const composedNames = positionals.slice(1);
        return new ComposeRemoveCommand(moduleName, composedNames, moduleStore, logger, dryRun);
      }

      case "enable": {
        const { save, savePath, rest: restWithoutSave } = extractSaveFlag(rest);
        const { values, positionals } = parseArgs({
          args: restWithoutSave,
          options: {
            scope: { type: "string" },
            only: { type: "boolean" },
            install: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        if (positionals.length === 0) {
          throw new CliError("enable requires at least one module name. Run 'claude-modules enable --help' for usage.");
        }
        const scope = parseScope(values.scope);
        return new EnableCommand(
          positionals,
          scope,
          values.only ?? false,
          values.install ?? false,
          save,
          savePath,
          this.cwd,
          applyModulesUseCase,
          moduleListFile,
          logger,
          dryRun
        );
      }

      case "disable": {
        const { save, savePath, rest: restWithoutSave } = extractSaveFlag(rest);
        if (savePath !== undefined) {
          throw new CliError(
            "disable --save does not take a path — it always updates the scope's own saved list. Use bare --save."
          );
        }
        const { values, positionals } = parseArgs({
          args: restWithoutSave,
          options: {
            scope: { type: "string" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        if (positionals.length === 0) {
          throw new CliError("disable requires at least one module name. Run 'claude-modules disable --help' for usage.");
        }
        const scope = parseScope(values.scope);
        return new DisableCommand(
          positionals,
          scope,
          save,
          this.cwd,
          disableModulesUseCase,
          moduleListFile,
          logger,
          dryRun
        );
      }

      case "disable-all": {
        const { values } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        return new DisableAllCommand(scope, this.cwd, disableModulesUseCase, dryRun);
      }

      case "reload": {
        const { values } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            file: { type: "string" },
            install: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        return new ReloadCommand(
          scope,
          this.cwd,
          moduleListFile,
          applyModulesUseCase,
          logger,
          dryRun,
          values.install ?? false,
          values.file
        );
      }

      case "update": {
        const { values, positionals } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        return new UpdateCommand(
          positionals,
          scope,
          this.cwd,
          moduleResolver,
          moduleListFile,
          moduleUpdater,
          logger,
          dryRun
        );
      }

      case "status": {
        const { values } = parseArgs({
          args: rest,
          options: {
            scope: { type: "string" },
            verify: { type: "boolean" },
            json: { type: "boolean" },
            ...HELP_OPTION,
          },
          allowPositionals: true,
        });
        const scope = parseScope(values.scope);
        const verify = values.verify ?? false;
        return new StatusCommand(
          scope,
          this.cwd,
          scopeResolver,
          settingsRepository,
          enabledPluginsReporter,
          moduleDriftReporter,
          moduleListFile,
          logger,
          verify,
          enabledPluginsVerifier,
          values.json ?? false
        );
      }

      default:
        throw new CliError(`Unknown command '${commandName}'. Run 'claude-modules --help' for usage.`);
    }
  }
}

function requirePositional(positionals: string[], index: number, commandName: string): string {
  const value = positionals[index];
  if (!value) {
    throw new CliError(`Missing required argument. Run 'claude-modules ${commandName} --help' for usage.`);
  }
  return value;
}

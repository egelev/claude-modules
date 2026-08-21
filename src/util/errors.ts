export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

export class ScopeRequiredError extends CliError {
  constructor(scope: string) {
    super(
      `--scope ${scope} requires a git repository (could not determine a repo root; use --scope local or ` +
        "--scope user instead, or run this from inside a git repository)"
    );
  }
}

export class ModuleNotFoundError extends CliError {
  constructor(name: string) {
    super(`Module '${name}' does not exist. Run 'claude-modules list' to see available modules.`);
  }
}

export class ModuleExistsError extends CliError {
  constructor(name: string) {
    super(`Module '${name}' already exists.`);
  }
}

export class InvalidModuleNameError extends CliError {
  constructor(name: string) {
    super(`Invalid module name '${name}': must not contain '/', '\\', or '..'.`);
  }
}

export class InvalidModuleShapeError extends CliError {
  constructor(field: string, expected: string, moduleName?: string) {
    const subject = moduleName !== undefined ? `Malformed module '${moduleName}'` : "Malformed module";
    super(`${subject}: '${field}' must be ${expected}. Fix the hand-edit and try again.`);
  }
}

export class InvalidPluginKeyError extends CliError {
  constructor(pluginKey: string) {
    super(`Invalid plugin '${pluginKey}': expected the form '<plugin-name>@<marketplace-name>'.`);
  }
}

export class UnknownMarketplaceError extends CliError {
  constructor(marketplace: string) {
    super(
      `Unknown marketplace '${marketplace}'. Provide --source '<json>' on this command, or register it first with ` +
        `'claude-modules marketplace add ${marketplace}'.`
    );
  }
}

export class MarketplaceNotFoundError extends CliError {
  constructor(name: string) {
    super(`Marketplace '${name}' is not registered. Run 'claude-modules marketplace add ${name}' to register it.`);
  }
}

export class CompositionCycleError extends CliError {
  constructor(path: readonly string[]) {
    super(
      `Composition cycle detected: ${path.join(" -> ")}. A module cannot compose itself, directly or transitively.`
    );
  }
}

export class MarketplaceConflictError extends CliError {
  constructor(marketplace: string, moduleA: string, moduleB: string) {
    super(
      `Marketplace '${marketplace}' is declared with different sources, surfaced via modules '${moduleA}' and ` +
        `'${moduleB}' (in a deep composition, one or both may just be relaying a composed child's declaration, not ` +
        `the module that actually declared it). Resolve the conflict in one of the modules before applying them together.`
    );
  }
}

export interface ModuleImportCollision {
  name: string;
  kind: "root" | "composed";
  /** False for a bare `modules/<name>/` directory with no loadable settings.json — typically a
   * leftover from an import that crashed partway through, not a real pre-existing module. */
  hasSettings: boolean;
}

export class ModuleImportCollisionError extends CliError {
  constructor(collisions: readonly ModuleImportCollision[]) {
    const lines = collisions.map(({ name, kind, hasSettings }) => {
      if (!hasSettings) {
        return `  '${name}' (${kind}) — a module directory already exists here with no readable settings.json, ` +
          `likely left behind by an import that didn't finish. Remove '${name}' from ` +
          `$CLAUDE_MODULES_HOME/modules/ if so, or rename/move it aside if it's something else.`;
      }
      return kind === "root"
        ? `  '${name}' (root) — rename the existing module, or re-run with --name <new-name>.`
        : `  '${name}' (composed) — rename the existing module, or re-run with --composed-prefix <prefix>.`;
    });
    super(
      `Import would overwrite ${collisions.length} existing module(s):\n${lines.join("\n")}`
    );
  }
}

export class InvalidJsonError extends CliError {
  constructor(context: string, cause: unknown) {
    super(`${context} is not valid JSON: ${describeError(cause)}`);
  }
}

export class InvalidExportArchiveError extends CliError {
  constructor(reason: string) {
    super(`Not a valid module export archive: ${reason}`);
  }
}

export class DuplicateImportNameError extends CliError {
  constructor(name: string, originalNames: readonly string[]) {
    super(
      `Import would give more than one module the name '${name}' (from ${originalNames.join(", ")}). ` +
        `Adjust --name and/or --composed-prefix so every imported module ends up with a distinct name.`
    );
  }
}

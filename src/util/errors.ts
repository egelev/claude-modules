export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

export class ScopeRequiredError extends CliError {
  constructor() {
    super(
      "--scope is required outside of git repositories (could not determine a repo root; pass --scope user, or run this from inside a git repository)"
    );
  }
}

export class ProfileNotFoundError extends CliError {
  constructor(name: string) {
    super(`Profile '${name}' does not exist. Run 'claude-profiles list' to see available profiles.`);
  }
}

export class ProfileExistsError extends CliError {
  constructor(name: string) {
    super(`Profile '${name}' already exists.`);
  }
}

export class InvalidProfileNameError extends CliError {
  constructor(name: string) {
    super(`Invalid profile name '${name}': must not contain '/', '\\', or '..'.`);
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
        `'claude-profiles add-marketplace ${marketplace}'.`
    );
  }
}

export class MarketplaceNotFoundError extends CliError {
  constructor(name: string) {
    super(`Marketplace '${name}' is not registered. Run 'claude-profiles add-marketplace ${name}' to register it.`);
  }
}

export class MarketplaceConflictError extends CliError {
  constructor(marketplace: string, profileA: string, profileB: string) {
    super(
      `Marketplace '${marketplace}' is declared with different sources in profiles '${profileA}' and '${profileB}'. ` +
        `Resolve the conflict in one of the profiles before applying them together.`
    );
  }
}

export class RepoRootRequiredError extends CliError {
  constructor(context: string) {
    super(`${context} requires a git repository, but no repo root could be found from the current directory.`);
  }
}

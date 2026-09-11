/** Help text for the CLI — pulled out of Cli.ts to keep argv parsing/dispatch separate from display
 * strings. Kept terse on purpose: each entry is a quick reference, not the full manual — that lives
 * in docs/*.md, which every entry below points to. HelpCommand applies bold styling to command
 * names and flags at print time, so these strings stay plain, easily-diffable text. */

export const GLOBAL_HELP = `claude-modules — composable Claude Code plugin modules, applied across user/project/local scopes

Usage: claude-modules <command> [options]

Commands:
  list                                      List modules, with plugin/marketplace counts
  info <module>                             Show a module's plugins, marketplaces, and composition
  create <module>                           Create a module
  remove <module>                           Delete a module
  compose add <module> <composed...>        Make a module build on others
  compose remove <module> <composed...>     Stop building on others
  plugin install <module> <plugin>@<mp>     Enable a plugin inside a module
  plugin uninstall <module> <plugin>@<mp>   Disable a plugin inside a module
  marketplace add <spec>                    Register a marketplace, globally or on a module
  marketplace remove <name>                 Unregister a marketplace
  marketplace list                          List registered marketplaces
  enable <module...>                        Apply modules to a scope
  disable <module...>                       Turn a scope's copy of those plugins off
  disable-all                               Turn every plugin in a scope off
  reload                                    Re-apply a scope's saved module list
  update [module...]                        Update modules' marketplaces then plugins
  status                                    Audit a scope; exit-coded for CI
  export <module>                           Pack a module and its composition chain into a .tar.gz
  import <archive>                          Unpack one on another machine
  completions <bash|zsh>                    Print a tab-completion script for your shell

Scopes (used by --scope in enable, disable, disable-all, reload, update, status):
  user     ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json, if set)
  project  <repo_root>/.claude/settings.json — needs a git repository
  local    <repo_root>/.claude/settings.local.json (default)

Global options:
  -h, --help      Show help. Also works after any command: claude-modules plugin install --help
  -v, --version   Print the installed version
  --verbose       Enable debug logging
  --dry-run       Preview a mutating command's effect — writes nothing, runs no external commands

Run 'claude-modules <command> --help' for a command's full options and examples. Full reference:
docs/ in the repo, or https://egelev.github.io/claude-modules/.
`;

export const COMMAND_HELP: Record<string, string> = {
  list: `Usage: claude-modules list

List every module under $CLAUDE_MODULES_HOME/modules, with its version, enabled-plugin count, and
known-marketplace count. Never writes.

Example:
  claude-modules list
`,

  info: `Usage: claude-modules info <module>

Show a module's full detail: what it composes, every plugin it declares (enabled or disabled), and
every marketplace it knows about. Never writes.

Example:
  claude-modules info backend-dev
`,

  create: `Usage: claude-modules create <module> [--from-scope user|project|local] [--compose <module>]... [--dry-run]

Create a module. Empty by default; --from-scope seeds it from a scope's already-enabled plugins;
--compose declares it builds on other modules (change later with 'compose add'/'compose remove').
Errors if the name already exists.

Options:
  --from-scope <scope>   Seed from this scope's settings.json (read-only)
  --compose <module>     Compose another module into this one (repeatable)
  --dry-run              Report what would be created, without writing

Examples:
  claude-modules create backend-dev
  claude-modules create backend-dev --from-scope local
  claude-modules create fullstack-dev --compose backend-dev --compose frontend-dev

See docs/modules.md#create for --from-scope's tradeoffs and --compose's validation rules.
`,

  remove: `Usage: claude-modules remove <module> [--dry-run]

Delete a module. Only the module itself: does not touch any scope's settings.json (plugins already
applied stay enabled) and does not clean up references to it in a module list. Idempotent — a
missing module logs a warning, not an error.

Options:
  --dry-run   Report whether this would remove the module, without doing so

Example:
  claude-modules remove backend-dev
`,

  export: `Usage: claude-modules export <module> [--output <path>] [--dry-run]

Package a module — and every module it transitively composes — into one portable .tar.gz, so the
whole composition chain works out of the box after 'import' elsewhere.

Options:
  --output <path>   Archive path (default: <module>-<YYYY-MM-DD>.tar.gz, current directory)
  --dry-run         Report what would be archived, without writing anything

Examples:
  claude-modules export backend-dev
  claude-modules export fullstack-dev --output ~/backups/fullstack.tar.gz

See docs/transfer.md#export for the archive format and what it deliberately doesn't carry.
`,

  import: `Usage: claude-modules import <archive> [--name <name>] [--composed-prefix <prefix>] [--dry-run]

Unpack a module — and its composed modules — from an 'export' archive. Fails without writing
anything if any imported module would collide with one that already exists.

Options:
  --name <name>                Name the root module on import (default: its exported name)
  --composed-prefix <prefix>   Prefix every composed module's name on import
  --dry-run                    Validate and check for collisions, but write nothing

Examples:
  claude-modules import backend-dev-2026-08-18.tar.gz
  claude-modules import backend-dev-2026-08-18.tar.gz --name backend-dev-imported
  claude-modules import backend-dev-2026-08-18.tar.gz --composed-prefix teammate-

See docs/transfer.md#import for collision handling and composed-module renaming.
`,

  "plugin install": `Usage: claude-modules plugin install <module> <plugin>@<marketplace> [--source '<json>'] [--dry-run]

Enable a plugin inside a module. If its marketplace isn't already known to the module, the source is
resolved from --source, then the global registry, then Claude Code's own cache — or the command
fails, naming those remedies. Also best-effort installs the plugin into Claude Code's own cache.

Options:
  --source '<json>'   Explicit marketplace source, bypassing the registry
  --dry-run           Report what would be installed and cached, without writing anything

Examples:
  claude-modules plugin install backend-dev typescript-lsp@claude-plugins
  claude-modules plugin install backend-dev foo@custom-mp \\
    --source '{"source":{"source":"github","repo":"me/custom"}}'

See docs/plugins.md#plugin-install for marketplace-resolution order and cache warming.
`,

  "plugin uninstall": `Usage: claude-modules plugin uninstall <module> <plugin>@<marketplace> [--disable] [--dry-run]

Disable a plugin inside a module. Deletes the enabledPlugins key by default; --disable sets it to
false instead, which is what overrides a composed module that enables the same plugin. Never touches
Claude Code's own plugin cache or the marketplace entry. A plugin that isn't enabled is a no-op
(warning, not an error).

Options:
  --disable   Set the key to false instead of deleting it — see docs/plugins.md#--disable
  --dry-run   Report whether this would uninstall/disable the plugin, without editing the module

Examples:
  claude-modules plugin uninstall backend-dev typescript-lsp@claude-plugins
  claude-modules plugin uninstall backend-dev typescript-lsp@claude-plugins --disable
`,

  "marketplace add": `Usage: claude-modules marketplace add <spec> [--name <name>] [--source '<json>'] [--module <module>] [--dry-run]

Register a marketplace in the global registry, so 'plugin install' can resolve it without repeating
--source. <spec> may be a GitHub 'owner/repo' (optionally '@ref'-pinned), a git URL ('#ref'-pinned),
or a local path — auto-detected. --module registers onto that module's own copy instead.

Options:
  --name <name>       Override the inferred marketplace name
  --source '<json>'   Skip auto-detection; store this source verbatim
  --module <module>   Register onto this module instead of the global registry
  --dry-run           Resolve and report, without writing

Examples:
  claude-modules marketplace add anthropics/claude-plugins
  claude-modules marketplace add anthropics/claude-plugins --name official
  claude-modules marketplace add anthropics/claude-plugins --module backend-dev

See docs/marketplaces.md#marketplace-add for spec detection and the git/local-path caveat.
`,

  "marketplace remove": `Usage: claude-modules marketplace remove <name> [--module <module>] [--dry-run]

Unregister a marketplace from the global registry, or from a module's own copy with --module. Never
touches Claude Code's own cache. Idempotent — an unregistered name logs a warning, not an error.

Options:
  --module <module>   Remove from this module instead of the global registry
  --dry-run           Report whether this would remove the marketplace, without doing so

Examples:
  claude-modules marketplace remove official
  claude-modules marketplace remove official --module backend-dev
`,

  "marketplace list": `Usage: claude-modules marketplace list [--module <module>]

List registered marketplaces — the global registry by default, or a module's own with --module.
Never writes.

Options:
  --module <module>   List this module's own marketplaces instead of the global registry

Examples:
  claude-modules marketplace list
  claude-modules marketplace list --module backend-dev
`,

  "compose add": `Usage: claude-modules compose add <module> <composed...> [--dry-run]

Add one or more composed modules to an existing module. Every future enable/disable/status/export
against it transitively pulls in what the newly-composed module(s) contribute. Validates the whole
batch atomically (a cycle or conflict rejects everything). Idempotent per name.

Options:
  --dry-run   Validate and report what would be added, without writing

Examples:
  claude-modules compose add frontend base
  claude-modules compose add frontend base shared-tools

See docs/compose.md#the-one-level-override-limit for a known limit on --disable overrides.
`,

  "compose remove": `Usage: claude-modules compose remove <module> <composed...> [--dry-run]

Remove one or more composed modules from an existing module. Idempotent per name. Never re-validates
afterward — removing entries can only shrink the effective set.

Options:
  --dry-run   Report what would be removed, without writing

Example:
  claude-modules compose remove frontend shared-tools
`,

  enable: `Usage: claude-modules enable <module...> [--scope user|project|local] [--only] [--install] [--save[=<path>]] [--dry-run]

Compute the union of enabled plugins/marketplaces across the given modules and write it into the
target scope's settings.json. Additive by default — other plugins are left alone; --only makes the
scope exactly these modules instead. Prints the resulting enabled-plugin report across the whole
scope chain, then which modules are now considered active.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --only                       Make the scope exactly these modules, disabling everything else —
                                see docs/applying.md#--only
  --install                    Best-effort add missing marketplaces / install missing plugins into
                                Claude Code's caches (off by default; exits 2 if still missing after)
  --save[=<path>]              Save the selected module names for 'reload' (needs '='; default path
                                is the scope's own list — see docs/applying.md#--save)
  --dry-run                    Compute and print the full report, write nothing

Examples:
  claude-modules enable backend-dev
  claude-modules enable backend-dev shared-tools --scope project --save
  claude-modules enable backend-dev --save=./config/team-modules.list
  claude-modules enable backend-dev --scope project --only
  claude-modules enable backend-dev --install

See docs/applying.md#enable for the full report format and per-scope save-file locations.
`,

  disable: `Usage: claude-modules disable <module...> [--scope user|project|local] [--save] [--dry-run]

The reciprocal of enable: flips the union of enabled plugins across the given modules to false in
the target scope. Only touches keys already present; never deletes; marketplaces are untouched. A
module that enables nothing is a no-op (warning, not an error).

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --save                       Also remove these modules from the scope's saved list, if one exists
  --dry-run                    Compute and print the full report, write nothing

Examples:
  claude-modules disable backend-dev --scope project
  claude-modules disable backend-dev --save
`,

  "disable-all": `Usage: claude-modules disable-all [--scope user|project|local] [--dry-run]

Disable every plugin key currently known to the target scope's settings.json, without needing a
module. Keys are kept and set to false, never deleted.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --dry-run                    Compute and print the full report, write nothing

Example:
  claude-modules disable-all --scope local
`,

  reload: `Usage: claude-modules reload [--scope user|project|local] [--file <path>] [--install] [--dry-run]

Re-run enable with the module list previously saved by 'enable --save' for this scope (or --file, to
read one from elsewhere instead of searching). Each scope reads only its own list.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --file <path>                Read module names from this file, skipping the scope search
  --install                    Same as 'enable --install' — see 'claude-modules enable --help'
  --dry-run                    Compute and print the full report, write nothing

Examples:
  claude-modules reload --scope project
  claude-modules reload --file ./config/team-modules.list
  claude-modules reload --install
`,

  update: `Usage: claude-modules update [module...] [--scope user|project|local] [--dry-run]

Resolve the union of enabled plugins/marketplaces across the given modules (or, with no names, the
scope's currently active saved modules) and ask Claude Code itself to update each to its latest
version. Never writes any settings.json — only what version is installed changes.

Options:
  --scope user|project|local   Module-list scope when no names are given, and the --scope passed to
                                'claude plugin update' (default: local) — see docs/applying.md#update
  --dry-run                    Report the commands that would run, without running them

Examples:
  claude-modules update backend-dev
  claude-modules update backend-dev frontend-dev
  claude-modules update --scope user

See docs/applying.md#update for how --scope maps onto the two 'claude plugin' subcommands this runs.
`,

  status: `Usage: claude-modules status [--scope user|project|local] [--verify] [--json]

Read-only audit of a scope's settings.json: Claude Code's own plugin cache, and — if the scope has a
saved module list — drift against it. Writes nothing.

Options:
  --scope user|project|local   Which settings.json to read (default: local)
  --verify                     Also cross-check Claude Code's own plugin resolution (runs 'claude')
  --json                       Print one JSON object to stdout instead of the report (exit unchanged)

Exit codes: 0 clean, 1 status itself couldn't run, 2 ran fine but found a problem — see
docs/status.md#exit-codes. --json shape: docs/status.md#json.

Examples:
  claude-modules status
  claude-modules status --scope project
  claude-modules status --json
`,

  completions: `Usage: claude-modules completions <bash|zsh>

Print a tab-completion script for the given shell to stdout. Completes commands, subcommands, flags,
and enum-valued flag values — never touches $CLAUDE_MODULES_HOME, so it's safe to eval anywhere.

Install:
  echo 'eval "$(claude-modules completions bash)"' >> ~/.bashrc
  echo 'eval "$(claude-modules completions zsh)"' >> ~/.zshrc   # after compinit runs

Examples:
  claude-modules completions bash
  claude-modules completions zsh

See docs/completions.md for zsh's compinit-ordering requirement.
`,
};

export const GROUP_HELP: Record<string, string> = {
  marketplace: `Usage: claude-modules marketplace <subcommand> [options]

Manage marketplaces in the global registry, or a module's own with --module.

Subcommands:
  add <spec>                Register a marketplace (global registry, or a module with --module)
  remove <name>             Unregister a marketplace
  list [--module <module>]  List registered marketplaces

Run 'claude-modules marketplace <subcommand> --help' for full options and examples.
`,

  plugin: `Usage: claude-modules plugin <subcommand> [options]

Enable or disable a plugin inside a module.

Subcommands:
  install <module> <plugin>@<marketplace>     Enable a plugin inside a module
  uninstall <module> <plugin>@<marketplace>   Disable a plugin inside a module

Run 'claude-modules plugin <subcommand> --help' for full options and examples.
`,

  compose: `Usage: claude-modules compose <subcommand> [options]

Edit which modules a module composes, after it's already been created.

Subcommands:
  add <module> <composed...>      Add one or more composed modules
  remove <module> <composed...>   Remove one or more composed modules

Run 'claude-modules compose <subcommand> --help' for full options and examples.
`,
};

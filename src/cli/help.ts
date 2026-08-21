/** Help text for the CLI — pulled out of Cli.ts to keep argv parsing/dispatch separate from display strings. */

export const GLOBAL_HELP = `claude-modules — composable Claude Code plugin modules, applied across user/project/local scopes

Usage: claude-modules <command> [options]

Commands:
  list                                    List available modules
  info <module>                           Show a module's plugins and marketplaces
  create <module>                         Create a module
    [--from-scope user|project|local]     Seed it from a scope's enabled plugins
    [--compose <module>]                  Build on another module (repeatable); use 'compose add'/
                                           'compose remove' to change this after creation
  remove <module>                         Remove a module
  export <module>                         Package a module, and everything it composes, into a
                                           portable .tar.gz
    [--output <path>]                     Archive path (default: <module>-<YYYY-MM-DD>.tar.gz in
                                           the current directory)
  import <archive>                        Unpack a module (and its composed modules) from an
                                           export archive
    [--name <name>]                       Rename the root module on import
    [--composed-prefix <prefix>]          Prefix every composed module's name on import
  plugin install <module> <plugin>@<marketplace>
                                           Enable a plugin inside a module
    [--source '<json>']                   Explicit marketplace source, bypassing the registry
  plugin uninstall <module> <plugin>@<marketplace>
                                           Disable a plugin inside a module
    [--disable]                           Set false instead of deleting the key (see --help)
  marketplace add <spec>                  Register a marketplace in the global registry
    [--name <name>]                       Override the inferred marketplace name
    [--source '<json>']                   Skip auto-detection; store this source verbatim
    [--module <module>]                   Register onto this module instead of the global registry
  marketplace remove <name>               Unregister a marketplace from the global registry
    [--module <module>]                   Remove from this module instead of the global registry
  marketplace list                        List registered marketplaces in the global registry
    [--module <module>]                   List this module's own marketplaces instead
  compose add <module> <composed...>      Add one or more composed modules to an existing module
  compose remove <module> <composed...>   Remove one or more composed modules from a module
  enable <module...>                      Enable the union of modules' plugins in a scope
    [--scope user|project|local]          Which settings.json to write (default: local)
    [--only]                              Also override plugins inherited from broader scopes
    [--install]                           Also attempt to add any marketplace, and install any
                                           plugin, Claude Code doesn't already know about (off by
                                           default)
    [--save[=<path>]]                     Save the selected module names for later use by 'reload'
  disable <module...>                     Disable the union of modules' plugins in a scope
    [--scope user|project|local]          Which settings.json to write (default: local)
  disable-all                             Disable every currently-known plugin in a scope
    [--scope user|project|local]          Which settings.json to write (default: local)
  reload                                  Re-apply saved modules
    [--scope user|project|local]          Which settings.json to write (default: local)
    [--file <path>]                       Read module names from this file instead of searching
    [--install]                           Also attempt to add any marketplace, and install any
                                           plugin, Claude Code doesn't already know about (off by
                                           default)
  status                                  Audit a scope's enabled plugins against Claude Code's cache
                                           and, if that scope has a module list, against it too
    [--scope user|project|local]          Which settings.json to read (default: local)
    [--verify]                            Also cross-check Claude Code's own plugin resolution
    [--json]                              Print one JSON object to stdout instead of the
                                           human-readable report (exit code unchanged)

Scopes (used by --scope in 'enable', 'disable', 'disable-all', 'reload', and 'status'):
  user     ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json, if set)
  project  <repo_root>/.claude/settings.json
  local    <repo_root>/.claude/settings.local.json (default), or <cwd>/.claude/settings.local.json
           outside a git repository

  project requires a git repository; use --scope user or --scope local outside of one.

Global options:
  -h, --help      Show help (also works after any command, e.g. 'claude-modules plugin install --help')
  -v, --version   Print the installed claude-modules version
  --verbose       Enable debug logging
  --dry-run    Preview a mutating command's effect without writing anything or running external
               commands (no-op on 'list'/'info'/'status', which never write). Supported by:
               create, remove, export, import, plugin install, plugin uninstall, marketplace add,
               marketplace remove, compose add, compose remove, enable, disable, disable-all, reload.

Run 'claude-modules <command> --help' for a command's full options and examples.
`;

export const COMMAND_HELP: Record<string, string> = {
  list: `Usage: claude-modules list

List every module under $CLAUDE_MODULES_HOME/modules, with its enabled-plugin
and known-marketplace counts.
`,

  info: `Usage: claude-modules info <module>

Show a module's enabled plugins and additional known marketplaces.

Example:
  claude-modules info backend-dev
`,

  create: `Usage: claude-modules create <module> [--from-scope user|project|local] [--compose <module>]... [--dry-run]

Create a new module. Empty by default; with --from-scope, seeded from the
plugins and marketplaces already enabled in that scope's settings.json — the
quickest way to capture a setup you arrived at by hand, or via '/plugin',
into a module you can reapply.

Only plugins actually enabled (true) in that scope are captured. An explicit
'false' entry is an override — that is how 'enable --only' suppresses a
plugin inherited from a broader scope — not a member of the set this scope
uses, so it is skipped rather than recorded as disabled.

--compose <module> declares that this module builds on another one
(repeatable, for building on several). Enabling/disabling the new module
transitively pulls in everything each composed module contributes; this
module's own plugins/marketplaces win over anything a composed module also
declares. This is a persistent, declared relationship stored on the module
itself — distinct from the ad-hoc union you get by naming several modules
directly on 'enable'/'disable' (e.g. 'enable web backend'), which stays a
one-off CLI-time combination and is unaffected by --compose.

--compose here only sets the module's initial composition, at creation time.
To change an existing module's composition later, use 'compose add'/'compose
remove' instead (see 'claude-modules compose add --help') — hand-editing
settings.json is never required. Self-composition, a missing referenced
module, a composition cycle, or a marketplace conflict between composed
modules is rejected before anything is written, same validation 'compose add'
uses.

Errors if a module with that name already exists. Reads the scope's
settings.json; never writes it.

Options:
  --from-scope user|project|local   Seed from this scope's settings.json
  --compose <module>                Compose another module into this one
                                     (repeatable)
  --dry-run                         Report what would be created, without
                                     writing the module

Examples:
  claude-modules create backend-dev
  claude-modules create backend-dev --from-scope local
  claude-modules create frontend-dev --compose base
  claude-modules create fullstack-dev --compose backend-dev --compose frontend-dev
`,

  remove: `Usage: claude-modules remove <module> [--dry-run]

Delete a module file. Only removes the module itself:
  - does not touch any scope's settings.json — plugins already applied from
    this module stay enabled until the next 'enable'/'reload' that omits it
  - does not clean up references to this module in any '.claude-modules'
    file; running 'enable'/'reload' against a stale reference afterward fails
    with "Module '<name>' does not exist"

Idempotent: if the module doesn't exist, this logs a warning rather than
failing.

Options:
  --dry-run   Report whether this would remove the module, without doing so.

Example:
  claude-modules remove backend-dev
`,

  export: `Usage: claude-modules export <module> [--output <path>] [--dry-run]

Packages a module's directory, and the directory of every module it
transitively composes (see 'create --compose'), into a single .tar.gz —
so the whole 'composedModules' chain travels together and works out of the
box after 'import' on another machine.

The archive mirrors $CLAUDE_MODULES_HOME/modules/ internally (one directory
per module, whatever it contains — today just settings.json), plus a small
internal manifest recording which module is the root and which are composed;
this is what lets 'import --name'/'--composed-prefix' rename modules on the
way in without losing track of which directory is which.

If any archived module has a marketplace with a non-github source (a local
path, say), a warning is logged — same as 'create --from-scope' and 'plugin
install' — since that marketplace won't mean anything on another machine.

A composition cycle among the modules being archived is rejected before
anything is written.

Options:
  --output <path>   Archive path (default: <module>-<YYYY-MM-DD>.tar.gz,
                     written to the current directory)
  --dry-run         Report what would be archived, without writing anything

Examples:
  claude-modules export backend-dev
  claude-modules export fullstack-dev --output ~/backups/fullstack.tar.gz
`,

  import: `Usage: claude-modules import <archive> [--name <name>] [--composed-prefix <prefix>] [--dry-run]

Unpacks a module — and its composed modules — from a 'export' archive, the
reciprocal of 'export'.

The root module is named from --name if given, otherwise from the name it
was exported under. Composed modules keep their original names unless
--composed-prefix is given, in which case every composed module (at every
level of the composition tree, not just the root's immediate children) is
renamed with that prefix, and every module's 'composedModules' references
are rewritten to match — so composition keeps working after the rename.

If any module being imported (root or composed) would collide with a
module that already exists on this machine, nothing is written: the error
lists every collision, and for each recommends either renaming the existing
module, or re-running with --name (for a root collision) or
--composed-prefix (for a composed-module collision). --name/--composed-prefix
are also rejected up front if they'd land two imported modules on the same
final name.

If the imported composition doesn't currently resolve (e.g. two composed
modules hand-edited to declare the same marketplace differently — the only,
unvalidated, way to change composition after 'create'; see README), the
import still succeeds and a warning is logged rather than the write being
rolled back.

Options:
  --name <name>                Name the root module on import (default: its
                                exported name)
  --composed-prefix <prefix>   Prefix every composed module's name on import
  --dry-run                    Validate the archive and check for collisions,
                                but write nothing

Examples:
  claude-modules import backend-dev-2026-08-18.tar.gz
  claude-modules import backend-dev-2026-08-18.tar.gz --name backend-dev-imported
  claude-modules import backend-dev-2026-08-18.tar.gz --composed-prefix teammate-
`,

  "plugin install": `Usage: claude-modules plugin install <module> <plugin>@<marketplace> [--source '<json>'] [--dry-run]

Enable a plugin inside a module. If the marketplace isn't already known to
the module, its source is resolved in this order:
  1. --source '<json>', if given (stored on this module only)
  2. the global marketplace registry (see 'marketplace add')
  3. Claude Code's own local known_marketplaces.json cache, if the marketplace
     was already added there (e.g. via '/plugin' inside Claude Code) — copied
     onto the module as a snapshot, not a live reference
  4. otherwise: error, naming the remedies above

Also ensures the plugin is materialized in Claude Code's own plugin cache
(shells out to 'claude plugin install' if it isn't yet).

Options:
  --source '<json>'     Explicit marketplace source, bypassing the registry
  --dry-run             Resolve the marketplace source and report what would
                         be installed and cached, without writing the module
                         or running 'claude plugin install'

Examples:
  claude-modules plugin install backend-dev typescript-lsp@claude-plugins
  claude-modules plugin install backend-dev foo@custom-mp \\
    --source '{"source":{"source":"github","repo":"me/custom"}}'
`,

  "plugin uninstall": `Usage: claude-modules plugin uninstall <module> <plugin>@<marketplace> [--disable] [--dry-run]

Disable a plugin inside a module — the reciprocal of 'plugin install'. Only edits
the module's enabledPlugins: it never touches Claude Code's own plugin
cache (other modules on this machine may still depend on it being cached)
and never removes the plugin's marketplace from extraKnownMarketplaces,
even if it was the last plugin referencing it.

If the plugin isn't currently enabled in the module, this is a no-op that
logs a warning rather than an error.

Options:
  --disable              Set the key to false instead of deleting it. Plain
                         uninstall means "this module says nothing about the
                         plugin"; --disable means "this module explicitly
                         turns it off" — which matters when the module
                         composes another that enables the same plugin, since
                         only an explicit false (not the plugin's absence)
                         overrides what a composed module contributes.
  --dry-run              Report whether this would uninstall/disable the
                         plugin, without editing the module

Examples:
  claude-modules plugin uninstall backend-dev typescript-lsp@claude-plugins
  claude-modules plugin uninstall backend-dev typescript-lsp@claude-plugins --disable
`,

  "marketplace add": `Usage: claude-modules marketplace add <spec> [--name <name>] [--source '<json>'] [--module <module>] [--dry-run]

Register a marketplace in the global registry at $CLAUDE_MODULES_HOME/settings.json,
so 'plugin install' can resolve it without repeating --source every time. Mirrors
'/plugin marketplace add <spec>': <spec> may be a GitHub 'owner/repo' shorthand
(optionally pinned to a branch/tag with a trailing '@ref'), a git URL (pin with
a trailing '#ref'), or a local path — the type is auto-detected from its shape.

Pass --module to register onto that module's own extraKnownMarketplaces instead
of the global registry — the module carries its own copy, independent of what's
globally registered.

Options:
  --name <name>         Override the inferred marketplace name
  --source '<json>'     Skip auto-detection; store this source verbatim
  --module <module>     Register onto this module instead of the global registry
  --dry-run             Resolve the name/source and report what would be
                         registered, without writing

Note: only the GitHub 'owner/repo' shorthand has a documented settings.json
shape. Git-URL and local-path shapes are best-effort — verify the registered
entry, or pass --source explicitly if it looks wrong.

Examples:
  claude-modules marketplace add anthropics/claude-plugins
  claude-modules marketplace add anthropics/claude-plugins --name official
  claude-modules marketplace add anthropics/claude-plugins --module backend-dev
`,

  "marketplace remove": `Usage: claude-modules marketplace remove <name> [--module <module>] [--dry-run]

Unregister a marketplace from the global registry at $CLAUDE_MODULES_HOME/settings.json —
the reciprocal of 'marketplace add'. Without --module, only edits the global registry:
  - does not touch any module's extraKnownMarketplaces — marketplaces already resolved
    onto a module were copied as a snapshot, not a live reference, so they're unaffected
  - does not touch Claude Code's own known_marketplaces.json cache
  - a future 'plugin install' that needs this marketplace and can't fall back to Claude Code's
    cache will fail until it's registered again

With --module, only edits that module's own extraKnownMarketplaces — the global
registry and Claude Code's cache are unaffected either way. If the module composes
other modules and inherited the marketplace from one of them, it isn't present in
the module's own map, so this reports it as not registered rather than reaching
into the composed module.

Idempotent: if the marketplace isn't registered (on the selected target), this logs
a warning rather than failing.

Options:
  --module <module>      Remove from this module instead of the global registry
  --dry-run              Report whether this would remove the marketplace, without doing so.

Example:
  claude-modules marketplace remove official
  claude-modules marketplace remove official --module backend-dev
`,

  "marketplace list": `Usage: claude-modules marketplace list [--module <module>]

List registered marketplaces in the global registry at $CLAUDE_MODULES_HOME/settings.json,
or, with --module, a single module's own extraKnownMarketplaces instead. Each line shows
the marketplace name and its raw source JSON.

Options:
  --module <module>     List this module's own marketplaces instead of the global registry

Examples:
  claude-modules marketplace list
  claude-modules marketplace list --module backend-dev
`,

  "compose add": `Usage: claude-modules compose add <module> <composed...> [--dry-run]

Adds one or more composed modules to an existing module's composedModules — the
only way to change composition after 'create', short of hand-editing settings.json.
Every future 'enable'/'disable'/'status'/'export' against <module> transitively
pulls in whatever the newly-composed module(s) contribute.

Validates the whole batch atomically before writing anything: a self-reference,
a composition cycle, a missing composed module, or a sibling marketplace conflict
rejects the entire call, same as 'create --compose'. Idempotent per name — a
composed module already present is skipped (noted in the output), and if every
named module is already composed, this is a no-op that logs a warning rather
than failing.

Options:
  --dry-run             Validate and report what would be added, without writing

Examples:
  claude-modules compose add frontend base
  claude-modules compose add frontend base shared-tools
`,

  "compose remove": `Usage: claude-modules compose remove <module> <composed...> [--dry-run]

Removes one or more composed modules from an existing module's composedModules —
the reciprocal of 'compose add'. Idempotent per name — a module not currently
composed is skipped (noted in the output), and if none of the named modules are
currently composed, this is a no-op that logs a warning rather than failing.
Never re-validates composition afterward: removing entries can only shrink the
effective set, never introduce a new cycle or conflict.

Options:
  --dry-run             Report what would be removed, without writing

Examples:
  claude-modules compose remove frontend shared-tools
`,

  enable: `Usage: claude-modules enable <module...> [--scope user|project|local] [--only] [--install] [--save[=<path>]] [--dry-run]

Compute the union of enabled plugins and known marketplaces across the given
modules, and write it into the target scope's settings.json:
  - plugins in the union are enabled; every other plugin is left exactly as
    it was, so a separate 'enable' for a different module adds to what's
    already active rather than replacing it (use --only to replace instead)
  - marketplaces in the union are added if missing; existing ones are never
    removed or overwritten
  - every other setting in the file (permissions, theme, etc.) is untouched

Afterward, logs the plugins now enabled in the target scope, and a line
naming which modules are considered active there — from the scope's saved
list if one exists (updated first, when --save is given), or just this run's
own module names otherwise. For 'local' and 'project' scopes, it also logs a
further paragraph per less-specific scope
('project' and 'user' for 'local'; just 'user' for 'project') listing what's
enabled there too, so it's clear which plugin comes from which scope. Since
Claude Code resolves 'enabledPlugins' with local taking precedence over
project over user, an entry from a less-specific scope is annotated when a
more-specific scope explicitly disables it (it's listed there, but inactive).

If anything ends up enabled but not yet cached by Claude Code, a further
block lists one manual 'claude plugin install' command per plugin, and — if
any union marketplace isn't known to Claude Code either — a similar block
lists one manual 'claude plugin marketplace add' command per marketplace.
Pass --install to attempt them all automatically instead of copy-pasting.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --only                       Make the target scope exactly the given
                                modules, instead of the default of adding to
                                whatever's already active there: every plugin
                                not in the union is explicitly disabled in
                                this scope's own file (same as plain enable
                                does everywhere by default), and — for
                                'local'/'project' scopes — any plugin that's
                                enabled in a broader scope but isn't part of
                                the union is also disabled here ('project'
                                and 'user' for 'local'; just 'user' for
                                'project'; the broader-scope half is a no-op
                                for 'user', which has no broader scope, but
                                this scope's own plugins are still made exact).
                                The broader scope's own file is only ever
                                read, never written. Logs which plugins were
                                overridden and which scope they came from.
  --install                    Attempt to add, to Claude Code's own
                                known_marketplaces.json, any union
                                marketplace it doesn't already know about
                                (shells out to 'claude plugin marketplace add
                                <source> --scope user'), then attempt to
                                install, into Claude Code's own plugin cache,
                                any union plugin it hasn't cached yet (shells
                                out to 'claude plugin install <plugin>
                                --scope user -y') — marketplaces are always
                                attempted first, so a plugin from a
                                just-added marketplace can still install in
                                the same run. Scope is always 'user' for both,
                                since Claude Code's marketplace/plugin caches
                                are shared across scopes. Plugin install is
                                only attempted when the plugin's marketplace
                                is already known to Claude Code
                                (known_marketplaces.json) — same precondition
                                as 'plugin install' (see 'claude-modules
                                plugin install --help'). Off by default: a
                                plain 'enable' never shells out to 'claude';
                                it only reports what's missing (see above). If
                                a marketplace or plugin is still missing after
                                the attempt, 'enable' exits with code 2 —
                                unless --dry-run was also given, in which case
                                nothing was actually attempted and the exit
                                code stays 0.
  --save[=<path>]              Also update the scope's saved module list (one
                                name per line) for later use by 'reload': the
                                selected modules are merged into whatever the
                                list already had (--only replaces it instead,
                                matching --only's exact-set semantics above).
                                Each scope has its own list, so saving at one
                                never overwrites another's:
                                  user     $CLAUDE_MODULES_HOME/user.modules
                                  project  <repo_root>/.claude-modules
                                  local    <repo_root>/.claude-modules.local
                                Repo-scoped lists sit at the root, so 'reload'
                                finds them from any subdirectory. The user list
                                has one fixed global location, so 'reload
                                --scope user' works from anywhere — including
                                outside a repository.
                                Commit .claude-modules to share a repo's
                                modules with the team; gitignore
                                .claude-modules.local, which is personal.
                                  - '--save=<path>' writes to <path>
                                    instead (relative paths are resolved
                                    against the current directory). A custom
                                    path is only ever read back via 'reload
                                    --file <path>' — bare 'reload' looks only
                                    at the scope locations above, so it will
                                    not find it.
                                Note: the value must use '=' (--save=path),
                                not a following argument (--save path) —
                                the latter would be ambiguous with module
                                names.
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing: the target scope's
                                settings.json, the '--save' file, and — if
                                --install is also given — any 'claude plugin
                                marketplace add'/'claude plugin install'
                                cache calls are all skipped.

Scopes:
  user     ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json, if set)
  project  <repo_root>/.claude/settings.json
  local    <repo_root>/.claude/settings.local.json

project requires a git repository; use --scope user or --scope local outside
of one. local (the default) resolves against the current directory when
outside a repository.

Examples:
  claude-modules enable backend-dev
  claude-modules enable backend-dev shared-tools --scope project --save
  claude-modules enable backend-dev --save=./config/team-modules.list
  claude-modules enable backend-dev --scope project --only
  claude-modules enable backend-dev --install
  claude-modules enable backend-dev --scope project --dry-run
`,

  disable: `Usage: claude-modules disable <module...> [--scope user|project|local] [--save] [--dry-run]

The reciprocal of 'enable': computes the union of enabled plugins across the
given modules and flips each one to disabled in the target scope's
settings.json:
  - only plugin keys already present in that scope's settings.json are
    touched; a plugin never enabled there has nothing to disable
  - a touched key is kept and set to false, never deleted
  - marketplaces and every other setting in the file are untouched
  - a module that enables no plugins is a no-op that logs a warning rather
    than an error

Afterward, logs the plugins now enabled in the target scope, the same report
'enable' prints (see 'enable --help' for details on the less-specific-scope
paragraphs), and a line naming which modules are still considered active
there, from the scope's saved list if one exists.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --save                       Also remove the given module names from the
                                scope's saved module list, if one exists (used
                                by 'reload'). A name not currently in the list,
                                or no saved list at all, is a no-op that logs
                                a warning rather than an error. Always targets
                                the scope's own canonical list — unlike
                                'enable --save', it does not take a path.
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing.

Examples:
  claude-modules disable backend-dev --scope project
  claude-modules disable backend-dev --save
`,

  "disable-all": `Usage: claude-modules disable-all [--scope user|project|local] [--dry-run]

Disables every plugin key currently known to the target scope's
settings.json, without needing a module:
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
  claude-modules disable-all --scope local
`,

  reload: `Usage: claude-modules reload [--scope user|project|local] [--file <path>] [--install] [--dry-run]

Re-run 'enable' with a previously-saved list of module names (see
'enable --save').

  - reads the list belonging to --scope — the same file 'enable --scope <same>
    --save' wrote (see 'enable --help' for the per-scope locations)
  - repo-scoped lists are found by walking up from the current directory to the
    repository root, so this works from any subdirectory; the user list has one
    fixed location and needs no repository at all
  - each scope reads only its own file; there is no cross-scope fallback, so a
    list is never applied at a scope it wasn't written for
  - '--file <path>' reads the module list from <path> directly instead,
    skipping the search entirely. Relative paths are resolved against the
    current directory.

Options:
  --scope user|project|local   Which settings.json to write (default: local)
  --file <path>                Read module names from this file instead of
                                searching for one
  --install                    Also attempt to add any marketplace, and
                                install any plugin, Claude Code doesn't
                                already know about (off by default). See
                                'enable --help' for the full behavior — same
                                flag, same semantics.
  --dry-run                    Compute and print the same report as a normal
                                run, but write nothing (see 'enable --help').

Examples:
  claude-modules reload --scope project
  claude-modules reload --file ./config/team-modules.list
  claude-modules reload --install
  claude-modules reload --dry-run
`,

  status: `Usage: claude-modules status [--scope user|project|local] [--verify] [--json]

Read-only audit, against two independent sources of truth:

1. Claude Code's own plugin cache: prints the same enabled-plugins report
   'enable' does (see 'enable --help'), but each effectively-enabled plugin —
   one not overridden by a more-specific scope — is cross-checked against the
   cache and annotated '(not cached by Claude Code — run ...)' when missing.
   This is the check 'plugin install'/'enable --install'/'reload' can't give you after the
   fact: their own caching step is best-effort, so a caching failure never
   blocks the settings write, and their success output alone can't tell you
   it happened.

2. The module list belonging to the target scope, if any: found the same way
   'reload' finds it, so 'status --scope X' always grades itself against
   whatever 'enable --scope X --save' wrote — never another scope's list.
   Unlike 'reload', a missing file is not an error; it just means there's
   nothing to compare against. When found, its listed modules are resolved
   (same as 'enable'/'reload') and diffed against that scope's settings.json:
     - 'Missing': a listed module wants a plugin enabled, but it isn't
     - 'Stale': a plugin is enabled, but no listed module declares it
       (explicit-'false' entries from 'enable --only' are never reported as
       stale — they were never "enabled" to begin with)

With --verify, a third check runs: 'claude plugin list --json' is consulted
for Claude Code's *own* resolution of what is enabled, and any disagreement
with this tool's is reported. This is worth the subprocess when precedence
might be decided somewhere this tool cannot see: it models scope precedence
as local > project > user, but a managed-settings policy outranks all three
and can force a plugin on or off. Off by default so that plain 'status'
keeps its guarantee of running nothing external.

--verify works the same at every scope. What it compares is what a session
started in this directory would load — the full local > project > user chain
— which is what the report above covers regardless of --scope, so the answer
doesn't shift depending on which scope you happen to be auditing.

Every check always runs and reports, so none hides another. Writes nothing.

Exit codes (so a CI/pre-session caller can tell these apart):
  0   clean: every effectively-enabled plugin is cached, settings.json
      matches the listed module(s) (if any), and — with --verify — Claude
      Code's own resolution agrees
  1   status itself couldn't run (bad --scope, no repo root, ...)
  2   it ran fine, but found a problem — uncached plugins, missing/stale
      plugins relative to the listed modules, the listed modules couldn't
      be resolved (e.g. one no longer exists), or a --verify disagreement —
      see the messages logged above

A --verify check that cannot run at all (no 'claude' on PATH, unparseable
output) is a warning, not a problem: it does not change the exit code.

Options:
  --scope user|project|local   Which settings.json to read (default: local)
  --verify                     Cross-check against 'claude plugin list --json'
  --json                       Suppress the human-readable report and print
                                one JSON object to stdout instead (exit code
                                unchanged). Shape:
                                  {
                                    "ok": boolean,
                                    "scope": "user"|"project"|"local",
                                    "settingsPath": string,
                                    "checks": {
                                      "cache": { "uncachedPluginKeys": string[] },
                                      "moduleList": {
                                        "listFilePath": string | null,
                                        "resolutionFailed": boolean,
                                        "missingPluginKeys": string[],
                                        "stalePluginKeys": string[]
                                      },
                                      "verify": null | {
                                        "ran": true,
                                        "unavailable": boolean,
                                        "unexpectedlyEnabled": string[],
                                        "unexpectedlyDisabled": string[]
                                      }
                                    }
                                  }
                                "verify" is null unless --verify was also
                                given. "ok" mirrors the exit-code decision:
                                false exactly when the command would exit 2.

project requires a git repository; use --scope user or --scope local outside
of one. local (the default) resolves against the current directory when
outside a repository.

Examples:
  claude-modules status
  claude-modules status --scope project
  claude-modules status --json
`,
};

export const GROUP_HELP: Record<string, string> = {
  marketplace: `Usage: claude-modules marketplace <subcommand> [options]

Manage marketplaces in the global registry at $CLAUDE_MODULES_HOME/settings.json,
or, with --module, in a single module's own extraKnownMarketplaces instead.

Subcommands:
  add <spec>                Register a marketplace in the global registry (or a module, with --module)
  remove <name>             Unregister a marketplace from the global registry (or a module, with --module)
  list [--module <module>]  List registered marketplaces (global registry, or a module's own)

Run 'claude-modules marketplace <subcommand> --help' for a subcommand's full options and examples.
`,

  plugin: `Usage: claude-modules plugin <subcommand> [options]

Enable or disable a plugin inside a module.

Subcommands:
  install <module> <plugin>@<marketplace>     Enable a plugin inside a module
  uninstall <module> <plugin>@<marketplace>   Disable a plugin inside a module

Run 'claude-modules plugin <subcommand> --help' for a subcommand's full options and examples.
`,

  compose: `Usage: claude-modules compose <subcommand> [options]

Edit which modules a module composes, after it's already been created.

Subcommands:
  add <module> <composed...>      Add one or more composed modules
  remove <module> <composed...>   Remove one or more composed modules

Run 'claude-modules compose <subcommand> --help' for a subcommand's full options and examples.
`,
};

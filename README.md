# claude-modules

Composable, role-based plugin bundles for [Claude Code](https://claude.com/claude-code), applied consistently across the **user**, **project**, and **local** settings scopes.

## Why

Claude Code plugins are enabled per-scope in `settings.json` via `enabledPlugins`. It's tempting to just enable everything you might ever need, everywhere — but Claude's own documentation is explicit that this backfires:

> "Tool selection accuracy degrades with more than 30-50 tools loaded at once."
> — [Claude Code docs: *Scale to many tools with tool search*](https://code.claude.com/docs/en/agent-sdk/tool-search)

Every enabled plugin adds tools Claude has to choose between on every turn. A kitchen-sink settings file doesn't make Claude more capable — it makes tool selection worse and burns context on definitions you're not using right now.

The fix is to scope your tools to the role you're currently performing. A `backend-dev` session doesn't need frontend or infra tools loaded; a `dev-ops` session doesn't need a TypeScript language server. `claude-modules` makes that practical: define a module per role (`backend-dev`, `frontend-dev`, `dev-ops`, ...), each just naming the plugins and marketplaces that role needs, and enable one or more of them in whichever scope you're working in. Switching roles becomes one command instead of hand-editing `enabledPlugins` in three different files.

(Claude Code's MCP tool search — on by default — already defers MCP tool *schemas* from context and loads them on demand, so the context-budget argument above is weaker for MCP-heavy plugins specifically than it is for skills, slash commands, subagent definitions, hooks, and LSP servers, which tool search doesn't touch. The reproducibility/composability/drift-detection value below is unaffected either way.)

## Concepts

- **Module** — a directory under `$CLAUDE_MODULES_HOME/modules/<module>/` holding a `settings.json` (`{enabledPlugins, extraKnownMarketplaces}`), matching the exact shape Claude Code itself uses, plus a `version` field of its own that Claude Code doesn't know about.

  `version` is a semver string, bumped automatically whenever a command changes what the module declares:
  - **Patch** on `plugin install` and `marketplace add --module` (the module gained something).
  - **Minor** (patch reset to `0`) on `plugin uninstall` and `marketplace remove --module` (the module lost something).
  - `marketplace add`/`remove` **without** `--module` only touch the global registry, never a module's own version.
  - A new module always starts at `1.0.0` (`create`, with or without `--from-scope`/`--compose`), regardless of how much it's seeded with at creation.
  - `export`/`import` carry the version through unchanged — it isn't bumped by transferring a module, only by changing its content.
  - There's no CLI command to set a version directly (e.g. to make a deliberate major bump) — hand-edit `version` in the module's `settings.json`, the same way `composedModules` is hand-edited today; the next patch/minor bump increments from whatever you set (a hand-edited `2.0.0` becomes `2.0.1` after the next `plugin install`).

  There are two, distinct ways modules combine — same word ("compose"), two different mechanisms:
  - **Ad-hoc, CLI-time union** — name several modules on one `enable`/`disable` call and they're
    unioned for that call only: `enable web backend` applies the union of both. Nothing is recorded;
    do it again next time you want the same combination.
  - **Declared, persistent composition** — a module's own `composedModules: string[]` (set at
    creation via `create --compose`, or changed later via `compose add`/`compose remove`, see below)
    names other modules it builds on. This is part of the module itself: every future
    `enable`/`disable`/`status` against that module transitively pulls in whatever its composed
    modules currently contribute, with no need to re-list them. The composing module's own
    `enabledPlugins`/`extraKnownMarketplaces` win over anything a composed module also declares.

    `compose add`/`compose remove` validate a self-reference, a composition cycle, a missing
    composed module, and a sibling marketplace conflict *before* writing anything, the same way
    `create --compose` does. The only way to bypass that validation is to hand-edit a module's
    `settings.json` directly — `claude-modules` does **not** validate a hand-edit when it's made: a
    typo, a cycle, or a conflicting marketplace surfaces as an error only on the *next*
    `enable`/`disable`/`status` that touches the module, not at edit time.
- **Scope** — where the computed result gets written, same three scopes Claude Code uses:
  | Scope     | File                                     |
  |-----------|-------------------------------------------|
  | `user`    | `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`, if set) |
  | `project` | `<repo_root>/.claude/settings.json`        |
  | `local`   | `<repo_root>/.claude/settings.local.json`, or `<cwd>/.claude/settings.local.json` outside a git repository (default) |
- **Global marketplace registry** — `$CLAUDE_MODULES_HOME/settings.json`, a small lookup of marketplace name → source, populated by `marketplace add` and consulted by `plugin install` so you don't have to repeat `--source` every time.
- **Module lists** — an optional file (one module name per line) that remembers which modules you applied, so `reload` can reapply them without retyping — and so `status` can tell you when a scope's `settings.json` has drifted from it. **One list per scope**, each living with the thing it describes:
  | Scope     | Module list                          | |
  |-----------|---------------------------------------|---|
  | `user`    | `$CLAUDE_MODULES_HOME/user.modules` | global; not tied to any repository |
  | `project` | `<repo_root>/.claude-modules`        | shared with the team — commit it |
  | `local`   | `<repo_root>/.claude-modules.local`, or `<cwd>/.claude-modules.local` outside a repository | personal to your checkout — gitignore it |

  Because each scope has its own list, `enable --scope X --save`, `reload --scope X`, and `status --scope X` always agree, and saving at one scope never clobbers another's.

> **Changes apply to the *next* session.** Claude Code reads `enabledPlugins` at session start, so
> running any of these commands has no effect on a session that's already open — which looks exactly
> like the command having done nothing. Run `/reload-plugins` in that session (add `--force` if it
> warns about the prompt cache), or start a new one. Every command that changes what's enabled
> reminds you of this in its output.

## Installation

```bash
npm install
npm run build
```

This produces `dist/claude-modules.js` (the `bin` entry point). During development, run directly against TypeScript instead:

```bash
npm run dev -- <command> ...
```

`npm run dev` sets `CLAUDE_MODULES_HOME=.`, so it reads/writes the project's own `modules/` directory rather than your real `~/.claude-modules`.

### Configuration

`$CLAUDE_MODULES_HOME` — where modules and the marketplace registry live. Defaults to `~/.claude-modules` if unset.

`$CLAUDE_CONFIG_DIR` — Claude Code's own home directory, consulted for the `user` scope and for `plugin install`'s `known_marketplaces.json` fallback below. Defaults to `~/.claude` if unset, matching Claude Code itself.

## Commands

Run `claude-modules --help` any time for this list, or `claude-modules <command> --help` for a command's full options and examples.

### `list`

```bash
claude-modules list
```

Lists every module with its enabled-plugin and known-marketplace counts.

### `info <module>`

```bash
claude-modules info backend-dev
```

Shows a module's full detail: every enabled plugin, and every additional marketplace it knows about (with its source). Like `marketplace list --module`, this reads the module's own file directly, never through `CompositionResolver` — it shows what the module itself declares, not what it effectively contributes once composed modules are resolved in.

### `create <module>`

```bash
claude-modules create backend-dev
claude-modules create backend-dev --from-scope local
claude-modules create frontend-dev --compose base
claude-modules create fullstack-dev --compose backend-dev --compose frontend-dev
```

Creates a new module. Errors if the name is already taken.

Empty by default. `--from-scope <user|project|local>` instead seeds it from the plugins and marketplaces already enabled in that scope's `settings.json` — the quickest way to capture a setup you arrived at by hand or through `/plugin`, and usually where you want to start: define your first module from a repo that's already configured the way you like, rather than re-typing every `<plugin>@<marketplace>` through `plugin install`.

Only plugins actually enabled (`true`) there are captured. An explicit `false` is an *override* — that's how `enable --only` suppresses a plugin inherited from a broader scope — not a member of the set that scope uses, so it's skipped rather than recorded as disabled. The scope is only read, never written.

`--compose <module>` (repeatable) declares that this module builds on another one — a persistent relationship, stored on the new module as `composedModules`, distinct from the ad-hoc union `enable web backend` performs at CLI time (see Concepts). Every future `enable`/`disable`/`status` against this module transitively pulls in whatever each composed module currently contributes; this module's own `enabledPlugins`/`extraKnownMarketplaces` win over anything a composed module also declares. `--compose` is independent of `--from-scope` — combine both to seed from a live scope *and* declare a composition.

Before writing anything, a self-reference, a missing `--compose` target, a composition cycle, or a marketplace conflict between two composed modules is rejected. `--compose` sets the initial composition at creation time; use `compose add`/`compose remove` (below) to change it afterward.

### `compose add <module> <composed...>`

```bash
claude-modules compose add frontend base
claude-modules compose add frontend base shared-tools
```

Adds one or more composed modules to an existing module's `composedModules` — the CLI path to change composition after `create`, short of hand-editing `settings.json`. Every future `enable`/`disable`/`status`/`export` against `<module>` transitively pulls in whatever the newly-composed module(s) contribute.

Validates the whole batch atomically before writing anything, the same way `create --compose` does: a self-reference, a composition cycle, a missing composed module, or a sibling marketplace conflict rejects the entire call — nothing is written, even if some of the named modules would have been fine on their own. Idempotent per name: a composed module already present is skipped (noted in the output), and if every named module is already composed, this is a no-op that logs a warning rather than failing. Bumps the module's patch version once per call, regardless of how many modules were actually added.

### `compose remove <module> <composed...>`

```bash
claude-modules compose remove frontend shared-tools
```

The reciprocal of `compose add`: removes one or more composed modules from an existing module's `composedModules`. Idempotent per name — a module not currently composed is skipped (noted in the output), and if none of the named modules are currently composed, this is a no-op that logs a warning rather than failing. Never re-validates composition afterward: removing entries can only shrink the effective set, never introduce a new cycle or conflict. Bumps the module's minor version (and resets patch to `0`) once per call.

### `remove <module>`

```bash
claude-modules remove backend-dev
```

Deletes a module's directory (recursively). Idempotent — if the module doesn't exist, this logs a warning rather than failing. Only removes the module itself — it doesn't touch any scope's `settings.json` (plugins already enabled stay enabled until the next `enable`/`reload` that omits this module) and doesn't clean up references to it in any module list. If the module being removed is still listed in one of this machine's saved module lists (`user`/`project`/`local`), a warning names the file — it can't reach lists on other machines or repos, but catches the common case; `reload` also names the specific list file if it later hits a module removed out from under it.

### `export <module>`

```bash
claude-modules export backend-dev
claude-modules export fullstack-dev --output ~/backups/fullstack.tar.gz
```

Packages a module's directory — and the directory of every module it transitively composes (see `create --compose`) — into a single `.tar.gz`, so the whole `composedModules` chain travels together and works out of the box after `import` on another machine.

The archive mirrors `$CLAUDE_MODULES_HOME/modules/` internally (one directory per module, whatever it contains — today just `settings.json`), plus a small internal manifest recording which module is the root and which are composed. This is what lets `import --name`/`--composed-prefix` rename modules on the way in without losing track of which directory is which — it's an implementation detail, not something you need to read or edit.

Without `--output`, the archive is written to `<module>-<YYYY-MM-DD>.tar.gz` in the current directory. If any archived module has a marketplace with a non-`github` source, a warning is logged — same as `create --from-scope` and `plugin install` — since that marketplace won't mean anything on another machine. A composition cycle among the modules being archived is rejected before anything is written.

### `import <archive>`

```bash
claude-modules import backend-dev-2026-08-18.tar.gz
claude-modules import backend-dev-2026-08-18.tar.gz --name backend-dev-imported
claude-modules import backend-dev-2026-08-18.tar.gz --composed-prefix teammate-
```

Unpacks a module — and its composed modules — from an `export` archive; the reciprocal of `export`.

The root module is named from `--name` if given, otherwise from the name it was exported under. Composed modules keep their original names unless `--composed-prefix` is given, in which case *every* composed module — at every level of the composition tree, not just the root's immediate children — is renamed with that prefix, and every module's `composedModules` references are rewritten to match, so composition keeps working after the rename.

If any module being imported (root or composed) would collide with a module that already exists on this machine, nothing is written: the error lists every collision, and for each recommends either renaming the existing module, or re-running with `--name` (for a root collision) or `--composed-prefix` (for a composed-module collision).

### `plugin install <module> <plugin>@<marketplace>`

```bash
claude-modules plugin install backend-dev typescript-lsp@claude-plugins
```

Enables a plugin inside a module. If the plugin's marketplace isn't already known to that module, its source is resolved in order: an explicit `--source '<json>'` on this call, then the global marketplace registry, then Claude Code's own local `known_marketplaces.json` cache (if you've already added the marketplace via `/plugin` inside Claude Code, `plugin install` picks it up automatically — copied onto the module as a snapshot, not a live reference), otherwise the command fails with instructions to fix it. Bumps the module's patch version.

```bash
claude-modules plugin install backend-dev foo@custom-mp \
  --source '{"source":{"source":"github","repo":"me/custom"}}'
```

Enabling a plugin in `settings.json` isn't enough on its own — Claude Code
also needs the plugin's content materialized in its own cache
(`$CLAUDE_CONFIG_DIR/plugins/`), or a new session in a repo using it fails
with `Plugin "<name>" not cached at <marketplace-dir>`. To prevent that,
`plugin install` also runs `claude plugin install <plugin>@<marketplace> --scope
user -y` on your behalf, but only if the plugin isn't cached yet and its
marketplace is already known to Claude Code (`known_marketplaces.json`) —
this never happens silently: a plugin that was missing and got installed as
a result is logged explicitly, and any failure (no `claude` on `PATH`, no
network, unknown marketplace) is a warning, not a hard error — the module
is still saved either way. `enable --install`/`reload --install` re-check
this too, so a plugin enabled by hand-editing a module file, or one synced in
from another machine, still gets cached before you hit the error in a real
session — plain `enable`/`reload` (without `--install`) does not attempt this
on their own; they only report what's missing (see `enable` below). Note
that `-y` accepts a marketplace-declared "run a command to install" plugin's
command without showing it to you first — fine for the official marketplace,
worth knowing for third-party ones.

Because caching is best-effort, a plugin can end up enabled in `settings.json`
without actually being cached (offline, unknown marketplace, `claude` missing
from `PATH`, ...). Every command that writes `enabledPlugins` reports this
inline — an enabled plugin missing from the cache is annotated `(not cached
by Claude Code — run ...)` right in its own output — and `status` (below)
answers the same question on demand, without writing anything.

### `plugin uninstall <module> <plugin>@<marketplace>`

```bash
claude-modules plugin uninstall backend-dev typescript-lsp@claude-plugins
```

The reciprocal of `plugin install`: disables a plugin inside a module. By default it deletes the
key from the module's `enabledPlugins` — it never runs `claude plugin uninstall` (Claude Code's
plugin cache is shared across modules, so other modules on this machine may still need the plugin
cached) and never removes the plugin's marketplace from `extraKnownMarketplaces`, even if it was
the last plugin referencing it. If the plugin isn't currently enabled in the module, this is a
no-op that logs a warning rather than failing (and doesn't bump the version). Otherwise, bumps
the module's minor version (and resets patch to `0`).

```bash
claude-modules plugin uninstall backend-dev typescript-lsp@claude-plugins --disable
```

`--disable` sets the key to `false` instead of deleting it. Plain `uninstall` means "this module
says nothing about the plugin"; `--disable` means "this module explicitly turns it off" — which
only matters when the module composes another one that enables the same plugin, since composition
gives a module's own explicit `false` precedence over what a composed module contributes, but a
merely-absent key has no such effect (see `compose add` below). Unlike plain `uninstall`,
`--disable` isn't gated on the plugin already being enabled in this
module directly — that's the point, since the plugin it's meant to override typically isn't; the
only true no-op is a plugin that's already explicitly `false`.

**Known limit:** the override only survives one level of composition. `--disable` beats a
*directly* composed child's `true`, but resolve that module into a grandparent's composition and
the override evaporates — the grandparent sees no opinion either way, not an explicit `false`. In
the same vein, two composed siblings that disagree on a plugin key (one enables it, one doesn't)
resolve silently instead of erroring the way a marketplace conflict does — the enabling sibling
wins, without warning. Neither case is common enough today to justify reworking composition's
internal representation to track a real enabled/disabled/unmentioned tri-state; if you build a deep
composition tree that depends on multi-level exclusion, know that it doesn't propagate past one level.

### `marketplace add <spec>`

```bash
claude-modules marketplace add anthropics/claude-plugins
```

Registers a marketplace in the global registry, mirroring `/plugin marketplace add <spec>`: `<spec>` can be a GitHub `owner/repo` shorthand (optionally pinned to a branch/tag with a trailing `@ref`, e.g. `owner/repo@v2.0` — the name is still inferred from `owner/repo` alone), a git URL (pin with a trailing `#ref`), or a local path, with the type auto-detected and the name inferred (override with `--name`). Only the GitHub shorthand has a documented `settings.json` shape; for git/local sources, double-check the registered entry or pass `--source '<json>'` explicitly. With `--module`, bumps that module's patch version — without it, only the global registry changes, and no module's version is touched.

### `marketplace remove <name>`

```bash
claude-modules marketplace remove official
```

The reciprocal of `marketplace add`: unregisters a marketplace from the global registry. Idempotent — if the marketplace isn't registered, this logs a warning rather than failing. Only edits the global registry — it doesn't touch any module's `extraKnownMarketplaces` (marketplaces already resolved onto a module were copied as a snapshot, not a live reference) and doesn't touch Claude Code's own `known_marketplaces.json` cache. A future `plugin install` that needs this marketplace and can't fall back to that cache will fail until it's registered again. With `--module`, a successful removal bumps that module's minor version (and resets patch to `0`); the idempotent no-op path doesn't bump anything, and neither does the `--module`-less, global-registry-only form.

### `marketplace list`

```bash
claude-modules marketplace list
claude-modules marketplace list --module backend-dev
```

Lists every marketplace registered in the global registry, or, with `--module`, a single module's own `extraKnownMarketplaces` instead — each line shows the marketplace name and its raw source JSON. Like `marketplace add`/`remove` with `--module`, this only shows the module's own map, not marketplaces it inherits from a composed module.

### `enable <module...>`

```bash
claude-modules enable backend-dev
claude-modules enable backend-dev shared-tools --scope project --save
claude-modules enable backend-dev --save=./config/team-modules.list
claude-modules enable backend-dev --scope project --only
claude-modules enable backend-dev --install
```

Computes the union of enabled plugins and known marketplaces across the given modules and writes it into the target scope:

- every plugin in the union is enabled; every other plugin is left exactly as it was, so a later `enable` for a different module *adds* to what's already active in that scope rather than replacing it (its key is kept if already present, nothing else in the file is touched)
- marketplaces in the union are added if missing; existing entries are never removed or overwritten
- `--scope` defaults to `local`; `project` requires a git repository — pass `--scope user` or `--scope local` outside of one. `local` itself needs no repository: outside one it resolves against the current directory instead (Claude Code reads `.claude/settings.local.json` from `cwd` either way), and a warning is printed so it's clear where it landed
- `--only` makes the target scope *exactly* the given modules instead of adding to it: every plugin not in the union is explicitly disabled in this scope's own file (the same disable-everything-else behavior plain `enable` used to always have), and — for `local`/`project` — any plugin enabled in a broader scope but not part of the union is also disabled here (`project` and `user` for `local`; just `user` for `project`; the broader-scope half is a no-op for `user`, which has no broader scope, but this scope's own plugins are still made exact). The broader scope's file is only ever read, never written. The command output names which plugins were overridden and which scope they came from. This is the tool to reach for when you want an exclusive role switch — see the `user`-scope example below.
- `--install` attempts to add, to Claude Code's own `known_marketplaces.json`, any union marketplace it doesn't already know about — a `claude plugin marketplace add <source> --scope user` call per marketplace — and then attempts to install, into Claude Code's own plugin cache, any union plugin it hasn't cached yet — the same `claude plugin install <plugin> --scope user -y` call the `plugin install` command makes (see above), attempted only when the plugin's marketplace is already known to Claude Code. Marketplaces are always attempted first, so a plugin from a marketplace just added in the same run still gets a chance to install. Off by default: a plain `enable` never shells out to `claude`; it only reports what's missing (see below). If a marketplace or plugin is still missing after the attempt, `enable` exits with code 2 — unless `--dry-run` was also given, in which case nothing was actually attempted and the exit code stays 0.
- `--save[=<path>]` also updates the scope's saved module list, one name per line, for later use by `reload`: the selected modules are *merged* into whatever the list already had, matching plain `enable`'s additive default (`--only --save` replaces the list instead, matching `--only`'s exact-set semantics):
  - bare `--save` writes to that scope's own list (see the table under [Concepts](#concepts)): `user.modules` in `$CLAUDE_MODULES_HOME` for `--scope user`, or `.claude-modules` / `.claude-modules.local` at the repository root for `project` / `local` — or, for `local` outside a repository, at `cwd`. Repo-scoped lists sit at the root so `reload` finds them from any subdirectory; the user list has one fixed global location, so `reload --scope user` works from anywhere, including outside a repository. Saving at one scope never overwrites another's list.
  - `--save=<path>` writes to `<path>` instead (relative paths resolve against the current directory, not the repository root). A custom path is only ever read back with `reload --file <path>` — bare `reload` looks only at the per-scope locations above and will not find it. The merge base is still read from the scope's canonical list, if one exists, regardless of where this run saves to.
  - the value must be given with `=` (`--save=path`), not as a following argument (`--save path`), since `enable` takes a variadic list of module names and a space-separated value would be ambiguous with the next one

Afterward, it logs one consolidated `Enabled plugin(s):` list covering every scope in effect here — `local`, `project`, and `user` inside a repository; `local` and `user` outside one, since `local` needs no repository — with each plugin tagged inline with its scope (`(local)` / `(project)` / `(user)`, color-coded) so it's clear which plugin comes from where. Since Claude Code resolves `enabledPlugins` with `local` taking precedence over `project` over `user`, an entry is annotated `(<scope> — overridden by <scope>)` when a more-specific scope explicitly disables it.

The report always covers the whole chain, whatever `--scope` you passed, because that is what decides which plugins a session actually loads. So `enable --scope user` run inside a repository will also show what that repository's `local` scope contributes on top.

It also logs a `Modules active in <scope> scope:` line — sourced from the scope's saved list (freshly updated first, if `--save` was given) when one exists, or just this run's own module names, noted as not persisted, when none does.

If anything ends up enabled but not yet cached by Claude Code, a further block lists one manual `claude plugin install` command per plugin, so it can be fixed by hand — and, if any union marketplace isn't known to Claude Code either, a similar block lists one manual `claude plugin marketplace add` command per marketplace. Pass `--install` to attempt them all automatically instead.

### `disable <module...>`

```bash
claude-modules disable backend-dev --scope project
claude-modules disable backend-dev --save
```

The reciprocal of `enable`: computes the union of enabled plugins across the given modules and flips each one to `false` in the target scope's `settings.json`.

- only plugin keys already present in that scope's `settings.json` are touched — a plugin never enabled there has nothing to disable
- a touched key is kept and set to `false`, never deleted; marketplaces and every other setting in the file are untouched
- `--scope` defaults to `local`, same as `enable`
- a module that enables no plugins is a no-op that logs a warning rather than failing
- `--save` also removes the given modules from the scope's saved list (used by `reload`), if one exists — a name not currently in the list, or no saved list at all, is a no-op that logs a warning rather than failing. Unlike `enable --save`, it always targets the scope's own canonical list; it does not take a path.

Afterward, it prints the same enabled-plugins report `enable` does, plus the same `Modules active in <scope> scope:` line described above.

### `disable-all`

```bash
claude-modules disable-all --scope local
```

Disables every plugin key currently known to the target scope's `settings.json`, without needing a module — the bulk equivalent of `disable`. Keys are kept and set to `false`, never deleted; marketplaces and every other setting in the file are untouched. `--scope` defaults to `local`. Afterward, it prints the same enabled-plugins report `enable` does.

### `reload`

```bash
claude-modules reload --scope project
claude-modules reload --file ./config/team-modules.list
claude-modules reload --install
```

Re-applies a previously-saved list of module names — equivalent to running `enable` with that same list.

- reads the list belonging to `--scope` — exactly what `enable --scope <same> --save` wrote. Repo-scoped lists are found by walking up from the current directory to the repository root, so this works from any subdirectory; the user list has one fixed location and needs no repository; `local` outside a repository looks only at the current directory itself, same as `enable --scope local --save` wrote it
- each scope reads only its own file — there is no cross-scope fallback, so a list is never applied at a scope it wasn't written for
- `--file <path>` reads the module list from `<path>` directly instead, skipping the search entirely; relative paths resolve against the current directory
- `--install` attempts the same best-effort marketplace-add/plugin-install caching `enable --install` does (see above) — off by default, same flag, same semantics.

> **Behavior change:** `reload` used to always attempt this caching step unconditionally (there was no way to turn it off). It now defaults to off and only attempts it when `--install` is passed, for symmetry with `enable`. If you relied on `reload` silently re-caching plugins, add `--install` to keep that behavior.

### `status`

```bash
claude-modules status
claude-modules status --scope project
claude-modules status --verify
claude-modules status --json
```

Read-only audit of a scope's live `settings.json` against two independent sources of truth (three with `--verify`):

1. **Claude Code's own plugin cache** — prints the same consolidated enabled-plugins report `enable` does (one list covering every scope in effect here, with `(<scope> — overridden by <scope>)` annotations), and additionally cross-checks every effectively-enabled plugin (one not overridden by a more-specific scope) against the cache, annotating it `(not cached by Claude Code — run ...)` when missing. This is the check `plugin install`/`enable --install`/`reload` can't give you after the fact: their caching step is best-effort by design (a caching failure never blocks the settings write), so their own success output can't tell you whether it actually happened.

2. **The module list belonging to the target scope, if any** — found the same way `reload` finds it, so `status --scope X` always grades itself against whatever `enable --scope X --save` wrote, never another scope's list. Unlike `reload`, a missing file isn't an error — it just means there's nothing to compare against. When found, its listed modules are resolved exactly like `enable`/`reload` would, and diffed against the target scope's own `settings.json`:
   - **Missing** — a listed module wants a plugin enabled, but it isn't.
   - **Stale** — a plugin is enabled, but no listed module declares it (explicit-`false` entries left by `enable --only` are never reported as stale, since they were never "enabled" to begin with).

3. **Claude Code's own resolution — only with `--verify`.** Runs `claude plugin list --json` and diffs its `enabled` set against the one computed above. Worth the subprocess because precedence can be decided somewhere this tool can't see: it models scope precedence as `local > project > user`, but **managed settings outrank all three** and can force a plugin on or off. On a machine with an administrator policy, the report from checks 1–2 can be confidently wrong, and this is the only way to notice. Off by default so plain `status` keeps its guarantee of running nothing external. A `--verify` that *can't* run (no `claude` on `PATH`, unparseable output) is a warning, not drift — it never changes the exit code.

   `--verify` behaves identically at all three scopes. Both sides describe the same thing — what a session started in this directory would load — because the report above always covers the full `local > project > user` chain regardless of `--scope`. (An earlier version compared a truncated set and had to be restricted to `--scope local` to avoid inventing drift; that restriction is gone.)

Every check always runs and reports, independent of re-running `enable`/`reload`, and `status` writes nothing. `--scope` defaults to `local`; `project` requires a git repository, same as `enable` — `local` does not.

Exit code distinguishes "ran fine" from "found a problem" from "couldn't even check", so it's usable as a CI or pre-session gate, not just a log line to notice in the moment:

| Code | Meaning |
|------|---------|
| `0`  | clean: every effectively-enabled plugin is cached, `settings.json` matches the listed module(s) (if any), and — with `--verify` — Claude Code's own resolution agrees |
| `1`  | `status` itself couldn't run (bad `--scope`, no repo root, ...) |
| `2`  | it ran fine, but found a problem — uncached plugins, missing/stale plugins relative to the listed modules, the listed modules couldn't be resolved, or a `--verify` disagreement — see the messages logged above |

`--json` suppresses the human-readable report above and prints one JSON object to stdout instead — the exit-code contract is unchanged, so it stays usable as a CI gate while also being scriptable:

```json
{
  "ok": true,
  "scope": "local",
  "settingsPath": "/repo/.claude/settings.local.json",
  "checks": {
    "cache": { "uncachedPluginKeys": [] },
    "moduleList": {
      "listFilePath": "/repo/.claude-modules.local",
      "resolutionFailed": false,
      "missingPluginKeys": [],
      "stalePluginKeys": []
    },
    "verify": null
  }
}
```

`checks.moduleList.listFilePath` is `null` when the scope has no module list. `checks.verify` is `null` unless `--verify` was also passed; otherwise `{ "ran": true, "unavailable": false, "unexpectedlyEnabled": [], "unexpectedlyDisabled": [] }` (`unavailable: true` when the `claude plugin list --json` cross-check itself couldn't run — the warning that would normally explain why is suppressed under `--json`, since that signal relocates into this field). `ok` mirrors the exit-code decision: `false` exactly when the command would exit `2`. In that case the human-readable problem summary still prints on stderr, same as without `--json` — only stdout carries the JSON, so a script reading just stdout always sees clean JSON.

## Example workflow

```bash
# Fastest start: capture a repo you've already configured by hand into a module
cd ~/projects/api-service
claude-modules create backend-dev --from-scope local

# Or define one from scratch
claude-modules create frontend-dev
claude-modules marketplace add anthropics/claude-plugins
claude-modules marketplace list   # confirm what's registered before installing from it
claude-modules plugin install frontend-dev playwright@claude-plugins

# Working in a repo as a backend dev today:
claude-modules enable backend-dev --scope project --save

# Full-stack repo? Ad-hoc union — name several modules on one call, applied together:
cd ~/projects/web-app
claude-modules enable backend-dev frontend-dev shared-tools --save

# Prefer that combination to be permanent instead of retyped every time? Declare it once instead:
claude-modules create fullstack-dev --compose backend-dev --compose frontend-dev --compose shared-tools
claude-modules enable fullstack-dev --save   # transitively pulls in all three, every time

# Later, in the same repo tree, after a module's plugin list changed:
claude-modules reload --scope project
```

Modules don't have to be tied to a repository. A set of plugins you switch *into* — a weekend
research mode, say — lives at `user` scope. Plain `enable` *adds* to whatever's already active, so
an exclusive switch — where the previous mode's plugins go quiet — reaches for `--only`, still a
single command:

```bash
claude-modules enable investing --scope user --only --save   # $CLAUDE_MODULES_HOME/user.modules
claude-modules enable backend-dev --scope user --only            # Monday: investing plugins go quiet
```

Drop `--only` and the same command becomes additive instead — `enable backend-dev --scope user`
on its own would leave `investing`'s plugins on and layer `backend-dev`'s on top, which is the
right call when you're stacking capabilities rather than switching between them.

## Limitations

**No token-cost preview.** The argument at the top of this README is about context budget, but
`claude-modules` reports plugin *counts*, not tokens. Claude Code knows the number —
`claude plugin details <plugin>` prints a "Projected token cost" — but there's no way to aggregate
it per module yet: the command has no `--json` output, and it only resolves plugins that are
already *enabled*, so it can't cost a module you haven't applied. (Its error message suggests
`--plugin-dir` as a way around that; the flag isn't implemented on `details`.) Revisit when either
lands upstream.

**No version pinning.** A module records which plugins to enable, not which versions. Syncing one
to another machine reproduces the plugin *set*, not the exact versions — Claude Code updates
plugins on its own cadence, and pinning is the marketplace's job. Treat modules as portable
role definitions, not lockfiles.

**Marketplace sources are snapshots.** When `plugin install` resolves a marketplace from the global
registry or from Claude Code's own cache, it copies the source onto the module. Later changes to
the registry don't propagate, and a non-`github` source (a local path, say) won't mean anything on
another machine — `plugin install` warns when it resolves one.

**A module records which plugins are on, not their configuration.** Claude Code's per-plugin
`userConfig` (set via `claude plugin install --config` or `/plugin configure`) — where an MCP
server's API key or endpoint typically lives — isn't captured by `create --from-scope`, `export`,
or `import`. This is deliberate, not an oversight: a module is designed to be shared and committed
(the `project`-scope module list is meant to go into version control), and capturing `userConfig`
by default would turn that into an accidental secret-exfiltration path. A plugin that needs
configuration to function arrives enabled but unconfigured after any of the above — configure it
separately with Claude Code's own tooling.

**Plugin-level `dependencies` aren't understood.** Claude Code's marketplace plugin manifests
support a `dependencies` field (auto-installed, semver-constrained; native `enable`/`disable` won't
break them), but this tool only ever reasons about the literal plugin keys a module names — it has
no awareness of a plugin's declared dependencies. As of this writing, no plugin in either official
marketplace (`claude-plugins-official`/`claude-plugins-community`) actually declares one, so this
has no real-world impact today; worth revisiting if that changes.

## Development

```bash
npm run dev -- list          # runs against ./modules instead of ~/.claude-modules
npm run typecheck            # src/ and test/ both
npm test                     # vitest
npm run build
```

Tests drive the real `Cli` against throwaway temp directories, with both `$CLAUDE_MODULES_HOME` and
`$CLAUDE_CONFIG_DIR` redirected there — nothing in the suite can reach your real `~/.claude`. See
[`test/helpers/harness.ts`](test/helpers/harness.ts).

Note that `npm run typecheck` runs `tsc` twice: once for the build config (`src/` only, matching what
ships) and once for `tsconfig.test.json`, which adds `test/`. Without the second pass, tests keep
running against stale types — vitest strips types with esbuild and never checks them.

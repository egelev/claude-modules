# claude-profiles

Composable, role-based plugin bundles for [Claude Code](https://claude.com/claude-code), applied consistently across the **user**, **project**, and **local** settings scopes.

## Why

Claude Code plugins are enabled per-scope in `settings.json` via `enabledPlugins`. It's tempting to just enable everything you might ever need, everywhere — but Claude's own documentation is explicit that this backfires:

> "Tool selection accuracy degrades with more than 30-50 tools loaded at once."
> — [Claude Code docs: *Scale to many tools with tool search*](https://code.claude.com/docs/en/agent-sdk/tool-search)

Every enabled plugin adds tools Claude has to choose between on every turn. A kitchen-sink settings file doesn't make Claude more capable — it makes tool selection worse and burns context on definitions you're not using right now.

The fix is to scope your tools to the role you're currently performing. A `backend-dev` session doesn't need frontend or infra tools loaded; a `dev-ops` session doesn't need a TypeScript language server. `claude-profiles` makes that practical: define a profile per role (`backend-dev`, `frontend-dev`, `dev-ops`, ...), each just naming the plugins and marketplaces that role needs, and enable one or more of them in whichever scope you're working in. Switching roles becomes one command instead of hand-editing `enabledPlugins` in three different files.

## Concepts

- **Profile** — a small JSON file (`{enabledPlugins, extraKnownMarketplaces}`) under `$CLAUDE_PROFILES_HOME/profiles/<profile>.json`, matching the exact shape Claude Code itself uses. Profiles are meant to be composed: `enable web backend` unions both.
- **Scope** — where the computed result gets written, same three scopes Claude Code uses:
  | Scope     | File                                     |
  |-----------|-------------------------------------------|
  | `user`    | `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`, if set) |
  | `project` | `<repo_root>/.claude/settings.json`        |
  | `local`   | `<repo_root>/.claude/settings.local.json` (default) |
- **Global marketplace registry** — `$CLAUDE_PROFILES_HOME/settings.json`, a small lookup of marketplace name → source, populated by `add-marketplace` and consulted by `install` so you don't have to repeat `--source` every time.
- **`.claude-profiles`** — an optional file (one profile name per line) that remembers which profiles a repository uses, so `reload` can reapply them without retyping the list — and so `status` can tell you when a scope's `settings.json` has drifted from it.

## Installation

```bash
npm install
npm run build
```

This produces `dist/claude-profiles.js` (the `bin` entry point). During development, run directly against TypeScript instead:

```bash
npm run dev -- <command> ...
```

`npm run dev` sets `CLAUDE_PROFILES_HOME=.`, so it reads/writes the project's own `profiles/` directory rather than your real `~/.claude-profiles`.

### Configuration

`$CLAUDE_PROFILES_HOME` — where profiles and the marketplace registry live. Defaults to `~/.claude-profiles` if unset.

`$CLAUDE_CONFIG_DIR` — Claude Code's own home directory, consulted for the `user` scope and for `install`'s `known_marketplaces.json` fallback below. Defaults to `~/.claude` if unset, matching Claude Code itself.

## Commands

Run `claude-profiles --help` any time for this list, or `claude-profiles <command> --help` for a command's full options and examples.

### `list`

```bash
claude-profiles list
```

Lists every profile with its enabled-plugin and known-marketplace counts.

### `info <profile>`

```bash
claude-profiles info backend-dev
```

Shows a profile's full detail: every enabled plugin, and every additional marketplace it knows about (with its source).

### `create <profile>`

```bash
claude-profiles create backend-dev
```

Creates a new, empty profile. Errors if the name is already taken.

### `remove <profile>`

```bash
claude-profiles remove backend-dev
```

Deletes a profile file. Idempotent — if the profile doesn't exist, this logs a warning rather than failing. Only removes the profile itself — it doesn't touch any scope's `settings.json` (plugins already enabled stay enabled until the next `enable`/`reload` that omits this profile) and doesn't clean up references to it in any `.claude-profiles` file.

### `install <plugin>@<marketplace> --profile <profile>`

```bash
claude-profiles install typescript-lsp@claude-plugins --profile backend-dev
```

Enables a plugin inside a profile. If the plugin's marketplace isn't already known to that profile, its source is resolved in order: an explicit `--source '<json>'` on this call, then the global marketplace registry, then Claude Code's own local `known_marketplaces.json` cache (if you've already added the marketplace via `/plugin` inside Claude Code, `install` picks it up automatically — copied onto the profile as a snapshot, not a live reference), otherwise the command fails with instructions to fix it.

```bash
claude-profiles install foo@custom-mp --profile backend-dev \
  --source '{"source":{"source":"github","repo":"me/custom"}}'
```

Enabling a plugin in `settings.json` isn't enough on its own — Claude Code
also needs the plugin's content materialized in its own cache
(`$CLAUDE_CONFIG_DIR/plugins/`), or a new session in a repo using it fails
with `Plugin "<name>" not cached at <marketplace-dir>`. To prevent that,
`install` also runs `claude plugin install <plugin>@<marketplace> --scope
user -y` on your behalf, but only if the plugin isn't cached yet and its
marketplace is already known to Claude Code (`known_marketplaces.json`) —
this never happens silently: a plugin that was missing and got installed as
a result is logged explicitly, and any failure (no `claude` on `PATH`, no
network, unknown marketplace) is a warning, not a hard error — the profile
is still saved either way. `enable`/`reload` re-check this too, so a plugin
enabled by hand-editing a profile file, or one synced in from another
machine, still gets cached before you hit the error in a real session. Note
that `-y` accepts a marketplace-declared "run a command to install" plugin's
command without showing it to you first — fine for the official marketplace,
worth knowing for third-party ones.

Because caching is best-effort, a plugin can end up enabled in `settings.json`
without actually being cached (offline, unknown marketplace, `claude` missing
from `PATH`, ...). Every command that writes `enabledPlugins` reports this
inline — an enabled plugin missing from the cache is annotated `(not cached
by Claude Code — run ...)` right in its own output — and `status` (below)
answers the same question on demand, without writing anything.

### `uninstall <plugin>@<marketplace> --profile <profile>`

```bash
claude-profiles uninstall typescript-lsp@claude-plugins --profile backend-dev
```

The reciprocal of `install`: disables a plugin inside a profile. It only edits the profile's
`enabledPlugins` — it never runs `claude plugin uninstall` (Claude Code's plugin cache is
shared across profiles, so other profiles on this machine may still need the plugin cached)
and never removes the plugin's marketplace from `extraKnownMarketplaces`, even if it was the
last plugin referencing it. If the plugin isn't currently enabled in the profile, this is a
no-op that logs a warning rather than failing.

### `add-marketplace <spec>`

```bash
claude-profiles add-marketplace anthropics/claude-plugins
```

Registers a marketplace in the global registry, mirroring `/plugin marketplace add <spec>`: `<spec>` can be a GitHub `owner/repo` shorthand, a git URL, or a local path, with the type auto-detected and the name inferred (override with `--name`). Only the GitHub shorthand has a documented `settings.json` shape; for git/local sources, double-check the registered entry or pass `--source '<json>'` explicitly.

### `remove-marketplace <name>`

```bash
claude-profiles remove-marketplace official
```

The reciprocal of `add-marketplace`: unregisters a marketplace from the global registry. Idempotent — if the marketplace isn't registered, this logs a warning rather than failing. Only edits the global registry — it doesn't touch any profile's `extraKnownMarketplaces` (marketplaces already resolved onto a profile were copied as a snapshot, not a live reference) and doesn't touch Claude Code's own `known_marketplaces.json` cache. A future `install` that needs this marketplace and can't fall back to that cache will fail until it's registered again.

### `enable <profile...>`

```bash
claude-profiles enable backend-dev
claude-profiles enable backend-dev shared-tools --scope project --persist
claude-profiles enable backend-dev --persist=./config/team-profiles.list
claude-profiles enable backend-dev --scope project --only
```

Computes the union of enabled plugins and known marketplaces across the given profiles and writes it into the target scope:

- every plugin in the union is enabled; every other plugin already present in that scope's `settings.json` is disabled (its key is kept, never deleted — nothing else in the file is touched)
- marketplaces in the union are added if missing; existing entries are never removed or overwritten
- `--scope` defaults to `local`; `project`/`local` require a git repository — pass `--scope user` outside of one
- `--only` ensures only the given profiles' plugins end up active by also writing an explicit `false` — in the target scope's own file — for any plugin that's enabled in a broader scope but isn't part of the union just applied (`project` and `user` for `local`; just `user` for `project`; a no-op for `user`, which has no broader scope). The broader scope's file is only ever read, never written. The command output names which plugins were overridden and which scope they came from.
- `--persist[=<path>]` also writes the selected profile names, one per line, for later use by `reload`:
  - bare `--persist` writes to the default location, `.claude-profiles` at the repository root (or the current directory for `--scope user`, which has no repository root) — this matches where `settings.json` itself is resolved for that scope, so `reload` finds it from any subdirectory
  - `--persist=<path>` writes to `<path>` instead (relative paths resolve against the current directory, not the repository root) — pass the same path to `reload --file` later
  - the value must be given with `=` (`--persist=path`), not as a following argument (`--persist path`), since `enable` takes a variadic list of profile names and a space-separated value would be ambiguous with the next one

Afterward, it logs the plugins now enabled in the target scope. For `local`/`project` scopes, it logs a further paragraph per less-specific scope too (`project` and `user` for `local`; just `user` for `project`), so it's clear which plugin comes from which scope. Since Claude Code resolves `enabledPlugins` with `local` taking precedence over `project` over `user`, an entry from a less-specific scope is annotated `(overridden in <scope> scope)` when a more-specific scope explicitly disables it there.

### `disable <profile...>`

```bash
claude-profiles disable backend-dev --scope project
```

The reciprocal of `enable`: computes the union of enabled plugins across the given profiles and flips each one to `false` in the target scope's `settings.json`.

- only plugin keys already present in that scope's `settings.json` are touched — a plugin never enabled there has nothing to disable
- a touched key is kept and set to `false`, never deleted; marketplaces and every other setting in the file are untouched
- `--scope` defaults to `local`, same as `enable`
- a profile that enables no plugins is a no-op that logs a warning rather than failing

Afterward, it prints the same enabled-plugins report `enable` does.

### `disable-all`

```bash
claude-profiles disable-all --scope local
```

Disables every plugin key currently known to the target scope's `settings.json`, without needing a profile — the bulk equivalent of `disable`. Keys are kept and set to `false`, never deleted; marketplaces and every other setting in the file are untouched. `--scope` defaults to `local`. Afterward, it prints the same enabled-plugins report `enable` does.

### `reload`

```bash
claude-profiles reload --scope project
claude-profiles reload --file ./config/team-profiles.list
```

Re-applies a previously-persisted list of profile names — equivalent to running `enable` with that same list.

- by default, finds the nearest `.claude-profiles` file by walking up from the current directory to the repository root (requires a git repository, needed to bound the upward search)
- `--file <path>` reads the profile list from `<path>` directly instead, skipping the upward search entirely (no git repository required); relative paths resolve against the current directory

### `status`

```bash
claude-profiles status
claude-profiles status --scope project
```

Read-only audit of a scope's live `settings.json` against two independent sources of truth:

1. **Claude Code's own plugin cache** — prints the same enabled-plugins report `enable` does (including the less-specific-scope paragraphs and `(overridden in <scope> scope)` annotations), and additionally cross-checks every effectively-enabled plugin (one not overridden by a more-specific scope) against the cache, annotating it `(not cached by Claude Code — run ...)` when missing. This is the check `install`/`enable`/`reload` can't give you after the fact: their caching step is best-effort by design (a caching failure never blocks the settings write), so their own success output can't tell you whether it actually happened.

2. **The `.claude-profiles` file that applies to the target scope, if any** — found the same way `reload` finds it (walking up from the current directory to the repository root, scope-blind), falling back to checking the current directory directly only when no repository exists at all (the one case `reload` can't handle, since bare `enable --scope user --persist` writes there). Unlike `reload`, a missing file isn't an error — it just means there's nothing to compare against. When found, its listed profiles are resolved exactly like `enable`/`reload` would, and diffed against the target scope's own `settings.json`:
   - **Missing** — a listed profile wants a plugin enabled, but it isn't.
   - **Stale** — a plugin is enabled, but no listed profile declares it (explicit-`false` entries left by `enable --only` are never reported as stale, since they were never "enabled" to begin with).

Both checks always run and both report, independent of re-running `enable`/`reload`, and `status` writes nothing and runs no external commands. `--scope` defaults to `local`; `project`/`local` require a git repository, same as `enable`.

Exit code distinguishes "ran fine" from "found a problem" from "couldn't even check", so it's usable as a CI or pre-session gate, not just a log line to notice in the moment:

| Code | Meaning |
|------|---------|
| `0`  | clean: every effectively-enabled plugin is cached, and `settings.json` matches the listed profile(s) (if any) |
| `1`  | `status` itself couldn't run (bad `--scope`, no repo root, ...) |
| `2`  | it ran fine, but found a problem — uncached plugins, missing/stale plugins relative to the listed profiles, or the listed profiles couldn't be resolved — see the messages logged above |

## Example workflow

```bash
# One-time setup: define role-scoped profiles
claude-profiles create backend-dev
claude-profiles add-marketplace anthropics/claude-plugins
claude-profiles install typescript-lsp@claude-plugins --profile backend-dev
claude-profiles install context7@claude-plugins --profile backend-dev

claude-profiles create frontend-dev
claude-profiles install playwright@claude-plugins --profile frontend-dev

# Working in a repo as a backend dev today:
cd ~/projects/api-service
claude-profiles enable backend-dev --scope project --persist

# Later, in the same repo tree, after the profile's plugin list changed:
claude-profiles reload --scope project
```

## Development

```bash
npm run dev -- list          # runs against ./profiles instead of ~/.claude-profiles
npm run typecheck
npm run build
```

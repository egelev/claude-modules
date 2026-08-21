# Applying modules to a scope

`enable` · `disable` · `disable-all` · `reload`

These are the commands that write Claude Code's own `settings.json`. For which file each scope maps
to, see [Concepts → Scopes](concepts.md#scopes).

[← back to README](../README.md)

> **Changes apply to the *next* session.** Claude Code reads `enabledPlugins` at session start, so
> these commands have no effect on a session that's already open — which looks exactly like the
> command having done nothing. Run `/reload-plugins` in that session (add `--force` if it warns
> about the prompt cache), or start a new one.

---

## `enable`

```bash
claude-modules enable <module...> [--scope user|project|local] [--only] [--install] [--save[=<path>]] [--dry-run]
```

Computes the union of enabled plugins and known marketplaces across the given modules — resolving
each module's [composition](concepts.md#composition) transitively — and writes it into the target
scope.

```bash
claude-modules enable backend
claude-modules enable backend shared-tools --scope project --save
claude-modules enable backend --save=./config/team-modules.list
claude-modules enable backend --scope project --only
claude-modules enable backend --install
```

### Default (additive) behavior

- Every plugin in the union is enabled. **Every other plugin is left exactly as it was**, so a later
  `enable` for a different module *adds* to what's already active in that scope rather than
  replacing it.
- Marketplaces in the union are added if missing; existing entries are never removed or overwritten.
  A differing pre-existing source is warned about and kept.
- Every other setting in the file is untouched.

```
Enabled module(s) [backend] in project scope (/repo/.claude/settings.json); 1 marketplace(s) known.

Enabled plugin(s):
  - code-review@claude-plugins (project)
  - postgres-mcp@claude-plugins (project — not cached by Claude Code — run 'claude plugin install postgres-mcp@claude-plugins --scope user -y')
  - typescript-lsp@claude-plugins (project)

Plugin(s) not cached by Claude Code:
  claude plugin install postgres-mcp@claude-plugins --scope user -y

Run with --install to attempt these automatically, or install manually with the command(s) above.

Already running a Claude Code session? It won't pick this up on its own — run /reload-plugins in it (add --force if it warns about the prompt cache), or start a new session.

Saved module selection to /repo/.claude-modules.
Modules active in project scope: [backend].
```

(`code-review@claude-plugins` is there because `backend` composes `base`, which declares it.)

### The report

The `Enabled plugin(s):` block covers **every scope in effect here** — `local`, `project`, and
`user` inside a repository; `local` and `user` outside one — with each plugin tagged inline with its
scope, colour-coded. Since Claude Code resolves with `local > project > user`, an entry is annotated
`(<scope> — overridden by <scope>)` when a more-specific scope explicitly disables it.

The report always covers the whole chain, **whatever `--scope` you passed**, because that's what
decides which plugins a session actually loads. So `enable --scope user` run inside a repository
will also show what that repository's `local` scope contributes on top.

The `Modules active in <scope> scope:` line comes from the scope's saved list — freshly updated
first, if `--save` was given — or from just this run's module names, noted as not persisted, when no
list exists.

### Options

| Option | Default | Effect |
|---|---|---|
| `--scope user\|project\|local` | `local` | Which `settings.json` to write |
| `--only` | off | Make the scope *exactly* these modules instead of adding to it |
| `--install` | off | Attempt to add missing marketplaces and install missing plugins into Claude Code's caches |
| `--save[=<path>]` | off | Update the scope's saved module list for `reload` |
| `--dry-run` | off | Compute and print the full report, write nothing |

`project` requires a git repository — pass `--scope user` or `--scope local` outside of one. `local`
itself needs no repository: outside one it resolves against the current directory instead, and a
warning is printed so it's clear where it landed.

### `--only`

Makes the target scope *exactly* the given modules:

- every plugin **not** in the union is explicitly disabled in this scope's own file
- for `local` / `project`, any plugin enabled in a **broader** scope but not in the union is also
  disabled here (`project` and `user` for `local`; just `user` for `project`)

The broader scope's file is only ever **read, never written**. The output names which plugins were
overridden and which scope they came from. At `user` scope there is nothing broader to override, but
this scope's own plugins are still made exact.

This is the flag to reach for when you want an exclusive role switch.

### `--install`

Attempts, in order:

1. to add to Claude Code's `known_marketplaces.json` any union marketplace it doesn't know —
   one `claude plugin marketplace add <source> --scope user` per marketplace
2. to install into Claude Code's plugin cache any union plugin it hasn't cached — one
   `claude plugin install <plugin> --scope user -y` per plugin, attempted only when the plugin's
   marketplace is already known to Claude Code

Marketplaces are always attempted first, so a plugin from a marketplace added in the same run still
gets a chance to install. Scope is always `user` for both, since Claude Code's caches are shared
across scopes.

**Off by default**: a plain `enable` never shells out to `claude`; it only reports what's missing.

If a marketplace or plugin is still missing after the attempt, `enable` **exits with code 2** —
unless `--dry-run` was also given, in which case nothing was attempted and the exit code stays 0.

### `--save`

Updates the scope's saved module list, one name per line, for later use by
[`reload`](#reload). The selected modules are **merged** into whatever the list already had,
matching the additive default. (`--only --save` **replaces** the list instead, matching `--only`'s
exact-set semantics.)

- Bare `--save` writes to that scope's own list — see
  [the module-list table](concepts.md#module-lists). Saving at one scope never overwrites another's.
- `--save=<path>` writes to `<path>` instead; relative paths resolve against the current directory,
  not the repository root. A custom path is only ever read back with `reload --file <path>` — bare
  `reload` looks only at the per-scope locations and will not find it. The merge base is still read
  from the scope's canonical list, if one exists.
- **The value must be given with `=`** (`--save=path`), not as a following argument
  (`--save path`) — `enable` takes a variadic list of module names, so a space-separated value would
  be ambiguous with the next one.

---

## `disable`

```bash
claude-modules disable <module...> [--scope user|project|local] [--save] [--dry-run]
```

The reciprocal of `enable`: computes the union of enabled plugins across the given modules and flips
each one to `false` in the target scope.

```bash
claude-modules disable backend --scope project
claude-modules disable backend --save
```

- Only plugin keys **already present** in that scope's `settings.json` are touched — a plugin never
  enabled there has nothing to disable, and no phantom `false` is created.
- A touched key is kept and set to `false`, never deleted.
- Marketplaces and every other setting in the file are untouched.
- A module that enables no plugins is a no-op that logs a warning rather than failing.

`--save` removes the given modules from the scope's saved list, if one exists. A name not in the
list, or no list at all, is a no-op with a warning. Unlike `enable --save`, it always targets the
scope's own canonical list and **does not take a path** — `--save=<path>` is an explicit error.

Afterward it prints the same report `enable` does, plus the `Modules active in <scope> scope:` line.

---

## `disable-all`

```bash
claude-modules disable-all [--scope user|project|local] [--dry-run]
```

Disables every plugin key currently known to the target scope's `settings.json`, without needing a
module — the bulk equivalent of `disable`.

```bash
claude-modules disable-all --scope local
```

Keys are kept and set to `false`, never deleted. Marketplaces and every other setting are untouched.
Afterward it prints the same report `enable` does.

---

## `reload`

```bash
claude-modules reload [--scope user|project|local] [--file <path>] [--install] [--dry-run]
```

Re-applies a previously-saved list of module names — equivalent to running `enable` with that same
list.

```bash
claude-modules reload --scope project
claude-modules reload --file ./config/team-modules.list
claude-modules reload --install
```

- Reads the list belonging to `--scope` — exactly what `enable --scope <same> --save` wrote.
- Repo-scoped lists are found by walking up from the current directory to the repository root, so
  this works from any subdirectory. The user list has one fixed location and needs no repository.
  `local` outside a repository looks only at the current directory itself.
- **Each scope reads only its own file.** There is no cross-scope fallback, so a list is never
  applied at a scope it wasn't written for.
- `--file <path>` reads the list from `<path>` directly, skipping the search; relative paths resolve
  against the current directory.
- `--install` attempts the same best-effort caching [`enable --install`](#enable) does — same flag,
  same semantics, same exit-code-2 contract.

If a listed module no longer exists, the error names the specific list file the stale name came
from.

> **Behavior change.** `reload` used to attempt the caching step unconditionally, with no way to
> turn it off. It now defaults to **off** and only attempts it when `--install` is passed, for
> symmetry with `enable`. If you relied on `reload` silently re-caching plugins, add `--install`.

---

[← back to README](../README.md)

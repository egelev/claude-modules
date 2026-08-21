# Concepts

How `claude-modules` stores things, how scopes resolve, and how composition is computed.

[← back to README](../README.md)

---

## Modules

A module is a **directory** under `$CLAUDE_MODULES_HOME/modules/<name>/`. Today it holds a single
`settings.json`; whole directories are archived by [`export`](transfer.md#export) so this stays
correct as modules grow.

```
$CLAUDE_MODULES_HOME/           # ~/.claude-modules by default
├── settings.json               # the global marketplace registry (see below)
├── user.modules                # the user scope's module list
└── modules/
    ├── base/settings.json
    ├── backend/settings.json
    └── frontend/settings.json
```

A module's `settings.json` has exactly four fields:

```json
{
  "version": "1.2.0",
  "enabledPlugins": {
    "typescript-lsp@claude-plugins": true,
    "postgres-mcp@claude-plugins": true
  },
  "extraKnownMarketplaces": {
    "claude-plugins": {
      "source": { "source": "github", "repo": "anthropics/claude-plugins" }
    }
  },
  "composedModules": ["base"]
}
```

- **`enabledPlugins`** and **`extraKnownMarketplaces`** match the exact shape Claude Code itself
  uses in its `settings.json`, so a module is a portable slice of a real settings file.
- **`composedModules`** is this tool's own addition — see [Composition](#composition). It is
  **omitted from disk when empty**, and written last when present.
- **`version`** is this tool's own addition too, and is **advisory**: nothing compares, gates, or
  migrates on it. It is printed by [`list`](modules.md#list) and [`info`](modules.md#info) so you
  can tell two copies of a module apart. See [Versioning](#versioning).

Unknown keys are **not** preserved — the four fields above are reconstructed on every write, so a
hand-added fifth key is dropped the next time any command touches the module. (Claude Code's own
settings files are different: there, every unknown key is preserved untouched.)

Module names may not be empty and may not contain `/`, `\`, or `..`.

> **Two unrelated files are both called `settings.json`.** A *module's* `settings.json` uses the
> four-field schema above. The *registry's* `settings.json` at `$CLAUDE_MODULES_HOME/settings.json`
> uses `{"marketplaces": {...}}`. Claude Code's own `settings.json` is a third thing again. They
> share a filename and nothing else.

### `extraKnownMarketplaces` is double-nested

Note the repeated `source` key:

```json
"claude-plugins": { "source": { "source": "github", "repo": "anthropics/claude-plugins" } }
```

The outer wrapper is deliberate — it mirrors Claude Code's own entry shape, minus the
machine-specific `installLocation` and `lastUpdated` fields, which are stripped when a source is
copied out of Claude Code's cache.

Recognized source shapes:

| Shape | JSON |
|---|---|
| GitHub | `{"source": {"source": "github", "repo": "owner/repo"}}` |
| Git URL | `{"source": {"source": "git", "url": "https://..."}}` |
| Local path | `{"source": {"source": "local", "path": "/path/to/mp"}}` |

Anything else is treated as unrecognized, and therefore as **not portable** — `export` warns about
it. See [Marketplaces](marketplaces.md#marketplace-add) for the caveat on the git and local shapes.

---

## Scopes

`claude-modules` writes into the same three settings files Claude Code reads:

| Scope | File | Needs a git repo? |
|---|---|---|
| `user` | `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` if set | no |
| `project` | `<repo_root>/.claude/settings.json` | **yes** |
| `local` | `<repo_root>/.claude/settings.local.json`, or `<cwd>/.claude/settings.local.json` outside a repository | no |

`--scope` defaults to **`local`** everywhere it appears. The repository root is found by walking up
from the current directory looking for a `.git` entry — file or directory, so worktrees and
submodules both work.

Outside a repository, `local` falls back to the current directory and prints a warning saying where
it landed. `project` has no such fallback; it errors.

### Precedence

Claude Code resolves `enabledPlugins` with **`local` > `project` > `user`**. `claude-modules` models
the same order, which is why its reports annotate an entry `(<scope> — overridden by <scope>)` when
a more-specific scope explicitly disables it.

**Managed settings outrank all three** and can force a plugin on or off. That is invisible to this
tool — [`status --verify`](status.md#status) exists to catch it.

### What gets written

- Plugin keys are **never deleted** from a settings file, only flipped to `true` / `false`.
- Marketplaces are purely **additive** — existing entries are never removed or overwritten.
- Every other setting in the file (`permissions`, `theme`, ...) is left untouched, including keys
  this tool doesn't recognize.

---

## Composition

There are two different ways modules combine. Same word, two mechanisms.

### Ad-hoc union (CLI-time)

Name several modules on one call and they're unioned **for that call only**:

```bash
claude-modules enable backend frontend
```

Nothing is recorded. Do it again next time you want the same combination.

### Declared composition (persistent)

A module's own `composedModules` array names other modules it builds on. This is part of the module
itself, so every future `enable` / `disable` / `status` / `export` against it transitively pulls in
whatever those modules currently contribute:

```bash
claude-modules create fullstack --compose backend --compose frontend
claude-modules enable fullstack          # gets backend, frontend, and anything they compose
```

Set it at creation with `--compose`, or change it later with
[`compose add` / `compose remove`](compose.md).

### Resolution rules

- Children are resolved depth-first, then unioned as siblings.
- **A module's own declarations win** over anything it composes — both for `enabledPlugins` and for
  `extraKnownMarketplaces`.
- A composed child contributes only its **enabled** plugin keys. A child's `false` never propagates
  upward; but the *parent's* own `false` does survive, and suppresses a plugin the child enables.
  That is what [`plugin uninstall --disable`](plugins.md#plugin-uninstall) writes.
- **Cycles are rejected** — `Composition cycle detected: a -> b -> a.` A module cannot compose
  itself, directly or transitively.

### Marketplace conflicts behave two different ways

This distinction matters:

| Where | Behavior |
|---|---|
| Two sibling modules declare the same marketplace **name** with different sources | **Error.** The whole call is rejected before anything is written. |
| A module's marketplace differs from one already in the target `settings.json` | **Warning.** The existing value is kept and the write proceeds. |

The first protects you from an incoherent module set. The second refuses to clobber a settings file
you may have edited deliberately.

Plugin keys are never conflict-checked — the union is a plain OR.

### Validation timing

`create --compose` and `compose add` both fully resolve the *hypothetical* result before writing,
so a self-reference, a missing module, a cycle, or a sibling marketplace conflict rejects the call
atomically.

**Hand-edits are not validated when you make them.** Edit `composedModules` directly and a typo, a
cycle, or a conflict surfaces only on the *next* command that resolves the module.

### Known limit: overrides don't propagate past one level

`plugin uninstall --disable` beats a **directly** composed child's `true`. Resolve that module into
a grandparent's composition and the override evaporates — the grandparent sees no opinion either
way, not an explicit `false`.

Relatedly, two composed siblings that disagree on a plugin key resolve silently rather than
erroring the way a marketplace conflict does: the enabling sibling wins, without warning.

Neither case is common enough today to justify reworking composition's internal representation to
track a real enabled / disabled / unmentioned tri-state. If you build a deep composition tree that
depends on multi-level exclusion, know that it doesn't propagate past one level.

---

## Versioning

`version` is a semver string bumped automatically whenever a command changes what a module declares.

| Bump | Commands |
|---|---|
| **Patch** — the module gained something | `plugin install`, `marketplace add --module`, `compose add` |
| **Minor** (patch reset to `0`) — the module lost something | `plugin uninstall` (with or without `--disable`), `marketplace remove --module`, `compose remove` |
| **None** | `marketplace add` / `remove` without `--module` (global registry only); `export` / `import`; any no-op path that logs a warning |

- A new module always starts at `1.0.0` — `create`, with or without `--from-scope` / `--compose`,
  regardless of how much it's seeded with.
- Major is never bumped by the tool. There's no CLI command to set a version directly: hand-edit
  `version` and the next bump increments from whatever you set, so a hand-edited `2.0.0` becomes
  `2.0.1` after the next `plugin install`.
- An unparseable version silently falls back to `1.0.0` before bumping.

---

## The marketplace registry

`$CLAUDE_MODULES_HOME/settings.json` is a small global lookup of marketplace name → source:

```json
{
  "marketplaces": {
    "claude-plugins": {
      "source": { "source": "github", "repo": "anthropics/claude-plugins" }
    }
  }
}
```

It's populated by [`marketplace add`](marketplaces.md#marketplace-add) and consulted by
[`plugin install`](plugins.md#plugin-install), so you don't have to repeat `--source` every time.
Unknown top-level keys in this file **are** preserved.

Sources resolved out of the registry are **copied onto the module as a snapshot**, not referenced.
Later changes to the registry don't propagate.

---

## Module lists

An optional file — one module name per line — that remembers which modules you applied, so
[`reload`](applying.md#reload) can reapply them and [`status`](status.md#status) can tell you when a
scope has drifted. **One list per scope**, each living with the thing it describes:

| Scope | Module list | |
|---|---|---|
| `user` | `$CLAUDE_MODULES_HOME/user.modules` | global; not tied to any repository |
| `project` | `<repo_root>/.claude-modules` | shared with the team — **commit it** |
| `local` | `<repo_root>/.claude-modules.local`, or `<cwd>/.claude-modules.local` outside a repository | personal to your checkout — **gitignore it** |

Blank lines and `#` comments are ignored on read.

Repo-scoped lists sit at the repository root and are found by walking up from the current directory,
so `reload` works from any subdirectory. The user list has one fixed location, so
`reload --scope user` works anywhere, including outside a repository.

**Each scope reads only its own file.** There is no cross-scope fallback, so a list is never applied
at a scope it wasn't written for, and `enable --scope X --save`, `reload --scope X`, and
`status --scope X` always agree.

---

## Context budget

A secondary benefit, stated honestly.

Every enabled plugin adds tools Claude has to choose between on every turn, and Claude's own
documentation is explicit that this has a cost:

> "Tool selection accuracy degrades with more than 30-50 tools loaded at once."
> — [Claude Code docs: *Scale to many tools with tool search*](https://code.claude.com/docs/en/agent-sdk/tool-search)

Scoping your tools to the role you're currently performing is the fix, and modules make that
practical.

**The caveat:** Claude Code's MCP tool search — on by default — already defers MCP tool *schemas*
from context and loads them on demand. So the context-budget argument is weaker for MCP-heavy
plugins specifically than it is for skills, slash commands, subagent definitions, hooks, and LSP
servers, which tool search doesn't touch.

The reproducibility, composability, and drift-detection value of modules is unaffected either way —
which is why this README leads with those instead.

### No token-cost preview

`claude-modules` reports plugin *counts*, not tokens. Claude Code knows the number —
`claude plugin details <plugin>` prints a "Projected token cost" — but there's no way to aggregate
it per module yet: the command has no `--json` output, and it only resolves plugins that are already
*enabled*, so it can't cost a module you haven't applied. (Its error message suggests `--plugin-dir`
as a way around that; the flag isn't implemented on `details`.) Revisit when either lands upstream.

---

[← back to README](../README.md)

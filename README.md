# claude-modules

**Composable, portable plugin bundles for [Claude Code](https://claude.com/claude-code).**

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
<!-- Add once published: [![npm](https://img.shields.io/npm/v/claude-modules)](https://www.npmjs.com/package/claude-modules) -->

Claude Code enables plugins one at a time, per scope, across three separate `settings.json` files.
`claude-modules` lets you bundle them into named **modules** — `backend`, `frontend`, `fullstack` —
and switch between them with a single command.

```bash
claude-modules create backend --from-scope local                      # capture a setup you already have
claude-modules create fullstack --compose backend --compose frontend  # compose modules into bigger ones
claude-modules enable fullstack --scope project --save                # apply it, and remember you did
claude-modules export fullstack                                       # hand it to a teammate
```

Every module is:

- **Self-sufficient** — it carries its plugins *and* the marketplaces they come from, so it works on
  a machine that's never seen them.
- **Composable** — `fullstack` = `backend` + `frontend`, declared once and resolved every time, not
  retyped.
- **Reusable** — the same module applies to any repo, at any scope.
- **Transferable** — `export` packs a module and its whole composition chain into one `.tar.gz`;
  `import` unpacks it on another machine.

---

## Why not just use `/plugin`?

|  | Claude Code `/plugin` | `claude-modules` |
|---|---|---|
| Unit of work | one plugin at a time | a named bundle of plugins |
| Grouping | none — `enabledPlugins` is a flat map | modules, which compose into bigger modules |
| Reuse across repos | re-enable each plugin, per repo | `enable backend` |
| Another machine | re-add marketplaces, re-enable plugins | `export` → `import`, one file |
| Switching roles | hand-edit up to three `settings.json` files | `enable backend --only` |
| Auditing what's on | read three files and apply precedence in your head | `status` — exit-coded, `--json` |
| Sharing with a team | commit `.claude/settings.json` wholesale | commit `.claude-modules`, then `reload` |

There's a secondary benefit too: every enabled plugin adds tools Claude has to choose between on
every turn, and [Claude's own docs](https://code.claude.com/docs/en/agent-sdk/tool-search) note that
tool-selection accuracy degrades past 30–50 loaded tools. Scoping your tools to the role you're
currently performing helps — though the picture is more nuanced for MCP-heavy plugins, and
[the caveat is spelled out in the docs](docs/concepts.md#context-budget) rather than glossed here.

---

## Installation

> **Not yet published to npm.** The command below is a placeholder.

```bash
npm install -g claude-modules
```

From source, today:

```bash
git clone https://github.com/egelev/claude-modules.git
cd claude-modules
npm install
npm run build
npm link          # puts `claude-modules` on your PATH
```

### Configuration

| Variable | Default | What it points at |
|---|---|---|
| `CLAUDE_MODULES_HOME` | `~/.claude-modules` | Where your modules and the marketplace registry live |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code's own home — read for the `user` scope and its plugin caches |

---

## Quick start

Start from a repo you've already configured by hand, or through `/plugin`:

```bash
cd ~/projects/api-service
claude-modules create backend --from-scope local
```

```
Created module 'backend' from local scope (/repo/.claude/settings.local.json) with 3 plugin(s), 1 marketplace(s), and 0 composed module(s).
```

That captured what was already enabled there. Check it:

```bash
claude-modules list
claude-modules info backend
```

```
backend (v1.0.0) — 3 plugin(s) enabled, 1 marketplace(s)
```

```
backend (v1.0.0): 3 plugin(s):
  typescript-lsp@claude-plugins (enabled)
  postgres-mcp@claude-plugins (enabled)
  code-review@claude-plugins (enabled)

backend: 1 marketplace(s):
  claude-plugins: {"source":{"source":"github","repo":"anthropics/claude-plugins"}}
```

Now apply it — here to `project` scope, so it's shared with the team, and `--save` so you don't have
to retype it:

```bash
claude-modules enable backend --scope project --save
```

```
Enabled module(s) [backend] in project scope (/repo/.claude/settings.json); 1 marketplace(s) known.

Enabled plugin(s):
  - code-review@claude-plugins (local)
  - postgres-mcp@claude-plugins (local — not cached by Claude Code — run 'claude plugin install postgres-mcp@claude-plugins --scope user -y')
  - typescript-lsp@claude-plugins (local)
  - code-review@claude-plugins (project)
  - postgres-mcp@claude-plugins (project — not cached by Claude Code — run 'claude plugin install postgres-mcp@claude-plugins --scope user -y')
  - typescript-lsp@claude-plugins (project)

Saved module selection to /repo/.claude-modules.
Modules active in project scope: [backend].
```

Two things worth noticing. The report covers **every scope in effect**, not just the one you wrote —
these plugins are listed twice because they're still enabled in `local` too, where they started.
And `postgres-mcp` is flagged as not cached by Claude Code: enabling a plugin isn't enough on its
own, so `claude-modules` tells you, and `--install` fixes it.

From here, `claude-modules status` audits the result at any time, and exits non-zero if something
has drifted — see [the docs](docs/status.md#status).

> **Changes apply to the *next* session.** Claude Code reads `enabledPlugins` at session start, so
> these commands have no effect on a session that's already open — which looks exactly like the
> command having done nothing. Run `/reload-plugins` in that session (add `--force` if it warns
> about the prompt cache), or start a new one. Every command that changes what's enabled reminds you
> of this in its output.

---

## How it works

A **module** is a directory under `$CLAUDE_MODULES_HOME/modules/<name>/` holding a `settings.json`:

```json
{
  "version": "1.2.0",
  "enabledPlugins": { "typescript-lsp@claude-plugins": true },
  "extraKnownMarketplaces": {
    "claude-plugins": { "source": { "source": "github", "repo": "anthropics/claude-plugins" } }
  },
  "composedModules": ["base"]
}
```

`enabledPlugins` and `extraKnownMarketplaces` match the exact shape Claude Code itself uses.
`composedModules` and `version` are this tool's own additions.

**Scopes** are the same three Claude Code uses, resolved with `local > project > user`:

| Scope | File | Needs a git repo? |
|---|---|---|
| `user` | `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) | no |
| `project` | `<repo_root>/.claude/settings.json` | **yes** |
| `local` | `<repo_root>/.claude/settings.local.json`, or `<cwd>/...` outside a repo | no |

`--scope` defaults to `local`.

**Modules combine two ways.** Naming several on one call (`enable backend frontend`) unions them for
that call only. Declaring `composedModules` makes the relationship part of the module itself, pulled
in transitively by every future command. Both are covered in
[Concepts → Composition](docs/concepts.md#composition).

**Module lists** remember which modules you applied, so `reload` can reapply them and `status` can
detect drift. One per scope:

| Scope | Module list | |
|---|---|---|
| `user` | `$CLAUDE_MODULES_HOME/user.modules` | global |
| `project` | `<repo_root>/.claude-modules` | **commit it** — shared with the team |
| `local` | `<repo_root>/.claude-modules.local` | **gitignore it** — personal to your checkout |

---

## Commands

| Command | What it does | |
|---|---|---|
| `list` | List every module with its plugin and marketplace counts | [docs](docs/modules.md#list) |
| `info <module>` | Show one module's plugins, marketplaces, and composition | [docs](docs/modules.md#info) |
| `create <module>` | Create a module — empty, seeded from a scope, or composing others | [docs](docs/modules.md#create) |
| `remove <module>` | Delete a module | [docs](docs/modules.md#remove) |
| `compose add <module> <composed...>` | Make a module build on others | [docs](docs/compose.md#compose-add) |
| `compose remove <module> <composed...>` | Stop building on others | [docs](docs/compose.md#compose-remove) |
| `plugin install <module> <plugin>@<mp>` | Enable a plugin inside a module | [docs](docs/plugins.md#plugin-install) |
| `plugin uninstall <module> <plugin>@<mp>` | Disable a plugin inside a module | [docs](docs/plugins.md#plugin-uninstall) |
| `marketplace add <spec>` | Register a marketplace, globally or on a module | [docs](docs/marketplaces.md#marketplace-add) |
| `marketplace remove <name>` | Unregister a marketplace | [docs](docs/marketplaces.md#marketplace-remove) |
| `marketplace list` | List registered marketplaces | [docs](docs/marketplaces.md#marketplace-list) |
| `enable <module...>` | Apply modules to a scope | [docs](docs/applying.md#enable) |
| `disable <module...>` | Turn a scope's copy of those plugins off | [docs](docs/applying.md#disable) |
| `disable-all` | Turn every plugin in a scope off | [docs](docs/applying.md#disable-all) |
| `reload` | Re-apply a scope's saved module list | [docs](docs/applying.md#reload) |
| `status` | Audit a scope; exit-coded for CI | [docs](docs/status.md#status) |
| `export <module>` | Pack a module and its composition chain into a `.tar.gz` | [docs](docs/transfer.md#export) |
| `import <archive>` | Unpack one on another machine | [docs](docs/transfer.md#import) |

### Global options

| Flag | Effect |
|---|---|
| `-h`, `--help` | Show help. Works after any command: `claude-modules plugin install --help` |
| `-v`, `--version` | Print the installed version |
| `--verbose` | Enable debug logging |
| `--dry-run` | Preview a mutating command's effect — writes nothing, runs no external commands |

`--dry-run` is supported by all 14 mutating commands, and is a no-op on the four that never write
(`list`, `info`, `status`, `marketplace list`). Running a bare group name — `claude-modules plugin`,
`marketplace`, or `compose` — prints that group's usage.

---

## Example workflow

```bash
# Working in a repo as a backend dev today
claude-modules enable backend --scope project --save

# Full-stack repo? Ad-hoc union — name several modules on one call
cd ~/projects/web-app
claude-modules enable backend frontend shared-tools --save

# Want that combination to be permanent instead of retyped? Declare it once
claude-modules create fullstack --compose backend --compose frontend --compose shared-tools
claude-modules enable fullstack --save     # transitively pulls in all three, every time

# Later, after a module's plugin list changed
claude-modules reload --scope project
```

Modules don't have to be tied to a repository. A set of plugins you switch *into* — a weekend
research mode, say — lives at `user` scope. Plain `enable` **adds** to whatever's already active, so
an exclusive switch reaches for `--only`:

```bash
claude-modules enable investing --scope user --only --save
claude-modules enable backend --scope user --only          # Monday: investing plugins go quiet
```

Drop `--only` and the same command layers instead of switching — the right call when you're stacking
capabilities rather than trading between them.

---

## Known limitations

- **No token-cost preview.** Modules report plugin *counts*, not tokens. Claude Code knows the
  number but offers no way to aggregate it per module yet. → [details](docs/concepts.md#no-token-cost-preview)
- **No version pinning.** A module records which plugins to enable, not which versions. Treat
  modules as portable role definitions, not lockfiles. → [details](docs/transfer.md#plugin-versions)
- **Marketplace sources are snapshots.** Resolved sources are copied onto the module; later registry
  changes don't propagate. → [details](docs/transfer.md#non-portable-marketplace-sources)
- **Plugin configuration isn't captured.** Per-plugin `userConfig` is deliberately excluded so a
  committed module can't become a secret-exfiltration path. → [details](docs/transfer.md#per-plugin-configuration)
- **Composition overrides stop after one level.** An explicit `false` beats a directly composed
  child, but not a grandchild. → [details](docs/compose.md#the-one-level-override-limit)

---

## Development

```bash
npm run dev -- list          # runs against ./modules instead of ~/.claude-modules
npm run typecheck            # src/ and test/ both
npm test                     # vitest
npm run build
```

Tests drive the real `Cli` against throwaway temp directories, with both `CLAUDE_MODULES_HOME` and
`CLAUDE_CONFIG_DIR` redirected there — nothing in the suite can reach your real `~/.claude`. See
[`test/helpers/harness.ts`](test/helpers/harness.ts).

Note that `npm run typecheck` runs `tsc` twice: once for the build config (`src/` only, matching what
ships) and once for `tsconfig.test.json`, which adds `test/`. Without the second pass, tests keep
running against stale types — vitest strips types with esbuild and never checks them.

---

## License

[MIT](LICENSE) © Emil Gelev

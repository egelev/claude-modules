# claude-modules

**Composable, portable plugin bundles for [Claude Code](https://claude.com/claude-code).**

[![npm](https://img.shields.io/npm/v/claude-modules)](https://www.npmjs.com/package/claude-modules)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Every module is:

- **Self-sufficient** — it carries its plugins _and_ the marketplaces they come from, so it works on
  a machine that's never seen them.
- **Composable** — `fullstack` = `backend` + `frontend`, declared once and resolved every time, not
  retyped.
- **Reusable** — the same module applies to any repo, at any scope.
- **Transferable** — `export` packs a module and its whole composition chain into one `.tar.gz`;
  `import` unpacks it on another machine.

---

## Example workflow

Claude Code enables plugins one at a time, per scope, across three separate `settings.json` files.
`claude-modules` lets you bundle them into named modules and switch between them with a single
command. Build modules plugin by plugin, then compose them into the role you actually switch into:

```bash
# A base layer every stack builds on
claude-modules create base-dev
claude-modules plugin install base-dev context7@claude-plugins-official
claude-modules plugin install base-dev code-simplifier@claude-plugins-official

# A Quarkus-specific module
claude-modules create quarkus
claude-modules plugin install quarkus jdtls-lsp@claude-plugins-official
claude-modules plugin install quarkus quarkus-agent@claude-plugins-official

# A frontend-specific module
claude-modules create fe
claude-modules plugin install fe modern-web-guidance@claude-plugins-official
claude-modules plugin install fe playwright@claude-plugins-official
claude-modules plugin install fe typescript-lsp@claude-plugins-official
claude-modules plugin install fe frontend-design@claude-plugins-official

# Compose them into one role, declared once
claude-modules create full-dev --compose base-dev --compose quarkus --compose fe
claude-modules enable full-dev --scope project --save   # transitively pulls in all three, every time
```

> **Already have a repo configured the way you like** — by hand, or through `/plugin`? `create
<module> --from-scope <scope>` captures it in one shot instead of typing every `plugin install`.
> See [Quick start](#quick-start) below.

Don't need `full-dev` as a permanent unit? Name the modules directly on one `enable` call instead —
that's an ad-hoc union, good for one-off combinations you won't reuse:

```bash
claude-modules enable base-dev quarkus fe --save
```

And when you're switching roles rather than layering on top of what's active, add `--only` to make
the scope _exactly_ the given modules instead of adding to it:

```bash
claude-modules enable full-dev --scope user --only --save
claude-modules enable base-dev --scope user --only          # Monday: quarkus/fe plugins go quiet
```

Later, after a module's plugin list changes: `claude-modules reload --scope project`.

Modules aren't limited to coding roles, either — anything you switch _into_ works the same way.
Register the marketplace it needs, build the module, and enable it exclusively so it's the only
thing active, unrelated dev modules included:

```bash
claude-modules marketplace add anthropics/financial-services-plugins --name claude-for-financial-services

claude-modules create investing
claude-modules plugin install investing wealth-management@claude-for-financial-services
claude-modules plugin install investing private-equity@claude-for-financial-services
claude-modules plugin install investing investment-banking@claude-for-financial-services

claude-modules enable investing --scope user --only --save   # only investing is active now
```

---

## Why not just use `/plugin`?

|                     | Claude Code `/plugin`                              | `claude-modules`                           |
| ------------------- | -------------------------------------------------- | ------------------------------------------ |
| Unit of work        | one plugin at a time                               | a named bundle of plugins                  |
| Grouping            | none — `enabledPlugins` is a flat map              | modules, which compose into bigger modules |
| Reuse across repos  | re-enable each plugin, per repo                    | `enable backend`                           |
| Another machine     | re-add marketplaces, re-enable plugins             | `export` → `import`, one file              |
| Switching roles     | hand-edit up to three `settings.json` files        | `enable backend --only`                    |
| Auditing what's on  | read three files and apply precedence in your head | `status` — exit-coded, `--json`            |
| Sharing with a team | commit `.claude/settings.json` wholesale           | commit `.claude-modules`, then `reload`    |

There's a secondary benefit too: every enabled plugin adds tools Claude has to choose between on
every turn, and [Claude's own docs](https://code.claude.com/docs/en/agent-sdk/tool-search) note that
tool-selection accuracy degrades past 30–50 loaded tools. Scoping your tools to the role you're
currently performing helps — though the picture is more nuanced for MCP-heavy plugins, and
[the caveat is spelled out in the docs](docs/concepts.md#context-budget) rather than glossed here.

---

## Installation

```bash
npm install -g claude-modules      # global CLI
```

Or run it without installing:

```bash
npx claude-modules --help
```

From source:

```bash
git clone https://github.com/egelev/claude-modules.git
cd claude-modules
npm install
npm run build
npm link          # puts `claude-modules` on your PATH
```

### Configuration

| Variable              | Default             | What it points at                                                        |
| --------------------- | ------------------- | ------------------------------------------------------------------------ |
| `CLAUDE_MODULES_HOME` | `~/.claude-modules` | Where your modules and the marketplace registry live                     |
| `CLAUDE_CONFIG_DIR`   | `~/.claude`         | Claude Code's own home — read for the `user` scope and its plugin caches |

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

> **Changes apply to the _next_ session.** Claude Code reads `enabledPlugins` at session start, so
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

| Scope     | File                                                                     | Needs a git repo? |
| --------- | ------------------------------------------------------------------------ | ----------------- |
| `user`    | `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`)        | no                |
| `project` | `<repo_root>/.claude/settings.json`                                      | **yes**           |
| `local`   | `<repo_root>/.claude/settings.local.json`, or `<cwd>/...` outside a repo | no                |

`--scope` defaults to `local`.

**Modules combine two ways.** Naming several on one call (`enable backend frontend`) unions them for
that call only. Declaring `composedModules` makes the relationship part of the module itself, pulled
in transitively by every future command. Both are covered in
[Concepts → Composition](docs/concepts.md#composition).

**Module lists** remember which modules you applied, so `reload` can reapply them and `status` can
detect drift. One per scope:

| Scope     | Module list                         |                                              |
| --------- | ----------------------------------- | -------------------------------------------- |
| `user`    | `$CLAUDE_MODULES_HOME/user.modules` | global                                       |
| `project` | `<repo_root>/.claude-modules`       | **commit it** — shared with the team         |
| `local`   | `<repo_root>/.claude-modules.local` | **gitignore it** — personal to your checkout |

---

## Commands

| Command                                   | What it does                                                       |                                                  |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------ |
| `list`                                    | List every module with its plugin and marketplace counts           | [docs](docs/modules.md#list)                    |
| `info <module>`                           | Show one module's plugins, marketplaces, and composition           | [docs](docs/modules.md#info)                    |
| `create <module>`                         | Create a module — empty, seeded from a scope, or composing others  | [docs](docs/modules.md#create)                  |
| `remove <module>`                         | Delete a module                                                    | [docs](docs/modules.md#remove)                  |
| `compose add <module> <composed...>`      | Make a module build on others                                      | [docs](docs/compose.md#compose-add)             |
| `compose remove <module> <composed...>`   | Stop building on others                                            | [docs](docs/compose.md#compose-remove)          |
| `plugin install <module> <plugin>@<mp>`   | Enable a plugin inside a module                                    | [docs](docs/plugins.md#plugin-install)          |
| `plugin uninstall <module> <plugin>@<mp>` | Disable a plugin inside a module                                   | [docs](docs/plugins.md#plugin-uninstall)        |
| `marketplace add <spec>`                  | Register a marketplace, globally or on a module                    | [docs](docs/marketplaces.md#marketplace-add)    |
| `marketplace remove <name>`               | Unregister a marketplace                                           | [docs](docs/marketplaces.md#marketplace-remove) |
| `marketplace list`                        | List registered marketplaces                                       | [docs](docs/marketplaces.md#marketplace-list)   |
| `enable <module...>`                      | Apply modules to a scope                                           | [docs](docs/applying.md#enable)                 |
| `disable <module...>`                     | Turn a scope's copy of those plugins off                           | [docs](docs/applying.md#disable)                |
| `disable-all`                             | Turn every plugin in a scope off                                   | [docs](docs/applying.md#disable-all)            |
| `reload`                                  | Re-apply a scope's saved module list                               | [docs](docs/applying.md#reload)                 |
| `update [module...]`                      | Update modules' marketplaces then plugins to their latest versions | [docs](docs/applying.md#update)                 |
| `status`                                  | Audit a scope; exit-coded for CI                                   | [docs](docs/status.md#status)                   |
| `export <module>`                         | Pack a module and its composition chain into a `.tar.gz`           | [docs](docs/transfer.md#export)                 |
| `import <archive>`                        | Unpack one on another machine                                      | [docs](docs/transfer.md#import)                 |
| `completions <bash\|zsh>`                  | Print a tab-completion script for your shell                       | [docs](docs/completions.md#completions)          |

### Global options

| Flag              | Effect                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| `-h`, `--help`    | Show help. Works after any command: `claude-modules plugin install --help`      |
| `-v`, `--version` | Print the installed version                                                     |
| `--verbose`       | Enable debug logging                                                            |
| `--dry-run`       | Preview a mutating command's effect — writes nothing, runs no external commands |

`--dry-run` is supported by all 15 mutating commands, and is a no-op on the five that never write
(`list`, `info`, `status`, `marketplace list`, `completions`). Running a bare group name —
`claude-modules plugin`, `marketplace`, or `compose` — prints that group's usage.

---

## Known limitations

- **No token-cost preview.** Modules report plugin _counts_, not tokens. Claude Code knows the
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

## Releasing

Publishing to npm is deliberate and separate from merging. `.github/workflows/ci.yml` runs on every
PR and push to `main` (typecheck + tests on Node 20/22/24, then a pack-and-install smoke test);
`.github/workflows/release.yml` runs **only when a GitHub Release is published** and does the npm
publish. Merging to `main` never publishes anything.

### Cutting a release

1. **Bump the version in a PR.** Edit `version` in `package.json` following
   [semver](https://semver.org/) — `npm version --no-git-tag-version <patch|minor|major>` does it —
   and merge once CI is green. Nothing publishes yet.
2. **Draft the Release.** Repo **Releases → Draft a new release**:
   - **Choose a tag** → type a new tag `vX.Y.Z` matching the version you just merged (the leading
     `v` is expected; the workflow strips it) → **Create new tag on publish**.
   - **Target**: `main`.
   - **Generate release notes** to populate the body from merged PRs.
   - For a prerelease (`vX.Y.Z-rc.1`, etc.), tick **Set as a pre-release**.
3. **Publish release.** This triggers `release.yml`, which fails fast unless the tag matches
   `package.json`, then re-runs the full suite, packs and smoke-tests the tarball, publishes to npm
   via OIDC, and attaches the `.tgz` to the Release. A normal release goes to the `latest` dist-tag;
   a prerelease goes to `next`, so `npm install -g claude-modules` never picks it up.
4. **Approve and verify.** If the `release` environment requires a reviewer, approve the run in the
   **Actions** tab. Then confirm the new version and its provenance badge on
   [npmjs.com](https://www.npmjs.com/package/claude-modules) (`npm audit signatures` after
   installing also verifies it).

---

## License

[MIT](LICENSE) © Emil Gelev

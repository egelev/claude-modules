# Marketplaces

`marketplace add` · `marketplace remove` · `marketplace list`

Marketplaces live in two places: the **global registry** at `$CLAUDE_MODULES_HOME/settings.json`,
and each module's own `extraKnownMarketplaces`. Every command here targets the global registry by
default, and a module instead when given `--module`.

[← back to README](../README.md) · [Concepts](concepts.md#the-marketplace-registry)

Running `claude-modules marketplace` with no subcommand prints this group's usage.

---

## `marketplace add`

```bash
claude-modules marketplace add <spec> [--name <name>] [--source '<json>'] [--module <module>] [--dry-run]
```

Registers a marketplace, mirroring `/plugin marketplace add <spec>`, so
[`plugin install`](plugins.md#plugin-install) can resolve it without repeating `--source`.

```bash
claude-modules marketplace add anthropics/claude-plugins
claude-modules marketplace add anthropics/claude-plugins --name official
claude-modules marketplace add anthropics/claude-plugins --module backend
```

| Option | Default | Effect |
|---|---|---|
| `--name <name>` | inferred from the spec | Override the marketplace name |
| `--source '<json>'` | auto-detected | Skip detection; store this source verbatim |
| `--module <module>` | the global registry | Register onto this module instead |
| `--dry-run` | off | Resolve and report, write nothing |

With `--module`, bumps that module's **patch** version. Without it, only the global registry
changes and no module's version is touched.

### Spec detection

| Spec form | Detected as |
|---|---|
| `owner/repo` | GitHub shorthand |
| `owner/repo@v2.0` | GitHub shorthand pinned to a branch/tag — the name is still inferred from `owner/repo` alone |
| `https://...` or `git@...` | git URL (pin with a trailing `#ref`) |
| anything else | local path |

A local path ending in `marketplace.json` infers its name from the parent directory; a trailing `/`
or `.git` is stripped.

**`owner/repo#ref` is an error**, not a silent misparse — GitHub shorthand doesn't support `#ref`
pinning. The message steers you to `owner/repo@ref` or the full git URL.

> **Caveat.** Only the GitHub shorthand has a documented `settings.json` representation. The git-URL
> and local-path shapes this tool writes are **unverified against real Claude Code output**. Check
> the registered entry with [`marketplace list`](#marketplace-list), or bypass detection entirely
> with `--source '<json>'`.

---

## `marketplace remove`

```bash
claude-modules marketplace remove <name> [--module <module>] [--dry-run]
```

The reciprocal of `marketplace add`.

```bash
claude-modules marketplace remove official
claude-modules marketplace remove official --module backend
```

Idempotent — if the marketplace isn't registered on the selected target, this logs a warning rather
than failing.

**Without `--module`**, it only edits the global registry. It does not touch any module's
`extraKnownMarketplaces` (those were copied as a snapshot, not a live reference) and does not touch
Claude Code's own `known_marketplaces.json`. A future `plugin install` that needs this marketplace
and can't fall back to Claude Code's cache will fail until it's registered again.

**With `--module`**, it only edits that module's own map. If the module *inherited* the marketplace
from a composed module, it isn't in the module's own map, so this reports it as not registered
rather than reaching into the composed module.

Version: `--module` bumps that module's **minor** version on a successful removal. The idempotent
no-op path bumps nothing, and neither does the global-registry-only form.

---

## `marketplace list`

```bash
claude-modules marketplace list [--module <module>]
```

Lists registered marketplaces — the global registry by default, or a single module's own
`extraKnownMarketplaces` with `--module`. Each line shows the name and its raw source JSON.

```
claude-plugins: {"source":{"source":"github","repo":"anthropics/claude-plugins"}}
```

Like the other `--module` forms, this shows the module's **own** map, not marketplaces it inherits
from a composed module.

This command never writes.

---

[← back to README](../README.md)

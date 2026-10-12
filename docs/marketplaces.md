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

### Syncing to Claude Code

If the marketplace isn't already known to Claude Code
(`$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json`), this also runs `claude plugin marketplace
add <spec> --scope user` on your behalf — the same best-effort cache-warming
[`plugin install`](plugins.md#cache-warming) already does for plugins. A freshly-added marketplace
is logged explicitly; a failure (no `claude` on `PATH`, no network) is a **warning, not a hard
error** — the registry write above still succeeds either way.

Some sources have no `claude plugin marketplace add` form at all: an inline `settings` source, a
`github` or `git` source with a custom `path`, and a `url` source with request headers. Claude Code
registers these itself from `settings.json` at the next session start, so nothing is run for them —
an info line says so, and [`enable`](applying.md#enable) writes the entry where Claude Code will
find it. See the README's
[practical use cases](../README.md#a-marketplace-in-a-repository-subdirectory) for a worked example.

### Spec detection

Each spec is stored as the source object Claude Code's own `claude plugin marketplace add` would
store for it (checked against Claude Code 2.1.295), so the entry `enable` writes is one Claude Code
can load:

| Spec | Stored source |
|---|---|
| `owner/repo` | `{"source": "github", "repo": "owner/repo"}` |
| `owner/repo@v2.0` or `owner/repo#v2.0` | `{"source": "github", "repo": "owner/repo", "ref": "v2.0"}` |
| `https://host/mp.git#main` (or a URL containing `/_git/`) | `{"source": "git", "url": "https://host/mp.git", "ref": "main"}` |
| `https://github.com/owner/repo`, `https://gitlab.com/group/project` | `git`, with `.git` appended to the URL |
| any other `https://…` URL | `{"source": "url", "url": "…"}` — a hosted `marketplace.json` |
| `git@host:team/mp.git#main` | `{"source": "git", "url": "git@host:team/mp.git", "ref": "main"}` |
| `./dir`, `../dir`, `/dir`, `~/dir` | `{"source": "directory", "path": "<absolute path>"}` |
| a path to a `.json` file | `{"source": "file", "path": "<absolute path>"}` |
| anything else | treated as a path relative to the current directory, as above |

The name is inferred from the repository or the last path segment (from the parent directory for a
`marketplace.json`), without the ref or a trailing `/` or `.git`.

Paths are resolved to absolute, with `~` expanded. Claude Code resolves a relative `path` against
whichever project a session starts in, so a relative one would point somewhere different in every
repo. An existing path is checked the way Claude Code checks it: a directory, or a `.json` file. Any
other file is refused. A path that doesn't exist yet is a warning, not an error.

Anything the spec can't express, such as a `path` inside a repo or `sparsePaths`, goes in
`--source '<json>'`.

> Sources stored by older versions of `claude-modules` — `{"source": "local"}`, or a ref kept inside
> `repo` or `url` — are upgraded to these shapes when they're read, and `enable` replaces an old copy
> of one in a scope's `settings.json`.

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

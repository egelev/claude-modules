# Moving modules between machines

`export` · `import`

[← back to README](../README.md) · [Concepts](concepts.md)

---

## `export`

```bash
claude-modules export <module> [--output <path>] [--dry-run]
```

Packages a module's directory — **and the directory of every module it transitively composes** —
into a single `.tar.gz`, so the whole composition chain travels together and works out of the box
after `import` on another machine.

```bash
claude-modules export backend
claude-modules export fullstack --output ~/backups/fullstack.tar.gz
```

Without `--output`, the archive is written to `<module>-<YYYY-MM-DD>.tar.gz` in the current
directory, date-stamped in local time.

```
[dry-run] Would export module 'fullstack' and 3 composed module(s) (backend, base, frontend) to '/repo/fullstack-2026-08-21.tar.gz'.
```

Note that the composed set is the **full transitive closure** — `fullstack` composes only `backend`
and `frontend`, but `base` comes along because both of those compose it.

A composition cycle among the modules being archived is rejected before anything is written.

If any archived module has a marketplace with a non-`github` source, a warning is logged — same as
`create --from-scope` and `plugin install` — since that marketplace won't mean anything on another
machine.

`export` does not bump any version: transferring a module isn't changing it.

### Archive format

```
manifest.json
modules/<root>/settings.json
modules/<composed>/settings.json
...
```

The `modules/` tree mirrors `$CLAUDE_MODULES_HOME/modules/` — one directory per module, whatever it
contains. `manifest.json` records which module is the root and which are composed:

```json
{
  "version": 1,
  "rootModule": "fullstack",
  "composedModules": ["backend", "base", "frontend"],
  "exportedAt": "2026-08-21T12:00:00.000Z"
}
```

That manifest is what lets `import --name` / `--composed-prefix` rename modules on the way in
without losing track of which directory is which. It's an implementation detail, not something you
need to read or edit. An archive with a different manifest `version` is rejected with a message
telling you to upgrade `claude-modules`.

---

## `import`

```bash
claude-modules import <archive> [--name <name>] [--composed-prefix <prefix>] [--dry-run]
```

Unpacks a module — and its composed modules — from an `export` archive. The reciprocal of `export`.

```bash
claude-modules import backend-2026-08-21.tar.gz
claude-modules import backend-2026-08-21.tar.gz --name backend-imported
claude-modules import backend-2026-08-21.tar.gz --composed-prefix teammate-
```

The root module is named from `--name` if given, otherwise from the name it was exported under.

Composed modules keep their original names unless `--composed-prefix` is given, in which case
**every** composed module — at every level of the composition tree, not just the root's immediate
children — is renamed with that prefix, and every module's `composedModules` references are
rewritten to match, so composition keeps working after the rename.

### Collisions

If any module being imported — root or composed — would collide with a module that already exists on
this machine, **nothing is written**. The error lists every collision, and for each recommends
either renaming the existing module, or re-running with `--name` (for a root collision) or
`--composed-prefix` (for a composed-module collision).

`--name` / `--composed-prefix` are also rejected up front if they'd land two imported modules on the
same final name.

`--dry-run` validates the archive and checks for collisions entirely in memory, writing nothing at
all.

### After the write

Modules are written leaves-first, root last, so a crash mid-import leaves the result reading as
*failed* rather than as a broken visible root.

Post-write, composition is re-resolved. If the imported composition doesn't resolve — say two
composed modules were hand-edited to declare the same marketplace differently — the import still
**succeeds with a warning** rather than being rolled back.

`import` carries each module's `version` through unchanged.

---

## What a module deliberately does *not* carry

### Per-plugin configuration

Claude Code's per-plugin `userConfig` — set via `claude plugin install --config` or
`/plugin configure`, and where an MCP server's API key or endpoint typically lives — is **not**
captured by `create --from-scope`, `export`, or `import`.

This is deliberate, not an oversight. A module is designed to be shared and committed (the
`project`-scope module list is meant to go into version control), and capturing `userConfig` by
default would turn that into an accidental secret-exfiltration path.

A plugin that needs configuration to function arrives enabled but **unconfigured** after any of the
above. Configure it separately with Claude Code's own tooling.

### Plugin versions

A module records which plugins to enable, not which versions. Syncing one to another machine
reproduces the plugin *set*, not the exact versions — Claude Code updates plugins on its own cadence,
and pinning is the marketplace's job.

Treat modules as portable **role definitions**, not lockfiles.

### Non-portable marketplace sources

When `plugin install` resolves a marketplace from the global registry or from Claude Code's own
cache, it copies the source onto the module as a snapshot. A non-`github` source — a local path, say
— won't mean anything on another machine. Both `plugin install` and `export` warn when they see one.

### Plugin-level `dependencies`

Claude Code's marketplace plugin manifests support a `dependencies` field (auto-installed,
semver-constrained; native `enable`/`disable` won't break them), but this tool only ever reasons
about the literal plugin keys a module names — it has no awareness of a plugin's declared
dependencies.

As of this writing no plugin in either official marketplace declares one, so this has no real-world
impact today. Worth revisiting if that changes.

---

[← back to README](../README.md)

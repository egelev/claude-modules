# Managing modules

`list` · `info` · `create` · `remove`

[← back to README](../README.md) · [Concepts](concepts.md)

---

## `list`

```bash
claude-modules list
```

Lists every module under `$CLAUDE_MODULES_HOME/modules`, with its version, its count of *enabled*
plugins, and its count of known marketplaces.

```
backend (v1.2.0) — 2 plugin(s) enabled, 1 marketplace(s)
base (v1.0.1) — 1 plugin(s) enabled, 1 marketplace(s)
frontend (v1.0.0) — 1 plugin(s) enabled, 1 marketplace(s)
```

Counts are the module's **own** declarations, not what it effectively contributes once composed
modules are resolved in. Plugins explicitly set to `false` are not counted as enabled.

With no modules yet:

```
No modules found. Create one with 'claude-modules create <name>'.
```

This command never writes.

---

## `info`

```bash
claude-modules info <module>
```

Shows a module's full detail: what it composes, every plugin it declares (with whether that
declaration is `enabled` or `disabled`), and every marketplace it knows about with its raw source
JSON.

```
backend (v1.2.0): composes 1 module(s):
  base

backend (v1.2.0): 2 plugin(s):
  typescript-lsp@claude-plugins (enabled)
  postgres-mcp@claude-plugins (enabled)

backend: 1 marketplace(s):
  claude-plugins: {"source":{"source":"github","repo":"anthropics/claude-plugins"}}
```

The `composes` block is printed only when `composedModules` is non-empty.

Like [`marketplace list --module`](marketplaces.md#marketplace-list), this reads the module's own
file directly — it shows what the module **declares**, not what it effectively contributes once
composition is resolved. To see the resolved result, apply it and read the report, or use
[`status`](status.md#status).

This command never writes.

---

## `create`

```bash
claude-modules create <module> [--from-scope user|project|local] [--compose <module>]... [--dry-run]
```

Creates a new module. Errors if the name is already taken.

| Option | Default | Effect |
|---|---|---|
| `--from-scope <scope>` | unset — empty module | Seed from that scope's live `settings.json` |
| `--compose <module>` | none | Build on another module (repeatable) |
| `--dry-run` | off | Report what would be created, write nothing |

```bash
claude-modules create backend
claude-modules create backend --from-scope local
claude-modules create frontend --compose base
claude-modules create fullstack --compose backend --compose frontend
```

New modules always start at version `1.0.0`, however much they're seeded with.

### `--from-scope`

A shortcut for capturing a scope you've already configured by hand, or through `/plugin`, without
re-typing every `<plugin>@<marketplace>` through `plugin install`:

```bash
cd ~/projects/api-service
claude-modules create backend --from-scope local
```

It's a shortcut, not the recommended way to build a module: a scope tends to accumulate plugins for
whatever you were doing at the time, so seeding from it can just as easily capture a bundle that
mixes unrelated concerns (backend and frontend plugins together, say) as it can a clean one. Building
a module deliberately, one `plugin install` at a time, keeps it scoped to a single concern and easier
to compose later — see the [example workflow](../README.md#example-workflow) in the README.

Only plugins actually enabled (`true`) there are captured. An explicit `false` is an *override* —
that's how [`enable --only`](applying.md#enable) suppresses a plugin inherited from a broader scope
— not a member of the set that scope uses, so it's skipped rather than recorded as disabled.

The scope is only read, never written.

A marketplace with a non-`github` source is warned about, since it won't mean anything on another
machine.

### `--compose`

Declares a **persistent** relationship, stored on the new module as `composedModules` — distinct
from the ad-hoc union `enable backend frontend` performs at CLI time. See
[Composition](concepts.md#composition).

`--compose` is independent of `--from-scope`; combine both to seed from a live scope *and* declare a
composition.

Before anything is written, a self-reference, a missing `--compose` target, a composition cycle, or
a marketplace conflict between two composed modules is rejected. `--compose` only sets the
composition at creation time — use [`compose add` / `compose remove`](compose.md) to change it
afterward.

```
Created module 'fullstack' with 0 plugin(s), 0 marketplace(s), and 2 composed module(s).
```

---

## `remove`

```bash
claude-modules remove <module> [--dry-run]
```

Deletes a module's directory, recursively. Idempotent — if the module doesn't exist, this logs a
warning rather than failing.

**It only removes the module itself.** It does not:

- touch any scope's `settings.json` — plugins already enabled stay enabled until the next
  `enable` / `reload` that omits this module
- clean up references to the module in any module list

If the module is still listed in one of this machine's saved module lists, a warning names the file.
That can't reach lists on other machines or other repos, but it catches the common case.
[`reload`](applying.md#reload) also names the specific list file if it later hits a module that was
removed out from under it.

---

[← back to README](../README.md)

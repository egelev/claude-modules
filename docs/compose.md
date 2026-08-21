# Composing modules

`compose add` · `compose remove`

Changing which modules a module builds on, after it's been created. For how composition is
*resolved*, see [Concepts → Composition](concepts.md#composition).

[← back to README](../README.md)

---

## `compose add`

```bash
claude-modules compose add <module> <composed...> [--dry-run]
```

Adds one or more composed modules to an existing module's `composedModules` — the CLI path to change
composition after `create`, short of hand-editing `settings.json`.

```bash
claude-modules compose add frontend base
claude-modules compose add frontend base shared-tools
```

Every future `enable` / `disable` / `status` / `export` against `<module>` transitively pulls in
whatever the newly-composed module(s) contribute.

**Validated atomically.** A self-reference, a composition cycle, a missing composed module, or a
sibling marketplace conflict rejects the *entire* call — nothing is written, even if some of the
named modules would have been fine on their own. This is the same validation `create --compose`
runs.

**Idempotent per name.** A composed module already present is skipped and noted in the output. If
every named module is already composed, this is a no-op that logs a warning rather than failing.

Bumps the module's **patch** version once per call, regardless of how many modules were added. A
no-op call bumps nothing.

---

## `compose remove`

```bash
claude-modules compose remove <module> <composed...> [--dry-run]
```

The reciprocal: removes one or more composed modules from an existing module's `composedModules`.

```bash
claude-modules compose remove frontend shared-tools
```

**Idempotent per name.** A module not currently composed is skipped and noted. If none of the named
modules are composed, this is a no-op that logs a warning rather than failing.

**Never re-validates composition afterward** — removing entries can only shrink the effective set,
never introduce a new cycle or conflict.

Bumps the module's **minor** version (patch reset to `0`) once per call.

---

## Hand-editing

The only way to bypass validation is to edit a module's `settings.json` directly.
`claude-modules` does **not** validate a hand-edit when it's made: a typo, a cycle, or a conflicting
marketplace surfaces as an error only on the *next* command that resolves the module — not at edit
time.

Note also that `composedModules` must be an array of strings. A hand-edited
`"composedModules": "base"` is rejected with an invalid-shape error rather than being coerced.

---

## The one-level override limit

`plugin uninstall --disable` writes an explicit `false` into a module, which suppresses a plugin
that a **directly** composed child enables.

That override **does not propagate past one level.** Resolve the overriding module into a
grandparent's composition and it evaporates — the grandparent sees no opinion either way, not an
explicit `false`.

In the same vein, two composed siblings that disagree on a plugin key resolve silently rather than
erroring the way a marketplace conflict does: the enabling sibling wins, without warning.

Neither case is common enough today to justify reworking composition's internal representation to
track a real enabled / disabled / unmentioned tri-state. If you build a deep composition tree that
depends on multi-level exclusion, know the limit.

---

[← back to README](../README.md)

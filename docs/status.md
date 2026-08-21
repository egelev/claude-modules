# Auditing a scope

`status`

[← back to README](../README.md) · [Concepts](concepts.md)

---

## `status`

```bash
claude-modules status [--scope user|project|local] [--verify] [--json]
```

Read-only audit of a scope's live `settings.json` against two independent sources of truth — three
with `--verify`. Every check always runs and reports, so none hides another, and **`status` writes
nothing**.

```bash
claude-modules status
claude-modules status --scope project
claude-modules status --verify
claude-modules status --json
```

`--scope` defaults to `local`. `project` requires a git repository; `local` does not.

---

### Check 1 — Claude Code's plugin cache

Prints the same consolidated enabled-plugins report [`enable`](applying.md#enable) does — one list
covering every scope in effect here, with `(<scope> — overridden by <scope>)` annotations — and
additionally cross-checks every *effectively* enabled plugin (one not overridden by a more-specific
scope) against Claude Code's cache, annotating it when missing.

This is the check `plugin install` / `enable --install` / `reload --install` can't give you after
the fact: their caching step is best-effort by design, so a caching failure never blocks the
settings write and their own success output can't tell you whether it actually happened.

### Check 2 — the scope's module list

Found the same way [`reload`](applying.md#reload) finds it, so `status --scope X` always grades
itself against whatever `enable --scope X --save` wrote — never another scope's list. Unlike
`reload`, a missing file isn't an error; it just means there's nothing to compare against.

When found, its listed modules are resolved exactly like `enable` would, and diffed against the
scope's own `settings.json`:

- **Missing** — a listed module wants a plugin enabled, but it isn't.
- **Stale** — a plugin is enabled, but no listed module declares it. Explicit-`false` entries left
  by `enable --only` are never reported as stale, since they were never "enabled" to begin with.

### Check 3 — Claude Code's own resolution (`--verify` only)

Runs `claude plugin list --json` and diffs its `enabled` set against the one computed above.

Worth the subprocess because precedence can be decided somewhere this tool can't see: it models
scope precedence as `local > project > user`, but **managed settings outrank all three** and can
force a plugin on or off. On a machine with an administrator policy, the report from checks 1–2 can
be confidently wrong, and this is the only way to notice.

Off by default, so plain `status` keeps its guarantee of running nothing external. A `--verify` that
*can't* run — no `claude` on `PATH`, unparseable output — is a **warning, not drift**: it never
changes the exit code.

`--verify` behaves identically at all three scopes. Both sides describe the same thing — what a
session started in this directory would load — because the report always covers the full
`local > project > user` chain regardless of `--scope`.

---

### Example

```
Enabled plugin(s):
  - code-review@claude-plugins (project)
  - postgres-mcp@claude-plugins (project — not cached by Claude Code — run 'claude plugin install postgres-mcp@claude-plugins --scope user -y')
  - typescript-lsp@claude-plugins (project)

Module list /repo/.claude-modules (modules: backend) vs project scope (/repo/.claude/settings.json):
  In sync — every enabled plugin matches the listed module(s).

Error: 1 enabled plugin(s) are not cached by Claude Code and would fail a new session with 'not cached': postgres-mcp@claude-plugins. Run 'claude-modules enable --install'/'reload' to re-cache them, or install each manually with 'claude plugin install <plugin>@<marketplace> --scope user'.
```

With no module list for the scope, check 2 reports that and skips instead:

```
No module list found for local scope (/repo/.claude/settings.local.json) — skipping module-drift check.
```

---

### Exit codes

The exit code distinguishes "ran fine" from "found a problem" from "couldn't even check", so
`status` is usable as a CI or pre-session gate, not just a log line to notice in the moment.

| Code | Meaning |
|---|---|
| `0` | Clean: every effectively-enabled plugin is cached, `settings.json` matches the listed module(s) if any, and — with `--verify` — Claude Code's own resolution agrees |
| `1` | `status` itself couldn't run (bad `--scope`, no repo root, ...) |
| `2` | It ran fine, but found a problem — uncached plugins, missing/stale plugins relative to the listed modules, unresolvable listed modules, or a `--verify` disagreement |

---

### `--json`

Suppresses the human-readable report and prints one JSON object to **stdout** instead. The
exit-code contract is unchanged, so it stays usable as a CI gate while also being scriptable.

```json
{
  "ok": false,
  "scope": "project",
  "settingsPath": "/repo/.claude/settings.json",
  "checks": {
    "cache": { "uncachedPluginKeys": ["postgres-mcp@claude-plugins"] },
    "moduleList": {
      "listFilePath": "/repo/.claude-modules",
      "resolutionFailed": false,
      "missingPluginKeys": [],
      "stalePluginKeys": []
    },
    "verify": null
  }
}
```

- `checks.moduleList.listFilePath` is `null` when the scope has no module list.
- `checks.verify` is `null` unless `--verify` was passed; otherwise
  `{ "ran": true, "unavailable": false, "unexpectedlyEnabled": [], "unexpectedlyDisabled": [] }`.
  `unavailable: true` means the `claude plugin list --json` cross-check itself couldn't run — the
  warning that would normally explain why is suppressed under `--json`, since that signal relocates
  into this field.
- `ok` mirrors the exit-code decision: `false` exactly when the command would exit `2`.

In that case the human-readable problem summary still prints on **stderr**, so a script reading only
stdout always sees clean JSON.

---

[← back to README](../README.md)

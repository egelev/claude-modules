# Plugins in a module

`plugin install` · `plugin uninstall`

[← back to README](../README.md) · [Concepts](concepts.md)

Running `claude-modules plugin` with no subcommand prints this group's usage.

---

## `plugin install`

```bash
claude-modules plugin install <module> <plugin>@<marketplace> [--source '<json>'] [--dry-run]
```

Enables a plugin inside a module.

```bash
claude-modules plugin install backend typescript-lsp@claude-plugins
```

Bumps the module's **patch** version.

### Marketplace resolution

If the plugin's marketplace isn't already known to the module, its source is resolved in this order:

1. an explicit `--source '<json>'` on this call — stored on this module, **and** also registered
   with Claude Code directly (`claude plugin marketplace add`, best-effort, same semantics as
   [cache warming](#cache-warming) below) if it isn't already in `known_marketplaces.json`
2. the [global marketplace registry](concepts.md#the-marketplace-registry)
3. Claude Code's own local `known_marketplaces.json` cache — so if you've already added the
   marketplace via `/plugin` inside Claude Code, this picks it up automatically
4. otherwise the command fails, naming the remedies above

Whichever wins, the source is **copied onto the module as a snapshot**, not referenced. A
non-`github` source is warned about, since it won't mean anything on another machine.

```bash
claude-modules plugin install backend foo@custom-mp \
  --source '{"source":{"source":"github","repo":"me/custom"}}'
```

### Cache warming

Enabling a plugin in `settings.json` isn't enough on its own — Claude Code also needs the plugin's
content materialized in its own cache (`$CLAUDE_CONFIG_DIR/plugins/`), or a new session in a repo
using it fails with `Plugin "<name>" not cached at <marketplace-dir>`.

To prevent that, `plugin install` also runs `claude plugin install <plugin>@<marketplace> --scope
user -y` on your behalf — but only if the plugin isn't cached yet *and* its marketplace is already
known to Claude Code.

This never happens silently. A plugin that was missing and got installed is logged explicitly, and
any failure (no `claude` on `PATH`, no network, unknown marketplace) is a **warning, not a hard
error** — the module is saved either way.

> `-y` accepts a marketplace-declared "run a command to install" plugin's command without showing it
> to you first. Fine for the official marketplace; worth knowing for third-party ones.

Because caching is best-effort, a plugin can end up enabled without actually being cached. Every
command that writes `enabledPlugins` reports this inline, annotating the plugin
`(not cached by Claude Code — run ...)`, and [`status`](status.md#status) answers the same question
on demand without writing anything.

[`enable --install`](applying.md#enable) and [`reload --install`](applying.md#reload) re-check this
too, so a plugin enabled by hand-editing a module file, or one synced in from another machine, still
gets cached before you hit the error in a real session. Plain `enable` / `reload` do **not** attempt
it; they only report what's missing.

---

## `plugin uninstall`

```bash
claude-modules plugin uninstall <module> <plugin>@<marketplace> [--disable] [--dry-run]
```

The reciprocal of `plugin install`: disables a plugin inside a module.

```bash
claude-modules plugin uninstall backend typescript-lsp@claude-plugins
```

By default it **deletes** the key from the module's `enabledPlugins`. It deliberately does not:

- run `claude plugin uninstall` — Claude Code's plugin cache is shared across modules, so other
  modules on this machine may still need the plugin cached
- remove the plugin's marketplace from `extraKnownMarketplaces`, even if it was the last plugin
  referencing it

If the plugin isn't currently enabled in the module, this is a no-op that logs a warning rather than
failing, and bumps nothing. Otherwise it bumps the module's **minor** version (patch reset to `0`).

### `--disable`

```bash
claude-modules plugin uninstall backend typescript-lsp@claude-plugins --disable
```

Sets the key to `false` instead of deleting it.

| | Meaning |
|---|---|
| plain `uninstall` | "this module says nothing about the plugin" |
| `--disable` | "this module explicitly turns it off" |

The difference only matters under composition: a module's own explicit `false` takes precedence over
what a composed module contributes, but a merely-absent key has no such effect.

Unlike plain `uninstall`, `--disable` isn't gated on the plugin already being enabled in this module
— that's the point, since the plugin it's meant to override typically isn't declared here at all.
The only true no-op is a plugin that's already explicitly `false`.

Also bumps the **minor** version.

> **The override only survives one level of composition.** See
> [the one-level override limit](compose.md#the-one-level-override-limit).

Note that a module's `false` removes the plugin from the computed union — it doesn't actively turn
the plugin off in a settings file that already has it `true`. Only
[`enable --only`](applying.md#enable) resets that.

---

[← back to README](../README.md)

# Shell completions

`completions`

[← back to README](../README.md)

---

## `completions`

```bash
claude-modules completions bash|zsh
```

Prints a tab-completion script for the given shell to **stdout** — `completions` itself writes
nothing to disk; you choose how to load the output.

```bash
claude-modules completions bash
claude-modules completions zsh
```

Completes:

- top-level commands (`list`, `enable`, `marketplace`, ...)
- `marketplace`/`plugin`/`compose` subcommands (`add`, `remove`, `list`, `install`, `uninstall`)
- every command's own flags (`--from-scope`, `--output`, `--save`, `--verify`, `--json`, ...)
- `--scope`/`--from-scope` values (`user`, `project`, `local`), in both the `--scope value` and
  `--scope=value` forms

Positionals like `<module>`, `<plugin>@<marketplace>`, and `<name>` are **not** completed — the
generated script never reads `$CLAUDE_MODULES_HOME` or shells out to anything, so it's safe to
`eval` in any shell's startup file.

---

### Bash

Add to `~/.bashrc`:

```bash
eval "$(claude-modules completions bash)"
```

Or write it out once instead of evaluating on every shell start:

```bash
claude-modules completions bash > /etc/bash_completion.d/claude-modules
```

### Zsh

Add to `~/.zshrc`, **after** `compinit` has already run — the generated function only registers
itself when `compdef` is defined, so an `eval` placed above `compinit` silently does nothing rather
than erroring at shell startup:

```zsh
autoload -Uz compinit && compinit
eval "$(claude-modules completions zsh)"
```

If completions don't appear, check that ordering first.

Alternatively, skip the `eval` entirely: save the output as a file named `_claude-modules`
somewhere in your `$fpath`, and `compinit`'s normal autoloading picks it up on the next new shell.

---

[← back to README](../README.md)

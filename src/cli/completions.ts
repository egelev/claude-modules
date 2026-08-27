/**
 * Generates bash/zsh tab-completion scripts from a plain data description of the CLI's surface —
 * kept free of any import from Cli.ts (which imports these generators), so the dependency stays
 * one-directional. Cli.ts assembles a `CompletionShape` from its own COMMAND_GROUPS/COMMAND_OPTIONS/etc.
 * and passes it in.
 */

export interface OptionConfig {
  readonly type: "string" | "boolean";
  readonly multiple?: boolean;
}

export interface CompletionShape {
  /** Every bare top-level command name, e.g. "list", "enable", "marketplace", "help". Sorted. */
  readonly topLevelCommands: readonly string[];
  /** Group name -> its subcommand names, e.g. { marketplace: ["add","remove","list"] }. */
  readonly groupSubcommands: Readonly<Record<string, readonly string[]>>;
  /** Dispatch key ("list", "marketplace add", ...) -> its own flags (name without leading '--'). */
  readonly commandOptions: Readonly<Record<string, Readonly<Record<string, OptionConfig>>>>;
  /** Flags available after any command, e.g. ["-h","--help","--dry-run","--verbose"]. */
  readonly globalFlags: readonly string[];
  /** Flag name (without '--') -> its known value choices, e.g. { scope: ["user","project","local"] }. */
  readonly enumValuedFlags: Readonly<Record<string, readonly string[]>>;
  /** Top-level command -> its own positional's known choices, e.g. { completions: ["bash","zsh"] }. */
  readonly positionalChoices: Readonly<Record<string, readonly string[]>>;
}

function flagsFor(shape: CompletionShape, dispatchKey: string): string[] {
  const own = Object.keys(shape.commandOptions[dispatchKey] ?? {}).map((name) => `--${name}`);
  return [...own, ...shape.globalFlags];
}

/** Dispatch keys that name a subcommand-choosing position (COMP_CWORD 2 / zsh CURRENT 3): real
 * command groups, plus any top-level command with its own fixed-choice positional (e.g. 'completions'). */
function subcommandChoicesByFirstWord(shape: CompletionShape): Record<string, readonly string[]> {
  return { ...shape.groupSubcommands, ...shape.positionalChoices };
}

export function generateBashCompletion(shape: CompletionShape): string {
  const groupNames = Object.keys(shape.groupSubcommands);
  const dispatchKeys = Object.keys(shape.commandOptions);
  const subcommandChoices = subcommandChoicesByFirstWord(shape);

  const dispatchResolution =
    groupNames.length === 0
      ? ""
      : `  case "\${COMP_WORDS[1]}" in
    ${groupNames.join("|")})
      if [[ $COMP_CWORD -gt 2 && -n "\${COMP_WORDS[2]}" ]]; then
        dispatch="\${COMP_WORDS[1]} \${COMP_WORDS[2]}"
      fi
      ;;
  esac

`;

  // Bash splits '--scope=user' into separate COMP_WORDS at the '=' (COMP_WORDBREAKS) — verified
  // directly against a real bash (not assumed): completing right after the '=' lands COMP_CWORD *on*
  // the '=' itself, so prev is the flag name and cur is the literal string "=" (not "--scope=", and
  // not the value); completing after that, once a value has been typed, prev becomes "=" and the
  // flag name has scrolled back to COMP_WORDS[COMP_CWORD-2]. Both sub-cases are handled below —
  // there is no single 'cur starts with --flag=' branch that works in bash, unlike a shell that
  // doesn't split on '='.
  const enumPrevIsFlagArms = Object.entries(shape.enumValuedFlags)
    .map(
      ([flag, values]) =>
        `    --${flag}) local v="$cur"; [[ "$v" == "=" ]] && v=""; COMPREPLY=( $(compgen -W "${values.join(" ")}" -- "$v") ); return ;;`
    )
    .join("\n");

  const enumPrevIsEqualsArms = Object.entries(shape.enumValuedFlags)
    .map(([flag, values]) => `        --${flag}) COMPREPLY=( $(compgen -W "${values.join(" ")}" -- "$cur") ); return ;;`)
    .join("\n");

  const flagCaseArms = dispatchKeys.map((key) => `      "${key}") flags="${flagsFor(shape, key).join(" ")}" ;;`).join("\n");

  const subcommandArms = Object.entries(subcommandChoices)
    .map(([word, choices]) => `      ${word}) COMPREPLY=( $(compgen -W "${choices.join(" ")}" -- "$cur") ); return ;;`)
    .join("\n");

  return `# claude-modules bash completion
# Install: eval "$(claude-modules completions bash)"   (e.g. in ~/.bashrc)
# or write it out once: claude-modules completions bash > /etc/bash_completion.d/claude-modules

_claude_modules_completions() {
  local cur prev dispatch
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  dispatch="\${COMP_WORDS[1]}"

${dispatchResolution}  case "$prev" in
${enumPrevIsFlagArms}
    =)
      case "\${COMP_WORDS[COMP_CWORD-2]}" in
${enumPrevIsEqualsArms}
      esac
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    local flags
    case "$dispatch" in
${flagCaseArms}
      *) flags="${shape.globalFlags.join(" ")}" ;;
    esac
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
    return
  fi

  if [[ $COMP_CWORD -eq 2 ]]; then
    case "\${COMP_WORDS[1]}" in
${subcommandArms}
    esac
  fi

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${shape.topLevelCommands.join(" ")}" -- "$cur") )
    return
  fi
}

complete -F _claude_modules_completions claude-modules
`;
}

export function generateZshCompletion(shape: CompletionShape): string {
  const groupNames = Object.keys(shape.groupSubcommands);
  const dispatchKeys = Object.keys(shape.commandOptions);
  const subcommandChoices = subcommandChoicesByFirstWord(shape);

  const dispatchResolution =
    groupNames.length === 0
      ? ""
      : `  case "\${words[2]}" in
    ${groupNames.join("|")})
      if [[ $CURRENT -gt 3 && -n "\${words[3]}" ]]; then
        dispatch="\${words[2]} \${words[3]}"
      fi
      ;;
  esac

`;

  // zsh's $words does not split a word on '=' the way bash's COMP_WORDBREAKS does — unverified
  // against a real zsh in this environment (none installed), but bash's analogous split was itself
  // proven wrong by direct testing despite looking obvious on paper, so this defends against the
  // same bug class rather than trusting the "zsh doesn't split, so this can't happen" assumption on
  // reasoning alone: if '--scope=' does arrive as one un-split current word, this catches it; if it
  // doesn't, the branch just never matches.
  const enumCurEqualsArms = Object.entries(shape.enumValuedFlags)
    .map(([flag, values]) => `    --${flag}=*) compadd -- ${values.join(" ")}; return ;;`)
    .join("\n");

  const enumSpaceArms = Object.entries(shape.enumValuedFlags)
    .map(([flag, values]) => `    "--${flag}") compadd -- ${values.join(" ")}; return ;;`)
    .join("\n");

  // zsh does not word-split an unquoted variable by default, so each arm builds a real array
  // (space-separated *inside* the parens is array-literal syntax, not runtime splitting) rather than
  // a string handed to compadd — a bare `compadd -- $flags` would offer one candidate containing
  // literal spaces instead of one candidate per flag.
  const flagCaseArms = dispatchKeys.map((key) => `      "${key}") flags=(${flagsFor(shape, key).join(" ")}) ;;`).join("\n");

  const subcommandArms = Object.entries(subcommandChoices)
    .map(([word, choices]) => `      ${word}) compadd -- ${choices.join(" ")}; return ;;`)
    .join("\n");

  return `#compdef claude-modules
# claude-modules zsh completion
# Install, after compinit has already run: eval "$(claude-modules completions zsh)"   (e.g. in ~/.zshrc)
# or save this output as a file named '_claude-modules' somewhere in your $fpath.

_claude_modules() {
  local cur prev dispatch
  cur="\${words[CURRENT]}"
  prev="\${words[CURRENT-1]}"
  dispatch="\${words[2]}"

${dispatchResolution}  case "$cur" in
${enumCurEqualsArms}
  esac

  case "$prev" in
${enumSpaceArms}
  esac

  if [[ "$cur" == -* ]]; then
    local -a flags
    case "$dispatch" in
${flagCaseArms}
      *) flags=(${shape.globalFlags.join(" ")}) ;;
    esac
    compadd -- "\${flags[@]}"
    return
  fi

  if [[ $CURRENT -eq 3 ]]; then
    case "\${words[2]}" in
${subcommandArms}
    esac
  fi

  if [[ $CURRENT -eq 2 ]]; then
    compadd -- ${shape.topLevelCommands.join(" ")}
    return
  fi
}

(( \$+functions[compdef] )) && compdef _claude_modules claude-modules
`;
}

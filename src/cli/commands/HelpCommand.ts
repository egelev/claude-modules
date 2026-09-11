import pc from "picocolors";
import { Command } from "./Command.js";

/** Headers of a block whose rows each open with a flag/command cell, then a 2+-space gap, then a
 * description — the shape every Commands:/Subcommands:/Options:/Global options: block uses. */
const LIST_BLOCK_HEADERS = new Set(["Commands:", "Subcommands:", "Options:", "Global options:"]);

/** Of those, the two whose cell can open with a bare command/subcommand name rather than only
 * `--flag`s (e.g. `add <spec>`, `plugin install <module> ...`). */
const NAME_BLOCK_HEADERS = new Set(["Commands:", "Subcommands:"]);

/** A `-x` short flag or `--long-flag`, matched as a whole token — not the "-" inside a hyphenated
 * word like "known-marketplaces". */
const FLAG_TOKEN = /(?<![\w-])(--[a-zA-Z][\w-]*|-[a-zA-Z](?![\w-]))/g;

/** The leading run of lowercase, possibly-hyphenated words at the start of a cell — a command or
 * subcommand name, e.g. "list", "disable-all", "plugin install". Stops at the first positional
 * (`<...>`) or flag (`[...]`). */
const LEADING_NAME = /^(\s{2})((?:[a-z][\w-]*)(?: [a-z][\w-]*)*)/;

/**
 * Bolds one row of a block: every flag token always, plus the leading command/subcommand name for
 * `Commands:`/`Subcommands:` rows. The description half (past the first 2+-space gap) is left
 * untouched — bold means "salient token", not "whole line", everywhere else in this CLI's output.
 */
function boldBlockRow(line: string, header: string): string {
  const cellAndDescription = line.match(/^(\s{2}\S.*?)(\s{2,})(.*)$/s);
  if (!cellAndDescription) return line;
  const [, cell, spacer, description] = cellAndDescription;
  let boldedCell = cell!.replace(FLAG_TOKEN, (token) => pc.bold(token));
  if (NAME_BLOCK_HEADERS.has(header)) {
    boldedCell = boldedCell.replace(LEADING_NAME, (_m, indent, name) => `${indent}${pc.bold(name)}`);
  }
  return `${boldedCell}${spacer}${description}`;
}

/**
 * Applies this CLI's usual bold-for-salient-token convention to raw help text: the command name on
 * each `Usage:` line, and every flag/command token inside a Commands:/Subcommands:/Options:/Global
 * options: block. A single pass over the text, rather than hand-coding escape codes into each of
 * help.ts's ~25 entries, so help.ts itself stays plain, easily-diffable text.
 */
function colorizeHelp(text: string): string {
  let blockHeader: string | undefined;
  return text
    .split("\n")
    .map((line) => {
      const usage = line.match(/^(Usage: )(claude-modules(?: [a-z][\w-]*)*)(.*)$/);
      if (usage) {
        const [, prefix, command, rest] = usage;
        return `${prefix}${pc.bold(command!)}${rest}`;
      }
      const trimmed = line.trim();
      if (LIST_BLOCK_HEADERS.has(trimmed)) {
        blockHeader = trimmed;
        return line;
      }
      // A block ends at the next blank or column-0 line (a new paragraph or section heading).
      if (line === "" || line[0] !== " ") {
        blockHeader = undefined;
        return line;
      }
      return blockHeader !== undefined ? boldBlockRow(line, blockHeader) : line;
    })
    .join("\n");
}

export class HelpCommand implements Command {
  constructor(private readonly text: string) {}

  async execute(): Promise<void> {
    process.stdout.write(colorizeHelp(this.text));
  }
}

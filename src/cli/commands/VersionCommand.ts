import { readFile } from "node:fs/promises";
import { Command } from "./Command.js";

/** The package's own version, for `--version`. `src/cli/commands/` and `dist/cli/commands/` are both three levels deep. */
async function readPackageVersion(): Promise<string> {
  const packageJsonPath = new URL("../../../package.json", import.meta.url);
  const raw = await readFile(packageJsonPath, "utf8");
  return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
}

export class VersionCommand implements Command {
  async execute(): Promise<void> {
    process.stdout.write(`${await readPackageVersion()}\n`);
  }
}

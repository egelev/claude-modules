import { resolve } from "node:path";
import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleArchiver } from "../../core/ModuleArchiver.js";
import { Logger } from "../../util/Logger.js";

/** YYYY-MM-DD, in local time — matches the default archive filename convention. */
function toDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Packages a module — and every module it transitively composes — into a single `.tar.gz`,
 * so it can be handed to another machine and unpacked with 'import' and have composition work
 * out of the box.
 */
export class ExportModuleCommand implements Command {
  constructor(
    private readonly name: string,
    private readonly output: string | undefined,
    private readonly cwd: string,
    private readonly archiver: ModuleArchiver,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const outputPath = resolve(this.cwd, this.output ?? `${this.name}-${toDateStamp(new Date())}.tar.gz`);

    if (this.dryRun) {
      const closure = await this.archiver.collectClosure(this.name);
      const composed = closure.filter((n) => n !== this.name);
      this.logger.info(
        `${pc.dim("[dry-run]")} Would export module '${pc.bold(this.name)}'` +
          (composed.length > 0 ? ` and ${composed.length} composed module(s) (${composed.join(", ")})` : "") +
          ` to '${pc.bold(outputPath)}'.`
      );
      return;
    }

    const result = await this.archiver.export(this.name, outputPath);
    this.logger.info(
      `Exported module '${pc.bold(this.name)}'` +
        (result.composedModules.length > 0
          ? ` with ${result.composedModules.length} composed module(s) (${result.composedModules.join(", ")})`
          : "") +
        ` to '${pc.bold(result.outputPath)}'.`
    );
  }
}

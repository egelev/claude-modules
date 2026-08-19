import { resolve } from "node:path";
import pc from "picocolors";
import { Command } from "./Command.js";
import { ModuleArchiver } from "../../core/ModuleArchiver.js";
import { Logger } from "../../util/Logger.js";

/**
 * Unpacks a module — and its composed modules — from a 'export' archive. Reciprocal of
 * ExportModuleCommand: '--name' renames only the root module; '--composed-prefix' renames every
 * composed module (at every level of the tree) and rewrites 'composedModules' references to match.
 */
export class ImportModuleCommand implements Command {
  constructor(
    private readonly archivePath: string,
    private readonly name: string | undefined,
    private readonly composedPrefix: string | undefined,
    private readonly cwd: string,
    private readonly archiver: ModuleArchiver,
    private readonly logger: Logger,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    const resolvedArchivePath = resolve(this.cwd, this.archivePath);
    const result = await this.archiver.import(resolvedArchivePath, {
      name: this.name,
      composedPrefix: this.composedPrefix,
      dryRun: this.dryRun,
    });

    const summary =
      `module '${pc.bold(result.rootModule)}'` +
      (result.composedModules.length > 0
        ? ` with ${result.composedModules.length} composed module(s) (${result.composedModules.join(", ")})`
        : "");

    if (this.dryRun) {
      this.logger.info(`${pc.dim("[dry-run]")} Would import ${summary} from '${pc.bold(this.archivePath)}'.`);
      return;
    }

    this.logger.info(`Imported ${summary} from '${pc.bold(this.archivePath)}'.`);
  }
}

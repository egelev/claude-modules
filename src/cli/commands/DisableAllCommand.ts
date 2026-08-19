import { Command } from "./Command.js";
import { DisableModulesUseCase } from "../../core/DisableModulesUseCase.js";
import { Scope } from "../../core/types.js";

export class DisableAllCommand implements Command {
  constructor(
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly disableModulesUseCase: DisableModulesUseCase,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    await this.disableModulesUseCase.runAll(this.scope, this.cwd, this.dryRun);
  }
}

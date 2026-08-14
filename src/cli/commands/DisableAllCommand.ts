import { Command } from "./Command.js";
import { DisableProfilesUseCase } from "../../core/DisableProfilesUseCase.js";
import { Scope } from "../../core/types.js";

export class DisableAllCommand implements Command {
  constructor(
    private readonly scope: Scope,
    private readonly cwd: string,
    private readonly disableProfilesUseCase: DisableProfilesUseCase,
    private readonly dryRun: boolean
  ) {}

  async execute(): Promise<void> {
    await this.disableProfilesUseCase.runAll(this.scope, this.cwd, this.dryRun);
  }
}

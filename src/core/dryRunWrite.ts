import pc from "picocolors";
import { SettingsRepository } from "./SettingsRepository.js";
import { ClaudeSettings } from "./types.js";
import { Logger } from "../util/Logger.js";

/** Shared by `ApplyModulesUseCase`/`DisableModulesUseCase`: write `settings` unless `dryRun`, in which case log what would have been written instead. */
export async function writeSettingsUnlessDryRun(
  settingsRepository: SettingsRepository,
  logger: Logger,
  dryRun: boolean,
  settingsPath: string,
  settings: ClaudeSettings
): Promise<void> {
  if (dryRun) {
    logger.info(`${pc.dim("[dry-run]")} Would write ${pc.bold(settingsPath)} — no files modified.`);
  } else {
    await settingsRepository.write(settingsPath, settings);
  }
}

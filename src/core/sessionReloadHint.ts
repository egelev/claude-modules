import pc from "picocolors";
import { Logger } from "../util/Logger.js";

/**
 * Claude Code reads `enabledPlugins` when a session starts. Editing settings.json from a shell has
 * no effect on a session that is already open — which looks exactly like the command having done
 * nothing, with no hint as to why. Every command that changes what should be enabled says so.
 */
export function logSessionReloadHint(logger: Logger): void {
  logger.section();
  logger.info(
    `Already running a Claude Code session? It won't pick this up on its own — run ${pc.bold("/reload-plugins")} ` +
      `in it (add ${pc.bold("--force")} if it warns about the prompt cache), or start a new session.`
  );
}

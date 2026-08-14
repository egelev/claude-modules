import { readFile } from "node:fs/promises";
import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { ClaudeSettings } from "./types.js";

/** Reads/writes a single Claude Code settings.json file, preserving every key this tool doesn't understand. */
export class SettingsRepository {
  async read(path: string): Promise<ClaudeSettings> {
    const raw = await readFile(path, "utf8").catch((err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (raw === null) return {};
    return JSON.parse(raw) as ClaudeSettings;
  }

  async write(path: string, settings: ClaudeSettings): Promise<void> {
    await atomicWriteFile(path, toJsonWithTrailingNewline(settings));
  }
}

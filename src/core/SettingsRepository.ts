import { atomicWriteFile, toJsonWithTrailingNewline } from "../util/atomicWrite.js";
import { readOptionalJsonFile } from "../util/jsonFile.js";
import { ClaudeSettings } from "./types.js";

/** Reads/writes a single Claude Code settings.json file, preserving every key this tool doesn't understand. */
export class SettingsRepository {
  async read(path: string): Promise<ClaudeSettings> {
    return readOptionalJsonFile<ClaudeSettings>(path, () => ({}), `Settings file ${path}`);
  }

  async write(path: string, settings: ClaudeSettings): Promise<void> {
    await atomicWriteFile(path, toJsonWithTrailingNewline(settings));
  }
}

import { InvalidExportArchiveError } from "../util/errors.js";

export const MANIFEST_VERSION = 1;

export interface ExportManifest {
  version: number;
  rootModule: string;
  composedModules: string[];
  exportedAt: string;
}

export function parseManifest(raw: string | undefined): ExportManifest {
  if (raw === undefined) {
    throw new InvalidExportArchiveError(
      "missing manifest.json — this doesn't look like a 'claude-modules export' archive."
    );
  }
  let parsed: Partial<ExportManifest>;
  try {
    parsed = JSON.parse(raw) as Partial<ExportManifest>;
  } catch {
    throw new InvalidExportArchiveError("manifest.json is not valid JSON.");
  }
  if (typeof parsed.rootModule !== "string" || !Array.isArray(parsed.composedModules)) {
    throw new InvalidExportArchiveError("manifest.json is missing 'rootModule' or 'composedModules'.");
  }
  const version = parsed.version ?? MANIFEST_VERSION;
  if (version !== MANIFEST_VERSION) {
    throw new InvalidExportArchiveError(
      `manifest.json is version ${version}, but this build of claude-modules only understands version ${MANIFEST_VERSION}. Upgrade claude-modules and try again.`
    );
  }
  return {
    version,
    rootModule: parsed.rootModule,
    composedModules: parsed.composedModules,
    exportedAt: parsed.exportedAt ?? "",
  };
}

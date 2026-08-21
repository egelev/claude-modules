const DEFAULT_VERSION = "1.0.0";

function parse(version: string): { major: number; minor: number; patch: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return parse(DEFAULT_VERSION);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Bumps the patch component — used when a module gains something (a plugin, a marketplace). */
export function bumpPatch(version: string): string {
  const { major, minor, patch } = parse(version);
  return `${major}.${minor}.${patch + 1}`;
}

/** Bumps the minor component and resets patch to 0 — used when a module loses something. */
export function bumpMinor(version: string): string {
  const { major, minor } = parse(version);
  return `${major}.${minor + 1}.0`;
}

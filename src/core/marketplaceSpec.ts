import { basename, dirname } from "node:path";
import { MarketplaceSource } from "./types.js";

export interface ParsedMarketplaceSpec {
  inferredName: string;
  source: MarketplaceSource;
}

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/**
 * Best-effort auto-detection mirroring `/plugin marketplace add <spec>`. Only the GitHub-shorthand
 * shape (`owner/repo`, optionally pinned to a branch/tag with a trailing `@ref` — see
 * https://code.claude.com/docs/en/plugin-marketplaces#plugin-marketplace-add) has a documented
 * settings.json representation; git-URL and local-path shapes below are unverified and should be
 * confirmed against real Claude Code output before being relied upon — use --source '<json>' to
 * bypass this entirely.
 */
export function parseMarketplaceSpec(spec: string): ParsedMarketplaceSpec {
  const withoutFragment = spec.split("#")[0]!;

  if (GITHUB_SHORTHAND.test(spec)) {
    const repoName = spec.split("/")[1]!;
    return { inferredName: repoName, source: { source: { source: "github", repo: spec } } };
  }

  // GitHub shorthand can be pinned to a branch/tag via a trailing @ref (mirrors the git branch's
  // #ref below, stored verbatim in `repo` the same way). The `atIndex !== -1` guard matters: without
  // it, a no-'@' spec like a local path 'owner/repo/' could slice(0, -1) into something that
  // spuriously re-matches GITHUB_SHORTHAND once its last character is dropped.
  const atIndex = spec.indexOf("@");
  if (atIndex !== -1) {
    const beforeRef = spec.slice(0, atIndex);
    if (GITHUB_SHORTHAND.test(beforeRef)) {
      const repoName = beforeRef.split("/")[1]!;
      return { inferredName: repoName, source: { source: { source: "github", repo: spec } } };
    }
  }

  if (/^https?:\/\//.test(spec) || spec.startsWith("git@")) {
    const inferredName = inferNameFromPathLike(withoutFragment);
    return { inferredName, source: { source: { source: "git", url: spec } } };
  }

  // A spec that's shorthand *except* for a trailing #fragment isn't a local path — it's someone
  // expecting git-URL-style ref pinning via '#', which shorthand doesn't support (use '@ref' above
  // instead, or the full git URL, both suggested in the error below).
  if (spec !== withoutFragment && GITHUB_SHORTHAND.test(withoutFragment)) {
    const ref = spec.slice(withoutFragment.length + 1);
    throw new Error(
      `GitHub shorthand doesn't support '#ref' pinning — use '@ref' instead (e.g. ` +
        `'${withoutFragment}@${ref}'), or the full git URL: https://github.com/${withoutFragment}.git#${ref}`
    );
  }

  const inferredName = inferNameFromPathLike(withoutFragment);
  return { inferredName, source: { source: { source: "local", path: spec } } };
}

function inferNameFromPathLike(pathLike: string): string {
  const base = basename(pathLike.replace(/\/$/, "")).replace(/\.git$/, "");
  return base === "marketplace.json" ? basename(dirname(pathLike)) : base;
}

export type MarketplaceSourceKind = "github" | "git" | "local" | "unrecognized";

/**
 * Classifies a stored MarketplaceSource by peeking the one shape this tool ever produces itself —
 * `{ source: { source: <kind>, ... } }`. Anything else — a hand-authored `--source '<json>'`, a
 * shape from a future version of this tool, or `create --from-scope` copying something unfamiliar
 * out of a live settings.json — is "unrecognized": deliberately not assumed portable just because
 * it isn't recognized. Shared by `marketplaceSpecFromSource` below (what can be auto-added) and
 * `marketplacePortability.ts` (what's safe to assume travels to another machine), so the two agree
 * on which sources are which — an unrecognized shape used to be silently treated as portable by one
 * and unconvertible by the other, which was really two answers to the same question.
 */
export function classifyMarketplaceSource(source: MarketplaceSource): MarketplaceSourceKind {
  const kind = (source as { source?: { source?: string } })?.source?.source;
  return kind === "github" || kind === "git" || kind === "local" ? kind : "unrecognized";
}

/**
 * Reverses parseMarketplaceSpec: recovers a CLI-invokable spec string from a stored MarketplaceSource,
 * for auto-running `claude plugin marketplace add`. Returns undefined for any source this tool didn't
 * produce itself in a recognized shape (e.g. hand-authored --source '<json>' with an unfamiliar
 * structure) — callers must treat that as "can't be auto-added", not as an error.
 */
export function marketplaceSpecFromSource(source: MarketplaceSource): string | undefined {
  const inner = (source as { source?: { repo?: string; url?: string; path?: string } })?.source;
  switch (classifyMarketplaceSource(source)) {
    case "github":
      return inner?.repo;
    case "git":
      return inner?.url;
    case "local":
      return inner?.path;
    case "unrecognized":
      return undefined;
  }
}

import { basename, dirname } from "node:path";
import { MarketplaceSource } from "./types.js";

export interface ParsedMarketplaceSpec {
  inferredName: string;
  source: MarketplaceSource;
}

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/**
 * Best-effort auto-detection mirroring `/plugin marketplace add <spec>`. Only the GitHub-shorthand
 * shape (`owner/repo`) has a documented settings.json representation; git-URL and local-path
 * shapes below are unverified and should be confirmed against real Claude Code output before
 * being relied upon — use --source '<json>' to bypass this entirely.
 */
export function parseMarketplaceSpec(spec: string): ParsedMarketplaceSpec {
  const withoutFragment = spec.split("#")[0]!;

  if (GITHUB_SHORTHAND.test(spec)) {
    const repoName = spec.split("/")[1]!;
    return { inferredName: repoName, source: { source: { source: "github", repo: spec } } };
  }

  if (/^https?:\/\//.test(spec) || spec.startsWith("git@")) {
    const inferredName = inferNameFromPathLike(withoutFragment);
    return { inferredName, source: { source: { source: "git", url: spec } } };
  }

  // A spec that's shorthand *except* for a trailing #fragment isn't a local path —
  // it's someone expecting git-URL-style ref pinning, which shorthand doesn't support.
  if (spec !== withoutFragment && GITHUB_SHORTHAND.test(withoutFragment)) {
    throw new Error(
      `GitHub shorthand doesn't support '#ref' pinning. Use the full git URL instead: ` +
        `https://github.com/${withoutFragment}.git#${spec.slice(withoutFragment.length + 1)}`
    );
  }

  const inferredName = inferNameFromPathLike(withoutFragment);
  return { inferredName, source: { source: { source: "local", path: spec } } };
}

function inferNameFromPathLike(pathLike: string): string {
  const base = basename(pathLike.replace(/\/$/, "")).replace(/\.git$/, "");
  return base === "marketplace.json" ? basename(dirname(pathLike)) : base;
}

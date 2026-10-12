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

/**
 * Every marketplace source type Claude Code itself accepts in `extraKnownMarketplaces` (see
 * https://code.claude.com/docs/en/plugins/marketplace-reference#marketplace-sources), plus `local` —
 * the shape this tool's own parseMarketplaceSpec writes for a path spec.
 */
export type MarketplaceSourceKind =
  | "github"
  | "git"
  | "url"
  | "settings"
  | "directory"
  | "file"
  | "local"
  | "unrecognized";

const KNOWN_SOURCE_KINDS: ReadonlySet<string> = new Set([
  "github",
  "git",
  "url",
  "settings",
  "directory",
  "file",
  "local",
]);

/** Claude Code's default manifest location inside a cloned marketplace repo — a `path` equal to it
 * is the same as no `path` at all. */
const DEFAULT_MANIFEST_PATH = ".claude-plugin/marketplace.json";

/**
 * Classifies a stored MarketplaceSource by peeking its `{ source: { source: <kind>, ... } }` shape.
 * Anything else — a hand-authored `--source '<json>'` with an unfamiliar structure, or `create
 * --from-scope` copying something odd out of a live settings.json — is "unrecognized": deliberately
 * not assumed portable just because it isn't recognized. Shared by `marketplaceAddPlan` (what can be
 * auto-added) and `marketplacePortability` (what's safe to assume travels to another machine), so the
 * two agree on which sources are which — an unrecognized shape used to be silently treated as
 * portable by one and unconvertible by the other, which was really two answers to the same question.
 */
export function classifyMarketplaceSource(source: MarketplaceSource): MarketplaceSourceKind {
  const kind = innerSource(source)?.source;
  return typeof kind === "string" && KNOWN_SOURCE_KINDS.has(kind) ? (kind as MarketplaceSourceKind) : "unrecognized";
}

export type MarketplacePortability = "portable" | "machine-specific" | "unrecognized";

/**
 * Whether a source means the same thing on another machine. Remote sources (`github`, an `https`
 * `url`, a remote `git` URL) and an inline `settings` catalog travel; anything that names a path on
 * this machine doesn't. A `git`/`url` source missing its `url` is malformed rather than local, so it
 * stays "unrecognized" instead of being guessed at.
 */
export function marketplacePortability(source: MarketplaceSource): MarketplacePortability {
  const url = stringField(innerSource(source), "url");
  switch (classifyMarketplaceSource(source)) {
    case "github":
    case "settings":
      return "portable";
    case "url":
      if (url === undefined) return "unrecognized";
      return /^https?:\/\//i.test(url) ? "portable" : "machine-specific";
    case "git":
      if (url === undefined) return "unrecognized";
      return isRemoteGitUrl(url) ? "portable" : "machine-specific";
    case "directory":
    case "file":
    case "local":
      return "machine-specific";
    case "unrecognized":
      return "unrecognized";
  }
}

/**
 * How a stored source can be registered with Claude Code:
 * - `cli`: by running `claude plugin marketplace add <args...>`.
 * - `from-settings`: only from settings.json. Claude Code accepts the source in
 *   `extraKnownMarketplaces` and registers it itself at the next session start, but the CLI has no
 *   form for it (e.g. an inline `settings` catalog, or a `github` source with a custom `path`).
 *   `description` names what makes it so, for log messages.
 * - `unknown`: neither — the source isn't a shape this tool understands.
 */
export type MarketplaceAddPlan =
  | { kind: "cli"; args: string[] }
  | { kind: "from-settings"; description: string }
  | { kind: "unknown" };

/**
 * Reverses parseMarketplaceSpec, and more generally maps any stored source to the
 * `claude plugin marketplace add` arguments that recreate it — or says why there are none. A
 * `github`/`git` source's separate `ref` and `sparsePaths` fields are carried over (as `@ref`/`#ref`
 * and `--sparse`), since dropping them would register a different marketplace than the one declared.
 */
export function marketplaceAddPlan(source: MarketplaceSource): MarketplaceAddPlan {
  const inner = innerSource(source);
  const kind = classifyMarketplaceSource(source);
  switch (kind) {
    case "github":
    case "git": {
      const location = stringField(inner, kind === "github" ? "repo" : "url");
      if (location === undefined) return { kind: "unknown" };
      const path = stringField(inner, "path");
      if (path !== undefined && path !== DEFAULT_MANIFEST_PATH) {
        return { kind: "from-settings", description: `a '${kind}' source with a custom 'path'` };
      }
      const separator = kind === "github" ? "@" : "#";
      const ref = stringField(inner, "ref");
      const spec = ref !== undefined && !location.includes(separator) ? `${location}${separator}${ref}` : location;
      const sparsePaths = stringArrayField(inner, "sparsePaths") ?? [];
      return { kind: "cli", args: sparsePaths.length > 0 ? [spec, "--sparse", ...sparsePaths] : [spec] };
    }
    case "url": {
      const url = stringField(inner, "url");
      if (url === undefined) return { kind: "unknown" };
      if (inner?.headers !== undefined || inner?.headersHelper !== undefined) {
        return { kind: "from-settings", description: "a 'url' source with request headers" };
      }
      return { kind: "cli", args: [url] };
    }
    case "settings":
      return { kind: "from-settings", description: "an inline 'settings' source" };
    case "directory":
    case "file":
    case "local": {
      const path = stringField(inner, "path");
      return path === undefined ? { kind: "unknown" } : { kind: "cli", args: [path] };
    }
    case "unrecognized":
      return { kind: "unknown" };
  }
}

function innerSource(source: MarketplaceSource): Record<string, unknown> | undefined {
  const inner = (source as { source?: unknown } | null | undefined)?.source;
  return typeof inner === "object" && inner !== null ? (inner as Record<string, unknown>) : undefined;
}

function stringField(inner: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = inner?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayField(inner: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = inner?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

/** A clone URL that reaches another host: `https://`, `ssh://`, `git://`, or scp-style `user@host:path`.
 * A `file://` URL or a bare filesystem path only means something on this machine. */
function isRemoteGitUrl(url: string): boolean {
  return /^(?:https?|ssh|git):\/\//i.test(url) || /^[\w.-]+@[\w.-]+:/.test(url);
}

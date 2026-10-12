import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { MarketplaceSource } from "./types.js";

export interface ParsedMarketplaceSpec {
  inferredName: string;
  source: MarketplaceSource;
}

export interface ParseMarketplaceSpecOptions {
  /** What a relative path resolves against. Defaults to the process's cwd. */
  cwd?: string;
  /** What a leading `~` expands to. Defaults to the OS home directory. */
  home?: string;
}

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;
/** Claude Code's own split for shorthand: up to the first '@' or '#' is the repo, the rest the ref. */
const SHORTHAND_WITH_REF = /^([^#@]+)(?:[#@](.+))?$/;
const SSH_GIT_URL = /^[\w.-]+@[\w.-]+:/;

/**
 * Turns a `marketplace add <spec>` string into the source object Claude Code itself would store for
 * `claude plugin marketplace add <spec>` — mirroring its parser and source schema as of Claude Code
 * 2.1.295 (see https://code.claude.com/docs/en/plugins/marketplace-reference#marketplace-sources), so
 * whatever lands in settings.json's extraKnownMarketplaces is a shape Claude Code can load:
 *
 * - `./dir`, `../dir`, `/dir`, `~/dir` → `directory` with an absolute path; a `.json` path → `file`.
 * - `https://…` → `git` for a clone URL (`.git`, `/_git/`, or a github.com/gitlab.com repo page,
 *   normalized to end in `.git`), otherwise `url` — a hosted marketplace.json. `#ref` → `ref`.
 * - `user@host:path` → `git`, with `#ref` → `ref`.
 * - `owner/repo`, `owner/repo@ref`, `owner/repo#ref` → `github`, with the ref in its own field.
 *
 * Unlike Claude Code, anything else is still accepted as a path relative to `cwd`, rather than
 * rejected — the behavior this tool has always had, now producing a valid `directory`/`file` shape.
 * Use --source '<json>' for anything this can't express (e.g. a `path` or `sparsePaths`).
 */
export function parseMarketplaceSpec(spec: string, options: ParseMarketplaceSpecOptions = {}): ParsedMarketplaceSpec {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();

  // Explicit paths first, as Claude Code checks them: './plugins' would otherwise pass for
  // 'owner/repo' shorthand, since '.' is a valid owner character.
  if (/^\.{1,2}[\\/]/.test(spec) || /^~(?:[\\/]|$)/.test(spec) || isAbsolute(spec)) {
    return pathSpec(spec, cwd, home);
  }

  if (/^https?:\/\//i.test(spec)) {
    const [base, ref] = splitRef(spec);
    const inferredName = inferNameFromPathLike(base);
    const cloneUrl = gitCloneUrl(base);
    return cloneUrl !== undefined
      ? { inferredName, source: { source: { source: "git", url: cloneUrl, ...(ref !== undefined && { ref }) } } }
      : { inferredName, source: { source: { source: "url", url: base } } };
  }

  if (SSH_GIT_URL.test(spec)) {
    const [url, ref] = splitRef(spec);
    return {
      inferredName: inferNameFromPathLike(url),
      source: { source: { source: "git", url, ...(ref !== undefined && { ref }) } },
    };
  }

  if (/^[\w.-]+\/[\w.-]+[@#]$/.test(spec)) {
    throw new Error(
      `'${spec}' ends in an empty ref — drop the trailing '${spec.slice(-1)}', or name a branch or tag after it.`
    );
  }
  const shorthand = SHORTHAND_WITH_REF.exec(spec);
  if (shorthand !== null && GITHUB_SHORTHAND.test(shorthand[1]!)) {
    const repo = shorthand[1]!;
    const ref = shorthand[2];
    return {
      inferredName: repo.split("/")[1]!,
      source: { source: { source: "github", repo, ...(ref !== undefined && { ref }) } },
    };
  }

  return pathSpec(spec, cwd, home);
}

/** A path spec → `file` (a `.json` path, as Claude Code requires of a file source) or `directory`,
 * always absolute: Claude Code resolves a relative `path` against whichever project a session starts
 * in, which would make the same module point somewhere different in every repo. A `#` stays part of
 * the path, as it does in Claude Code. */
function pathSpec(spec: string, cwd: string, home: string): ParsedMarketplaceSpec {
  const expanded = spec === "~" ? home : /^~[\\/]/.test(spec) ? join(home, spec.slice(2)) : spec;
  const path = resolve(cwd, expanded);
  return {
    inferredName: inferNameFromPathLike(spec.split("#")[0]!),
    source: { source: { source: path.endsWith(".json") ? "file" : "directory", path } },
  };
}

/** Splits a trailing `#ref` off a URL; an empty ref counts as none. */
function splitRef(spec: string): [string, string | undefined] {
  const hashIndex = spec.indexOf("#");
  if (hashIndex === -1) return [spec, undefined];
  const ref = spec.slice(hashIndex + 1);
  return [spec.slice(0, hashIndex), ref.length > 0 ? ref : undefined];
}

/**
 * The URL to clone if an http(s) URL names a git repository, mirroring Claude Code: a URL ending in
 * `.git` or containing `/_git/` (Azure DevOps) as-is, and a github.com `owner/repo` or gitlab.com
 * `group/…/project` page with `.git` appended. Undefined for anything else, which Claude Code treats
 * as a hosted marketplace.json instead.
 */
function gitCloneUrl(url: string): string | undefined {
  if (url.endsWith(".git") || url.includes("/_git/")) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.search !== "") return undefined;
  const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const host = parsed.hostname.toLowerCase();
  const isRepoPage =
    host === "github.com"
      ? segments.length === 2
      : host === "gitlab.com"
        ? segments.length >= 2 && segments[0] !== "api" && !segments.includes("-")
        : false;
  return isRepoPage ? `${url.replace(/\/+$/, "")}.git` : undefined;
}

function inferNameFromPathLike(pathLike: string): string {
  const base = basename(pathLike.replace(/\/$/, "")).replace(/\.git$/, "");
  return base === "marketplace.json" ? basename(dirname(pathLike)) : base;
}

/**
 * Every marketplace source type Claude Code itself accepts in `extraKnownMarketplaces` (see
 * https://code.claude.com/docs/en/plugins/marketplace-reference#marketplace-sources), plus `local` —
 * the shape older versions of this tool wrote for a path spec, which Claude Code has no schema for
 * (see upgradeLegacyMarketplaceSource).
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

/**
 * Rewrites a source stored by an older version of this tool into the shape Claude Code accepts —
 * what parseMarketplaceSpec produces today for the same spec:
 * - `local` → `file` for a `.json` path, otherwise `directory`. The path is kept as stored, since the
 *   cwd a relative one was typed in is unknown.
 * - `github` with `repo: "owner/repo@ref"` → `{ repo, ref }`.
 * - `git` with `url: "…#ref"` → `{ url, ref }`.
 *
 * Every other field is preserved, and anything already current — or unrecognized — is returned
 * as-is (the same reference), so applying it twice changes nothing. Applied wherever stored sources
 * are read (`normalizeModule`, `MarketplaceRegistry`, `create --from-scope`), never written back on
 * its own: the next ordinary save persists the new shape.
 */
export function upgradeLegacyMarketplaceSource(source: MarketplaceSource): MarketplaceSource {
  const inner = innerSource(source);
  if (inner === undefined) return source;
  const upgraded = upgradeLegacyInner(inner);
  return upgraded === inner ? source : { ...(source as Record<string, unknown>), source: upgraded };
}

function upgradeLegacyInner(inner: Record<string, unknown>): Record<string, unknown> {
  switch (inner.source) {
    case "local": {
      const path = stringField(inner, "path");
      return path === undefined ? inner : { ...inner, source: path.endsWith(".json") ? "file" : "directory" };
    }
    case "github": {
      const repo = stringField(inner, "repo");
      if (repo === undefined || inner.ref !== undefined) return inner;
      const match = SHORTHAND_WITH_REF.exec(repo);
      const [, bareRepo, ref] = match ?? [];
      return bareRepo !== undefined && ref !== undefined && GITHUB_SHORTHAND.test(bareRepo)
        ? { ...inner, repo: bareRepo, ref }
        : inner;
    }
    case "git": {
      const url = stringField(inner, "url");
      if (url === undefined || inner.ref !== undefined) return inner;
      const [base, ref] = splitRef(url);
      return ref === undefined ? inner : { ...inner, url: base, ref };
    }
    default:
      return inner;
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

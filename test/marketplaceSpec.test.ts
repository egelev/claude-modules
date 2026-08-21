import { describe, expect, it } from "vitest";
import { parseMarketplaceSpec } from "../src/core/marketplaceSpec.js";

describe("parseMarketplaceSpec", () => {
  describe("bare GitHub shorthand", () => {
    it("recognizes owner/repo and infers the repo name", () => {
      expect(parseMarketplaceSpec("owner/repo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo" } },
      });
    });
  });

  describe("@ref-pinned GitHub shorthand", () => {
    it("stores the whole spec, including @ref, verbatim in repo", () => {
      expect(parseMarketplaceSpec("owner/repo@v2.0")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo@v2.0" } },
      });
    });

    it("infers the name from the part before @, excluding the ref", () => {
      // A naive `spec.split("/")[1]` (what bare shorthand uses) would give "repo@v2.0" here.
      expect(parseMarketplaceSpec("owner/repo@v2.0").inferredName).toBe("repo");
    });

    it("supports a ref that itself contains a slash, like a branch name", () => {
      expect(parseMarketplaceSpec("owner/repo@feature/foo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo@feature/foo" } },
      });
    });

    it("treats a trailing bare @ with an empty ref as a valid degenerate pin", () => {
      expect(parseMarketplaceSpec("owner/repo@")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo@" } },
      });
    });

    it("does not mistake a spec with no @ at all for an @ref pin", () => {
      // Regression guard: a naive `spec.slice(0, spec.indexOf("@"))` without checking indexOf's -1
      // result first would slice(0, -1) here, dropping the trailing "/" and spuriously matching
      // GITHUB_SHORTHAND — silently turning this local path into a github source.
      expect(parseMarketplaceSpec("owner/repo/")).toEqual({
        inferredName: "repo",
        source: { source: { source: "local", path: "owner/repo/" } },
      });
    });
  });

  describe("full git URL", () => {
    it("recognizes an https git URL", () => {
      expect(parseMarketplaceSpec("https://example.com/mp.git")).toEqual({
        inferredName: "mp",
        source: { source: { source: "git", url: "https://example.com/mp.git" } },
      });
    });

    it("recognizes a git URL pinned with a trailing #ref, stored verbatim in url", () => {
      expect(parseMarketplaceSpec("https://example.com/mp.git#v1.2.3")).toEqual({
        inferredName: "mp",
        source: { source: { source: "git", url: "https://example.com/mp.git#v1.2.3" } },
      });
    });

    it("recognizes an ssh git@ URL", () => {
      expect(parseMarketplaceSpec("git@github.com:owner/repo.git")).toEqual({
        inferredName: "repo",
        source: { source: { source: "git", url: "git@github.com:owner/repo.git" } },
      });
    });

    it("does not mistake a URL with embedded userinfo for @ref-pinned shorthand", () => {
      // "https://user@github.com/..." contains an "@", but everything before it ("https://user")
      // fails GITHUB_SHORTHAND — the "://" breaks the required single-slash-flanked-by-word-chars
      // shape — so this must still fall through to the git-URL branch below.
      expect(parseMarketplaceSpec("https://user@github.com/owner/repo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "git", url: "https://user@github.com/owner/repo" } },
      });
    });
  });

  describe("shorthand with a rejected #ref fragment", () => {
    it("throws, recommending '@ref' pinning and the equivalent full git URL", () => {
      expect(() => parseMarketplaceSpec("owner/repo#v2.0")).toThrow("@ref");
      expect(() => parseMarketplaceSpec("owner/repo#v2.0")).toThrow("owner/repo@v2.0");
      expect(() => parseMarketplaceSpec("owner/repo#v2.0")).toThrow(
        "https://github.com/owner/repo.git#v2.0"
      );
    });
  });

  describe("local path fallback", () => {
    it("falls back to a local path for anything that isn't shorthand, a URL, or an ssh URL", () => {
      expect(parseMarketplaceSpec("./relative/path")).toEqual({
        inferredName: "path",
        source: { source: { source: "local", path: "./relative/path" } },
      });
    });

    it("infers the name from the parent directory when the path points at marketplace.json", () => {
      expect(parseMarketplaceSpec("/some/dir/marketplace.json")).toEqual({
        inferredName: "dir",
        source: { source: { source: "local", path: "/some/dir/marketplace.json" } },
      });
    });

    it("falls back to local for a spec containing '@' that isn't GitHub-shorthand-shaped before it", () => {
      expect(parseMarketplaceSpec("owner@weird")).toEqual({
        inferredName: "owner@weird",
        source: { source: { source: "local", path: "owner@weird" } },
      });
    });

    it("falls back to local, keeping the #fragment in path, for a #-bearing spec that isn't shorthand-shaped before the #", () => {
      // Exercises the throw condition's other half: spec !== withoutFragment (true) but
      // GITHUB_SHORTHAND.test(withoutFragment) (false) — must fall through, not throw — and, like
      // the git branch's `url`, keeps the #fragment verbatim in `path` even though the *name* is
      // inferred from the part before it.
      expect(parseMarketplaceSpec("./some/path#fragment")).toEqual({
        inferredName: "path",
        source: { source: { source: "local", path: "./some/path#fragment" } },
      });
    });
  });
});

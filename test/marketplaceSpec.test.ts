import { describe, expect, it } from "vitest";
import {
  classifyMarketplaceSource,
  marketplacePortability,
  parseMarketplaceSpec,
  upgradeLegacyMarketplaceSource,
} from "../src/core/marketplaceSpec.js";

describe("parseMarketplaceSpec", () => {
  // Fixed so path resolution is deterministic; the shapes mirror Claude Code 2.1.295's own
  // `claude plugin marketplace add` parser.
  const options = { cwd: "/work/repo", home: "/home/me" };
  const parse = (spec: string) => parseMarketplaceSpec(spec, options);

  describe("GitHub shorthand", () => {
    it("recognizes owner/repo and infers the repo name", () => {
      expect(parse("owner/repo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo" } },
      });
    });

    it("stores an @ref pin in its own ref field, not in repo", () => {
      // Claude Code clones `github.com/<repo>.git` verbatim, so 'owner/repo@v2.0' in repo can't work.
      expect(parse("owner/repo@v2.0")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo", ref: "v2.0" } },
      });
    });

    it("accepts a #ref pin the same way, as Claude Code does", () => {
      expect(parse("owner/repo#v2.0")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo", ref: "v2.0" } },
      });
    });

    it("supports a ref that itself contains a slash, like a branch name", () => {
      expect(parse("owner/repo@feature/foo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "github", repo: "owner/repo", ref: "feature/foo" } },
      });
    });

    it("rejects an empty trailing ref instead of storing it", () => {
      expect(() => parse("owner/repo@")).toThrow("empty ref");
      expect(() => parse("owner/repo#")).toThrow("empty ref");
    });
  });

  describe("http(s) URLs", () => {
    it("recognizes a .git clone URL", () => {
      expect(parse("https://example.com/mp.git")).toEqual({
        inferredName: "mp",
        source: { source: { source: "git", url: "https://example.com/mp.git" } },
      });
    });

    it("splits a trailing #ref off a clone URL into its own ref field", () => {
      expect(parse("https://example.com/mp.git#v1.2.3")).toEqual({
        inferredName: "mp",
        source: { source: { source: "git", url: "https://example.com/mp.git", ref: "v1.2.3" } },
      });
    });

    it("treats an Azure DevOps /_git/ URL as a clone URL", () => {
      expect(parse("https://dev.azure.com/org/project/_git/mp")).toMatchObject({
        source: { source: { source: "git", url: "https://dev.azure.com/org/project/_git/mp" } },
      });
    });

    it("turns a github.com or gitlab.com repo page into a .git clone URL", () => {
      expect(parse("https://github.com/owner/repo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "git", url: "https://github.com/owner/repo.git" } },
      });
      expect(parse("https://github.com/owner/repo/#main")).toEqual({
        inferredName: "repo",
        source: { source: { source: "git", url: "https://github.com/owner/repo.git", ref: "main" } },
      });
      expect(parse("https://gitlab.com/group/sub/project")).toMatchObject({
        source: { source: { source: "git", url: "https://gitlab.com/group/sub/project.git" } },
      });
    });

    it("keeps userinfo in a github.com repo URL rather than mistaking it for an @ref pin", () => {
      expect(parse("https://user@github.com/owner/repo")).toEqual({
        inferredName: "repo",
        source: { source: { source: "git", url: "https://user@github.com/owner/repo.git" } },
      });
    });

    it("treats any other URL as a hosted marketplace.json, inferring the name from its directory", () => {
      expect(parse("https://example.com/plugins/marketplace.json")).toEqual({
        inferredName: "plugins",
        source: { source: { source: "url", url: "https://example.com/plugins/marketplace.json" } },
      });
      expect(parse("https://github.com/owner/repo/raw/main/marketplace.json")).toMatchObject({
        source: { source: { source: "url" } },
      });
    });
  });

  describe("ssh git URLs", () => {
    it("recognizes a user@host:path URL", () => {
      expect(parse("git@github.com:owner/repo.git")).toEqual({
        inferredName: "repo",
        source: { source: { source: "git", url: "git@github.com:owner/repo.git" } },
      });
    });

    it("splits a trailing #ref into its own ref field", () => {
      expect(parse("git@gitlab.example.com:team/mp.git#main")).toEqual({
        inferredName: "mp",
        source: { source: { source: "git", url: "git@gitlab.example.com:team/mp.git", ref: "main" } },
      });
    });
  });

  describe("paths", () => {
    it("stores a relative ./ path as an absolute directory source", () => {
      expect(parse("./relative/path")).toEqual({
        inferredName: "path",
        source: { source: { source: "directory", path: "/work/repo/relative/path" } },
      });
    });

    it("checks explicit paths before shorthand, so ./plugins isn't read as a GitHub repo", () => {
      // '.' is a valid owner character, so './plugins' also matches the owner/repo shape.
      expect(parse("./plugins")).toEqual({
        inferredName: "plugins",
        source: { source: { source: "directory", path: "/work/repo/plugins" } },
      });
      expect(parse("../plugins")).toMatchObject({
        source: { source: { source: "directory", path: "/work/plugins" } },
      });
    });

    it("expands a leading ~ to the home directory", () => {
      expect(parse("~/marketplaces/mine")).toEqual({
        inferredName: "mine",
        source: { source: { source: "directory", path: "/home/me/marketplaces/mine" } },
      });
    });

    it("stores a .json path as a file source, inferring the name from its directory", () => {
      expect(parse("/some/dir/marketplace.json")).toEqual({
        inferredName: "dir",
        source: { source: { source: "file", path: "/some/dir/marketplace.json" } },
      });
    });

    it("keeps a #fragment as part of a path, as Claude Code does, but not of the inferred name", () => {
      expect(parse("./some/path#fragment")).toEqual({
        inferredName: "path",
        source: { source: { source: "directory", path: "/work/repo/some/path#fragment" } },
      });
    });

    it("still treats anything else as a path relative to cwd, now in a shape Claude Code accepts", () => {
      expect(parse("owner@weird")).toEqual({
        inferredName: "owner@weird",
        source: { source: { source: "directory", path: "/work/repo/owner@weird" } },
      });
      expect(parse("owner/repo/")).toEqual({
        inferredName: "repo",
        source: { source: { source: "directory", path: "/work/repo/owner/repo" } },
      });
    });
  });
});

describe("upgradeLegacyMarketplaceSource", () => {
  it("turns a legacy local directory into a directory source, keeping its path as stored", () => {
    expect(upgradeLegacyMarketplaceSource({ source: { source: "local", path: "./plugins" } })).toEqual({
      source: { source: "directory", path: "./plugins" },
    });
  });

  it("turns a legacy local .json path into a file source", () => {
    expect(upgradeLegacyMarketplaceSource({ source: { source: "local", path: "/mp/marketplace.json" } })).toEqual({
      source: { source: "file", path: "/mp/marketplace.json" },
    });
  });

  it("moves an @ref out of a github repo, and a #ref out of a git url, into ref", () => {
    expect(upgradeLegacyMarketplaceSource({ source: { source: "github", repo: "owner/repo@v2.0" } })).toEqual({
      source: { source: "github", repo: "owner/repo", ref: "v2.0" },
    });
    expect(upgradeLegacyMarketplaceSource({ source: { source: "git", url: "https://x.example/mp.git#main" } })).toEqual(
      { source: { source: "git", url: "https://x.example/mp.git", ref: "main" } }
    );
  });

  it("preserves every other field, inside and outside source", () => {
    expect(
      upgradeLegacyMarketplaceSource({
        source: { source: "github", repo: "owner/repo@v2", sparsePaths: ["plugins"] },
        autoUpdate: true,
      })
    ).toEqual({ source: { source: "github", repo: "owner/repo", ref: "v2", sparsePaths: ["plugins"] }, autoUpdate: true });
  });

  it("returns current and unrecognized shapes unchanged — the same reference", () => {
    const current = [
      { source: { source: "github", repo: "owner/repo", ref: "v2" } },
      { source: { source: "git", url: "https://x.example/mp.git" } },
      { source: { source: "directory", path: "/mp" } },
      { source: { source: "settings", name: "mp", plugins: [] } },
      { nope: true },
    ];
    for (const source of current) {
      expect(upgradeLegacyMarketplaceSource(source)).toBe(source);
    }
    expect(upgradeLegacyMarketplaceSource(undefined)).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = upgradeLegacyMarketplaceSource({ source: { source: "local", path: "/mp" } });
    expect(upgradeLegacyMarketplaceSource(once)).toBe(once);
  });
});

describe("classifyMarketplaceSource", () => {
  it("recognizes every source type Claude Code accepts, plus this tool's own 'local'", () => {
    for (const kind of ["github", "git", "url", "settings", "directory", "file", "local"]) {
      expect(classifyMarketplaceSource({ source: { source: kind } })).toBe(kind);
    }
  });

  it("is unrecognized for anything else", () => {
    expect(classifyMarketplaceSource({ source: { source: "npm" } })).toBe("unrecognized");
    expect(classifyMarketplaceSource({ source: "github" })).toBe("unrecognized");
    expect(classifyMarketplaceSource({ nope: true })).toBe("unrecognized");
    expect(classifyMarketplaceSource(undefined)).toBe("unrecognized");
  });
});

describe("marketplacePortability", () => {
  it("treats remote sources and an inline settings catalog as portable", () => {
    expect(marketplacePortability({ source: { source: "github", repo: "owner/repo" } })).toBe("portable");
    expect(marketplacePortability({ source: { source: "settings", name: "mp", plugins: [] } })).toBe("portable");
    expect(marketplacePortability({ source: { source: "url", url: "https://example.com/marketplace.json" } })).toBe(
      "portable"
    );
    expect(marketplacePortability({ source: { source: "git", url: "https://example.com/mp.git" } })).toBe("portable");
    expect(marketplacePortability({ source: { source: "git", url: "git@example.com:team/mp.git" } })).toBe("portable");
  });

  it("treats sources that name a path on this machine as machine-specific", () => {
    expect(marketplacePortability({ source: { source: "directory", path: "/home/someone/mp" } })).toBe(
      "machine-specific"
    );
    expect(marketplacePortability({ source: { source: "file", path: "/home/someone/marketplace.json" } })).toBe(
      "machine-specific"
    );
    expect(marketplacePortability({ source: { source: "local", path: "/home/someone/mp" } })).toBe("machine-specific");
    expect(marketplacePortability({ source: { source: "git", url: "file:///home/someone/mp.git" } })).toBe(
      "machine-specific"
    );
    expect(marketplacePortability({ source: { source: "git", url: "/home/someone/mp.git" } })).toBe("machine-specific");
  });

  it("stays unrecognized for unfamiliar or malformed shapes, rather than guessing", () => {
    expect(marketplacePortability({ nope: true })).toBe("unrecognized");
    expect(marketplacePortability({ source: { source: "git" } })).toBe("unrecognized");
    expect(marketplacePortability({ source: { source: "url" } })).toBe("unrecognized");
  });
});

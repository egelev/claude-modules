import { describe, expect, it } from "vitest";
import { bumpMinor, bumpPatch } from "../src/core/semver.js";

describe("bumpPatch", () => {
  it("increments the patch component", () => {
    expect(bumpPatch("1.0.0")).toBe("1.0.1");
    expect(bumpPatch("1.0.9")).toBe("1.0.10");
  });

  it("leaves major/minor untouched", () => {
    expect(bumpPatch("2.3.4")).toBe("2.3.5");
  });

  it("treats a missing/malformed version as 1.0.0 before bumping", () => {
    expect(bumpPatch("")).toBe("1.0.1");
    expect(bumpPatch("not-a-version")).toBe("1.0.1");
    expect(bumpPatch("1.0")).toBe("1.0.1");
  });
});

describe("bumpMinor", () => {
  it("increments minor and resets patch to 0", () => {
    expect(bumpMinor("1.0.5")).toBe("1.1.0");
    expect(bumpMinor("2.9.0")).toBe("2.10.0");
  });

  it("treats a missing/malformed version as 1.0.0 before bumping", () => {
    expect(bumpMinor("")).toBe("1.1.0");
    expect(bumpMinor("garbage")).toBe("1.1.0");
  });
});

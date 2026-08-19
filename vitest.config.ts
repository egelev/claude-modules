import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Each test drives the real Cli against real temp directories, so tests must not share a
    // process-wide cwd/env or a captured stdout. One file at a time keeps that isolation cheap.
    fileParallelism: false,
    // Plain-substring assertions on colored output rely on picocolors staying color-off under
    // vitest (true today because stdout isn't a TTY); pin it explicitly so a future CI workflow
    // (picocolors treats env.CI as color-on) can't flip these tests color-on silently.
    env: { NO_COLOR: "1" },
  },
});

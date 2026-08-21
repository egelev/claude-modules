import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const INSTALL_TIMEOUT_MS = 120_000;
const STDERR_PREVIEW_LENGTH = 300;

/** `stdout` is captured because read-only queries (`plugin list --json`) need it; installs ignore it. */
export type ClaudeRunResult = { ok: true; stdout: string } | { ok: false; detail: string };

/** Runs `claude <args>`, inheriting `env`. Swaps out in tests to avoid a real `claude` binary. */
export type ClaudeRunner = (args: string[], env: NodeJS.ProcessEnv) => Promise<ClaudeRunResult>;

export async function defaultClaudeRunner(args: string[], env: NodeJS.ProcessEnv): Promise<ClaudeRunResult> {
  try {
    const { stdout } = await execFileAsync("claude", args, { env, timeout: INSTALL_TIMEOUT_MS });
    return { ok: true, stdout };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string };
    if (nodeErr.code === "ENOENT") {
      return { ok: false, detail: "'claude' not found on PATH" };
    }
    if (nodeErr.killed || nodeErr.signal === "SIGTERM") {
      return { ok: false, detail: `timed out after ${INSTALL_TIMEOUT_MS / 1000}s` };
    }
    const stderr = (nodeErr.stderr ?? nodeErr.message ?? "").trim().slice(0, STDERR_PREVIEW_LENGTH);
    return { ok: false, detail: stderr || "unknown error" };
  }
}

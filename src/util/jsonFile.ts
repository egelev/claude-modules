import { readFile } from "node:fs/promises";
import { InvalidJsonError } from "./errors.js";

/**
 * Reads and JSON-parses `path`, treating a missing file as `onMissing()` rather than an error, and
 * wrapping a parse failure in a typed `InvalidJsonError` labeled with `errorLabel`. `isMissingError`
 * defaults to ENOENT; pass a broader predicate (e.g. also ENOTDIR) for callers that need one.
 */
export async function readOptionalJsonFile<T>(
  path: string,
  onMissing: () => T,
  errorLabel: string,
  isMissingError: (err: NodeJS.ErrnoException) => boolean = (err) => err.code === "ENOENT"
): Promise<T> {
  const raw = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (isMissingError(err)) return null;
    throw err;
  });
  if (raw === null) return onMissing();
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new InvalidJsonError(errorLabel, err);
  }
}

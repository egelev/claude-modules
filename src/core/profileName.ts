import { InvalidProfileNameError } from "../util/errors.js";

/** Profile names are used as filesystem path segments; reject anything that could escape the profiles directory. */
export function validateProfileName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new InvalidProfileNameError(name);
  }
}

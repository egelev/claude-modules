import { InvalidModuleNameError } from "../util/errors.js";

/** Module names are used as filesystem path segments; reject anything that could escape the modules directory. */
export function validateModuleName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new InvalidModuleNameError(name);
  }
}

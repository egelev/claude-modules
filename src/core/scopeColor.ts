import pc from "picocolors";
import { Scope } from "./types.js";

const SCOPE_COLOR: Record<Scope, (s: string) => string> = {
  [Scope.Local]: pc.green,
  [Scope.Project]: pc.blueBright,
  [Scope.User]: pc.magenta,
};

export function colorScope(scope: Scope): string {
  return SCOPE_COLOR[scope](scope);
}

import { InvalidPluginKeyError } from "../util/errors.js";

export interface PluginKey {
  full: string;
  plugin: string;
  marketplace: string;
}

/** Parses a "<plugin-name>@<marketplace-name>" key, matching the shape used in settings.json's enabledPlugins. */
export function parsePluginKey(key: string): PluginKey {
  const atIndex = key.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === key.length - 1) {
    throw new InvalidPluginKeyError(key);
  }
  return { full: key, plugin: key.slice(0, atIndex), marketplace: key.slice(atIndex + 1) };
}

/** The marketplace part of a plugin key, or undefined for a malformed one — for code reading keys out
 * of hand-editable settings files, where a stray bad key mustn't throw mid-report. */
export function marketplaceOfPluginKey(key: string): string | undefined {
  try {
    return parsePluginKey(key).marketplace;
  } catch {
    return undefined;
  }
}

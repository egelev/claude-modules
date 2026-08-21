import { stat } from "node:fs/promises";

export async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((s) => s.isFile())
    .catch(() => false);
}

export async function isDirectory(path: string): Promise<boolean> {
  return stat(path)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

export async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();

export const dataRoot = join(root, "data", "clients");

export function clientDir(clientId: string): string {
  return join(dataRoot, clientId);
}

export function clientFile(clientId: string, fileName: string): string {
  return join(clientDir(clientId), fileName);
}

export async function ensureClientDirectories(clientId: string): Promise<void> {
  const dirs = [
    clientDir(clientId),
    join(clientDir(clientId), "reports", "daily"),
    join(clientDir(clientId), "reports", "weekly"),
    join(clientDir(clientId), "assets", "raw"),
    join(clientDir(clientId), "assets", "videos"),
    join(clientDir(clientId), "assets", "images"),
    join(clientDir(clientId), "assets", "audio"),
    join(clientDir(clientId), "exports", "instagram"),
    join(clientDir(clientId), "exports", "tiktok"),
    join(clientDir(clientId), "exports", "facebook"),
    join(clientDir(clientId), "exports", "x")
  ];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJson<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readClientArray<T>(clientId: string, fileName: string): Promise<T[]> {
  return readJson<T[]>(clientFile(clientId, fileName), []);
}

export async function writeClientArray<T>(clientId: string, fileName: string, value: T[]): Promise<void> {
  await writeJson(clientFile(clientId, fileName), value);
}

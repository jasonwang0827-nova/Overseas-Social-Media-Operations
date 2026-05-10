import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface XApiConfig {
  bearerToken: string | null;
  dryRun: boolean;
}

export interface XApiRequestOptions {
  mode: "mock" | "api";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  clientId?: string;
  costUnits?: number;
  cacheTtlHours?: number;
}

export interface XApiUsageStats {
  apiCalls: number;
  cacheHits: number;
  estimatedCost: number;
}

interface XApiUsageEntry {
  timestamp: string;
  client_id: string;
  method: "GET";
  path: string;
  url: string;
  cost_units: number;
  cache_hit: boolean;
}

const stats: XApiUsageStats = {
  apiCalls: 0,
  cacheHits: 0,
  estimatedCost: 0
};

export async function xApiGet(options: XApiRequestOptions): Promise<Record<string, unknown>> {
  const config = await loadXApiConfig();
  if (options.mode === "mock") {
    return {};
  }
  if (!config.bearerToken) {
    throw new Error("X_BEARER_TOKEN is missing. Add it to XAPI.env to use X read APIs, or run with --mode mock.");
  }
  const url = new URL(`https://api.x.com${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const ttlHours = options.cacheTtlHours ?? 24;
  const cached = await readCachedResponse(url.toString(), ttlHours);
  if (cached) {
    stats.cacheHits += 1;
    return cached;
  }
  const costUnits = options.costUnits ?? 1;
  if (options.clientId) {
    await assertMonthlyBudget(options.clientId, costUnits);
  }
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${config.bearerToken}`
    }
  });
  const text = await response.text();
  const body = parseJsonObject(text);
  if (!response.ok) {
    throw new Error(`X API GET ${options.path} failed (${response.status}): ${extractXError(body, text)}`);
  }
  const result = body ?? {};
  await writeCachedResponse(url.toString(), result);
  if (options.clientId) {
    await recordUsage({
      timestamp: new Date().toISOString(),
      client_id: options.clientId,
      method: "GET",
      path: options.path,
      url: url.toString(),
      cost_units: costUnits,
      cache_hit: false
    });
  }
  stats.apiCalls += 1;
  stats.estimatedCost += costUnits;
  return result;
}

export function resetXApiUsageStats(): void {
  stats.apiCalls = 0;
  stats.cacheHits = 0;
  stats.estimatedCost = 0;
}

export function getXApiUsageStats(): XApiUsageStats {
  return { ...stats };
}

export async function loadXApiConfig(): Promise<XApiConfig> {
  const values = {
    ...(await readEnvFile(".env.local")),
    ...(await readEnvFile("XAPI.env")),
    ...readProcessEnv()
  };
  return {
    bearerToken: values.X_BEARER_TOKEN || values.X_BEARER || null,
    dryRun: values.X_API_DRY_RUN !== "false"
  };
}

function readProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

async function readEnvFile(fileName: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(join(process.cwd(), fileName), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function parseEnv(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 1) continue;
    parsed[line.slice(0, equalsIndex).trim()] = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return parsed;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractXError(body: Record<string, unknown> | null, fallback: string): string {
  if (!body) return fallback.slice(0, 500);
  if (Array.isArray(body.errors)) return body.errors.map((error) => JSON.stringify(error)).join("; ").slice(0, 500);
  if (typeof body.detail === "string") return body.detail;
  if (typeof body.title === "string") return body.title;
  return JSON.stringify(body).slice(0, 500);
}

async function readCachedResponse(url: string, ttlHours: number): Promise<Record<string, unknown> | null> {
  const cache = await readCacheFile(url);
  if (!cache) return null;
  const ageMs = Date.now() - Date.parse(String(cache.cached_at ?? ""));
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlHours * 60 * 60 * 1000) return null;
  const body = cache.body;
  return typeof body === "object" && body !== null ? body as Record<string, unknown> : null;
}

async function readCacheFile(url: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(cachePath(url), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeCachedResponse(url: string, body: Record<string, unknown>): Promise<void> {
  const path = cachePath(url);
  await mkdir(join(process.cwd(), "data", "cache", "x-api"), { recursive: true });
  await writeFile(path, `${JSON.stringify({ cached_at: new Date().toISOString(), url, body }, null, 2)}\n`, "utf8");
}

function cachePath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return join(process.cwd(), "data", "cache", "x-api", `${hash}.json`);
}

async function assertMonthlyBudget(clientId: string, nextCost: number): Promise<void> {
  const client = await readJsonObject(join(process.cwd(), "data", "clients", clientId, "client.json"));
  const budget = Number(client?.monthly_api_budget ?? 0);
  if (!Number.isFinite(budget) || budget <= 0) return;
  const usage = await readUsage(clientId);
  const month = new Date().toISOString().slice(0, 7);
  const used = usage
    .filter((entry) => entry.timestamp.startsWith(month))
    .reduce((total, entry) => total + entry.cost_units, 0);
  if (used + nextCost > budget) {
    throw new Error(`X monthly API budget exceeded for ${clientId}: used=${used}, next=${nextCost}, budget=${budget}`);
  }
}

async function recordUsage(entry: XApiUsageEntry): Promise<void> {
  const usage = await readUsage(entry.client_id);
  usage.push(entry);
  const path = usagePath(entry.client_id);
  await mkdir(join(process.cwd(), "data", "clients", entry.client_id), { recursive: true });
  await writeFile(path, `${JSON.stringify(usage, null, 2)}\n`, "utf8");
}

async function readUsage(clientId: string): Promise<XApiUsageEntry[]> {
  try {
    const raw = await readFile(usagePath(clientId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as XApiUsageEntry[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function usagePath(clientId: string): string {
  return join(process.cwd(), "data", "clients", clientId, "x-api-usage.json");
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

import type { PlatformAccount } from "../../core/types.js";
import { loadMetaEnv } from "./foundation.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface FacebookGraphConfig {
  graphVersion: string;
  accessToken: string;
  pageAccessToken: string;
  pageId: string | null;
}

export async function loadFacebookGraphConfig(account?: PlatformAccount): Promise<FacebookGraphConfig> {
  const env = await loadMetaEnv();
  const vault = await readMetaToken(account?.meta_binding?.token_ref);
  const accessToken = vault?.page_access_token || vault?.access_token || env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN || env.META_USER_ACCESS_TOKEN || "";
  const pageAccessToken = vault?.page_access_token || env.META_PAGE_ACCESS_TOKEN || accessToken;
  return {
    graphVersion: env.META_GRAPH_API_VERSION || "v25.0",
    accessToken,
    pageAccessToken,
    pageId: realValue(account?.meta_binding?.page_id) || vault?.page_id || env.META_PAGE_ID || env.META_FACEBOOK_PAGE_ID || null
  };
}

export async function facebookGraphGet(path: string, query: Record<string, string | number | boolean | undefined> = {}, token?: string): Promise<Record<string, unknown>> {
  const config = await loadFacebookGraphConfig();
  const accessToken = token || config.pageAccessToken || config.accessToken;
  if (!accessToken) throw new Error("Meta access token missing. Add META_PAGE_ACCESS_TOKEN or META_ACCESS_TOKEN to MetaAPI.env.");
  const url = graphUrl(config.graphVersion, path);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  return parseGraphResponse(response, path);
}

export async function facebookGraphPost(path: string, body: Record<string, string | number | boolean | undefined>, token?: string): Promise<Record<string, unknown>> {
  const config = await loadFacebookGraphConfig();
  const accessToken = token || config.pageAccessToken || config.accessToken;
  if (!accessToken) throw new Error("Meta access token missing. Add META_PAGE_ACCESS_TOKEN or META_ACCESS_TOKEN to MetaAPI.env.");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) if (value !== undefined) params.set(key, String(value));
  params.set("access_token", accessToken);
  const response = await fetch(graphUrl(config.graphVersion, path), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  return parseGraphResponse(response, path);
}

export async function sendFacebookPageMessage(pageId: string, recipientId: string, message: string, token?: string): Promise<Record<string, unknown>> {
  return facebookGraphPost(`/${pageId}/messages`, {
    messaging_type: "RESPONSE",
    recipient: JSON.stringify({ id: recipientId }),
    message: JSON.stringify({ text: message })
  }, token);
}

function realValue(value: string | undefined): string | null {
  if (!value || value.startsWith("future_")) return null;
  return value;
}

async function readMetaToken(tokenRef: string | undefined): Promise<Record<string, string> | null> {
  if (!tokenRef) return null;
  try {
    const raw = await readFile(join(process.cwd(), "data", "token-vault", "meta", `${tokenRef.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, string> : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function graphUrl(version: string, path: string): URL {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`https://graph.facebook.com/${version}${cleanPath}`);
}

async function parseGraphResponse(response: Response, path: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = parseJsonObject(text) ?? {};
  if (!response.ok) throw new Error(`Meta Graph API ${path} failed (${response.status}): ${extractGraphError(body, text)}`);
  return body;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractGraphError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (typeof error === "object" && error !== null) return JSON.stringify(error).slice(0, 800);
  return JSON.stringify(body).slice(0, 800) || fallback.slice(0, 800);
}

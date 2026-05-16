import type { PlatformAccount } from "../../core/types.js";
import { loadMetaEnv } from "./foundation.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface InstagramGraphConfig {
  graphVersion: string;
  accessToken: string;
  pageAccessToken: string;
  igUserId: string | null;
  pageId: string | null;
}

export interface InstagramPublishInput {
  igUserId: string;
  caption?: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: "IMAGE" | "VIDEO" | "REELS" | "STORIES";
}

export interface InstagramCarouselPublishInput {
  igUserId: string;
  caption?: string;
  imageUrls: string[];
}

export async function loadInstagramGraphConfig(account?: PlatformAccount): Promise<InstagramGraphConfig> {
  const env = await loadMetaEnv();
  const vault = await readMetaToken(account?.meta_binding?.token_ref);
  const accessToken = vault?.page_access_token || vault?.access_token || env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN || env.META_USER_ACCESS_TOKEN || "";
  const pageAccessToken = vault?.page_access_token || env.META_PAGE_ACCESS_TOKEN || accessToken;
  return {
    graphVersion: env.META_GRAPH_API_VERSION || "v23.0",
    accessToken,
    pageAccessToken,
    igUserId: realValue(account?.meta_binding?.instagram_business_account_id) || vault?.instagram_business_account_id || env.META_IG_USER_ID || env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID || null,
    pageId: realValue(account?.meta_binding?.connected_facebook_page_id) || vault?.page_id || env.META_PAGE_ID || env.META_FACEBOOK_PAGE_ID || null
  };
}

export async function instagramGraphGet(path: string, query: Record<string, string | number | boolean | undefined> = {}, token?: string): Promise<Record<string, unknown>> {
  const config = await loadInstagramGraphConfig();
  const accessToken = token || config.accessToken;
  if (!accessToken) throw new Error("Meta access token missing. Add META_PAGE_ACCESS_TOKEN or META_ACCESS_TOKEN to MetaAPI.env.");
  const url = graphUrl(config.graphVersion, path);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  return parseGraphResponse(response, path);
}

export async function instagramGraphPost(path: string, body: Record<string, string | number | boolean | undefined>, token?: string): Promise<Record<string, unknown>> {
  const config = await loadInstagramGraphConfig();
  const accessToken = token || config.accessToken;
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

export async function publishInstagramMedia(input: InstagramPublishInput, token?: string): Promise<{ creation_id: string; media_id: string; raw: Record<string, unknown> }> {
  const createBody: Record<string, string | undefined> = {
    caption: input.caption,
    media_type: input.mediaType && input.mediaType !== "IMAGE" ? input.mediaType : undefined,
    image_url: input.imageUrl,
    video_url: input.videoUrl
  };
  const created = await instagramGraphPost(`/${input.igUserId}/media`, createBody, token);
  const creationId = typeof created.id === "string" ? created.id : null;
  if (!creationId) throw new Error(`Instagram media container creation did not return id: ${JSON.stringify(created)}`);
  const published = await instagramGraphPost(`/${input.igUserId}/media_publish`, { creation_id: creationId }, token);
  const mediaId = typeof published.id === "string" ? published.id : null;
  if (!mediaId) throw new Error(`Instagram media_publish did not return id: ${JSON.stringify(published)}`);
  return { creation_id: creationId, media_id: mediaId, raw: published };
}

export async function publishInstagramCarousel(input: InstagramCarouselPublishInput, token?: string): Promise<{ creation_id: string; media_id: string; children: string[]; raw: Record<string, unknown> }> {
  const imageUrls = input.imageUrls.map((item) => item.trim()).filter(Boolean);
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(`Instagram carousel requires 2 to 10 image URLs. Received ${imageUrls.length}.`);
  }

  const children: string[] = [];
  for (const imageUrl of imageUrls) {
    const child = await instagramGraphPost(`/${input.igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: true
    }, token);
    const childId = typeof child.id === "string" ? child.id : null;
    if (!childId) throw new Error(`Instagram carousel item creation did not return id: ${JSON.stringify(child)}`);
    children.push(childId);
  }

  const created = await instagramGraphPost(`/${input.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: input.caption
  }, token);
  const creationId = typeof created.id === "string" ? created.id : null;
  if (!creationId) throw new Error(`Instagram carousel container creation did not return id: ${JSON.stringify(created)}`);

  const published = await instagramGraphPost(`/${input.igUserId}/media_publish`, { creation_id: creationId }, token);
  const mediaId = typeof published.id === "string" ? published.id : null;
  if (!mediaId) throw new Error(`Instagram carousel media_publish did not return id: ${JSON.stringify(published)}`);
  return { creation_id: creationId, media_id: mediaId, children, raw: published };
}

export async function sendInstagramDm(pageId: string, recipientId: string, message: string, token?: string): Promise<Record<string, unknown>> {
  return instagramGraphPost(`/${pageId}/messages`, {
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

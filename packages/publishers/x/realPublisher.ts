import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { PlatformVariant, PublishTask } from "../../core/types.js";
import { createMockPublisher } from "../mockPublisher.js";
import type { Publisher, PublishResult } from "../types.js";
import { readXUserToken } from "./accountAuth.js";

interface XCredentials {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
  dryRun: boolean;
}

const mockXPublisher = createMockPublisher("x");

export const xRealPublisher: Publisher = {
  async publish(task: PublishTask, variant: PlatformVariant): Promise<PublishResult> {
    if (task.publish_method !== "official_api") {
      return mockXPublisher.publish(task, variant);
    }
    if (task.platform !== "x" || variant.platform !== "x") {
      return {
        ok: false,
        platform_post_id: null,
        error_message: "X real publisher can only publish X platform variants."
      };
    }

    const credentials = await loadXCredentials(task.account_id);
    if (!credentials) {
      return {
        ok: false,
        platform_post_id: null,
        error_message: "X credentials missing. Create XAPI.env with X_API_KEY, X_API_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, and X_API_DRY_RUN=true."
      };
    }

    const text = buildXPostText(variant);
    if (text.length > 280) {
      return {
        ok: false,
        platform_post_id: null,
        error_message: `X post text is ${text.length} characters; maximum is 280 for this first adapter stage.`
      };
    }

    if (credentials.dryRun) {
      const dryRunId = `x_dry_run_${task.publish_task_id}`;
      return {
        ok: true,
        platform_post_id: dryRunId,
        error_message: null,
        publish_mode: "mock",
        mock_url: `https://mock.social/x/${dryRunId}`,
        post_url: `https://mock.social/x/${dryRunId}`
      };
    }

    return createXPost(credentials, text);
  }
};

function buildXPostText(variant: PlatformVariant): string {
  const text = [variant.caption, variant.cta].filter(Boolean).join("\n\n").trim();
  return text.length > 0 ? text : variant.caption.trim();
}

async function loadXCredentials(accountId?: string): Promise<XCredentials | null> {
  const values = {
    ...(await readEnvFile(".env.local")),
    ...(await readEnvFile("XAPI.env")),
    ...readProcessEnv()
  };
  const apiKey = values.X_API_KEY;
  const apiKeySecret = values.X_API_KEY_SECRET;
  const accountToken = accountId ? await readXUserToken(accountId) : null;
  const accessToken = accountToken?.access_token || values.X_ACCESS_TOKEN;
  const accessTokenSecret = accountToken?.access_token_secret || values.X_ACCESS_TOKEN_SECRET;
  const dryRun = values.X_API_DRY_RUN !== "false";

  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    return null;
  }

  return {
    apiKey,
    apiKeySecret,
    accessToken,
    accessTokenSecret,
    dryRun
  };
}

async function createXPost(credentials: XCredentials, text: string): Promise<PublishResult> {
  const endpoint = "https://api.x.com/2/tweets";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: buildOAuthHeader("POST", endpoint, credentials),
      "content-type": "application/json"
    },
    body: JSON.stringify({ text })
  });
  const responseText = await response.text();
  const body = parseJsonObject(responseText);

  if (!response.ok) {
    return {
      ok: false,
      platform_post_id: null,
      error_message: `X API create post failed (${response.status}): ${extractXError(body, responseText)}`
    };
  }

  const postId = typeof body?.data === "object" && body.data && "id" in body.data ? String(body.data.id) : null;
  if (!postId) {
    return {
      ok: false,
      platform_post_id: null,
      error_message: "X API create post succeeded but did not return data.id."
    };
  }

  return {
    ok: true,
    platform_post_id: postId,
    error_message: null,
    publish_mode: "api",
    mock_url: `https://x.com/i/web/status/${postId}`,
    post_url: `https://x.com/i/web/status/${postId}`
  };
}

function buildOAuthHeader(method: string, url: string, credentials: XCredentials): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0"
  };
  const signature = signOAuthRequest(method, url, oauthParams, credentials);
  return `OAuth ${Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}="${encodeRfc3986(value)}"`)
    .join(", ")}`;
}

function signOAuthRequest(method: string, url: string, oauthParams: Record<string, string>, credentials: XCredentials): string {
  const parameterString = Object.entries(oauthParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
  const signatureBase = [
    method.toUpperCase(),
    encodeRfc3986(url),
    encodeRfc3986(parameterString)
  ].join("&");
  const signingKey = `${encodeRfc3986(credentials.apiKeySecret)}&${encodeRfc3986(credentials.accessTokenSecret)}`;
  return createHmac("sha1", signingKey).update(signatureBase).digest("base64");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
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

function readProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

async function readEnvFile(fileName: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(process.cwd(), fileName), "utf8");
    return parseEnv(raw);
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
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    parsed[key] = value;
  }
  return parsed;
}

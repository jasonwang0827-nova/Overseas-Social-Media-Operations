import { readXUserToken } from "./accountAuth.js";

export interface XFollowTarget {
  user_id: string;
  username: string;
}

export interface XFollowResult {
  ok: boolean;
  following: boolean | null;
  error_message: string | null;
}

export async function followXUser(tokenRef: string, target: XFollowTarget): Promise<XFollowResult> {
  const token = await readXUserToken(tokenRef);
  if (!token) {
    return { ok: false, following: null, error_message: `No X user token found for token ref ${tokenRef}.` };
  }
  if (!token.x_user_id) {
    return { ok: false, following: null, error_message: `X token ${tokenRef} is missing x_user_id.` };
  }
  if (!token.scopes.includes("follows.write")) {
    return { ok: false, following: null, error_message: `X token ${tokenRef} is missing follows.write scope.` };
  }

  const endpoint = `https://api.x.com/2/users/${encodeURIComponent(token.x_user_id)}/following`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ target_user_id: target.user_id })
  });
  const text = await response.text();
  const body = parseJsonObject(text);

  if (!response.ok) {
    return {
      ok: false,
      following: null,
      error_message: `X API follow @${target.username} failed (${response.status}): ${extractXError(body, text)}`
    };
  }

  const following = typeof body?.data === "object" && body.data !== null && "following" in body.data
    ? Boolean((body.data as { following?: unknown }).following)
    : null;

  return { ok: true, following, error_message: null };
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

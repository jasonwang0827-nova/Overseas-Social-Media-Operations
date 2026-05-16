import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlatformAccount } from "../../core/types.js";
import { readClientArray, writeClientArray } from "../../storage/jsonStore.js";
import { defaultXTokenRef, readXUserToken, writeXUserToken, type XUserTokenVaultEntry } from "./accountAuth.js";

interface XOAuthEnv {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
}

interface XOAuthState {
  state: string;
  client_id: string;
  account_id: string;
  code_verifier: string;
  redirect_uri: string;
  scopes: string[];
  created_at: string;
}

interface XTokenResponse {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  scope?: string;
  refresh_token?: string;
}

const defaultScopes = [
  "tweet.read",
  "users.read",
  "tweet.write",
  "follows.read",
  "follows.write",
  "dm.read",
  "dm.write",
  "offline.access"
];

export async function buildXOAuthAuthorizeUrl(input: { clientId: string; accountId: string }): Promise<string> {
  const env = await loadXOAuthEnv();
  if (!env.clientId) {
    throw new Error("X_CLIENT_ID is missing in XAPI.env. Add OAuth 2.0 Client ID before connecting customer X accounts.");
  }
  const accounts = await readClientArray<PlatformAccount>(input.clientId, "accounts.json");
  const account = accounts.find((item) => item.account_id === input.accountId);
  if (!account) throw new Error(`Account ${input.accountId} not found.`);
  if (account.platform !== "x") throw new Error(`Account ${input.accountId} is ${account.platform}, not x.`);

  const state = randomUrlToken(32);
  const codeVerifier = randomUrlToken(64);
  const scopes = defaultScopes;
  await writeOAuthState({
    state,
    client_id: input.clientId,
    account_id: input.accountId,
    code_verifier: codeVerifier,
    redirect_uri: env.redirectUri,
    scopes,
    created_at: new Date().toISOString()
  });

  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", sha256Base64Url(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("force_login", "true");
  return url.toString();
}

export async function completeXOAuthCallback(input: { state: string; code: string }): Promise<{ client_id: string; account_id: string; x_username: string; scopes: string[] }> {
  const env = await loadXOAuthEnv();
  if (!env.clientId) throw new Error("X_CLIENT_ID is missing in XAPI.env.");
  const state = await readOAuthState(input.state);
  assertFreshState(state);

  const token = await exchangeCodeForToken({
    code: input.code,
    codeVerifier: state.code_verifier,
    redirectUri: state.redirect_uri,
    clientId: env.clientId,
    clientSecret: env.clientSecret
  });
  if (!token.access_token) throw new Error("X OAuth token response did not include access_token.");

  const xUser = await fetchXMe(token.access_token);
  const accounts = await readClientArray<PlatformAccount>(state.client_id, "accounts.json");
  const account = accounts.find((item) => item.account_id === state.account_id);
  if (!account) throw new Error(`Account ${state.account_id} not found.`);
  if (account.platform !== "x") throw new Error(`Account ${state.account_id} is ${account.platform}, not x.`);
  const expectedUsername = normalizeUsername(account.account_name);
  if (expectedUsername && normalizeUsername(xUser.username) !== expectedUsername) {
    throw new Error(`Authenticated X account @${xUser.username} does not match expected @${account.account_name}. Log in as the customer account and try again.`);
  }

  const scopes = token.scope ? token.scope.split(/\s+/).filter(Boolean) : state.scopes;
  const now = new Date().toISOString();
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
  const tokenRef = defaultXTokenRef(account);
  const vaultEntry: XUserTokenVaultEntry = {
    account_id: account.account_id,
    client_id: account.client_id,
    platform: "x",
    x_user_id: xUser.id,
    x_username: xUser.username,
    oauth_version: "2.0",
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    scopes,
    expires_at: expiresAt,
    created_at: now,
    updated_at: now
  };
  await writeXUserToken(tokenRef, vaultEntry);

  account.auth_status = "connected";
  account.x_binding = {
    ...(account.x_binding ?? {}),
    x_user_id: xUser.id,
    x_username: xUser.username,
    token_ref: tokenRef,
    token_status: "configured",
    scopes,
    oauth_version: "2.0",
    last_checked_at: now,
    setup_status: scopes.includes("tweet.write") ? "ready_for_write" : "ready_for_read",
    setup_notes: ["Connected through X OAuth 2.0 Authorization Code with PKCE."]
  };
  account.updated_at = now;
  await writeClientArray(state.client_id, "accounts.json", accounts);
  await deleteOAuthState(input.state);
  return { client_id: state.client_id, account_id: state.account_id, x_username: xUser.username, scopes };
}


export async function refreshXOAuthToken(input: { clientId: string; accountId: string }): Promise<{ client_id: string; account_id: string; x_username: string; scopes: string[]; expires_at: string | null }> {
  const env = await loadXOAuthEnv();
  if (!env.clientId) throw new Error("X_CLIENT_ID is missing in XAPI.env.");
  const accounts = await readClientArray<PlatformAccount>(input.clientId, "accounts.json");
  const account = accounts.find((item) => item.account_id === input.accountId);
  if (!account) throw new Error(`Account ${input.accountId} not found.`);
  if (account.platform !== "x") throw new Error(`Account ${input.accountId} is ${account.platform}, not x.`);
  const tokenRef = defaultXTokenRef(account);
  const existing = await readXUserToken(tokenRef);
  if (!existing?.refresh_token) {
    throw new Error(`No refresh_token found for ${input.accountId}. Reconnect X OAuth with offline.access.`);
  }
  const refreshed = await refreshToken({
    refreshToken: existing.refresh_token,
    clientId: env.clientId,
    clientSecret: env.clientSecret
  });
  if (!refreshed.access_token) throw new Error("X OAuth refresh response did not include access_token.");
  const scopes = refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : existing.scopes;
  const now = new Date().toISOString();
  const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null;
  const nextToken: XUserTokenVaultEntry = {
    ...existing,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || existing.refresh_token,
    scopes,
    expires_at: expiresAt,
    updated_at: now
  };
  await writeXUserToken(tokenRef, nextToken);
  account.auth_status = "connected";
  account.x_binding = {
    ...(account.x_binding ?? {}),
    x_user_id: existing.x_user_id,
    x_username: existing.x_username,
    token_ref: tokenRef,
    token_status: "configured",
    scopes,
    oauth_version: "2.0",
    last_checked_at: now,
    setup_status: scopes.includes("tweet.write") || scopes.includes("follows.write") ? "ready_for_write" : "ready_for_read",
    setup_notes: ["X OAuth 2.0 token refreshed using offline.access."]
  };
  account.updated_at = now;
  await writeClientArray(input.clientId, "accounts.json", accounts);
  return { client_id: input.clientId, account_id: input.accountId, x_username: existing.x_username, scopes, expires_at: expiresAt };
}

async function refreshToken(input: { refreshToken: string; clientId: string; clientSecret: string | null }): Promise<XTokenResponse> {
  const body = new URLSearchParams();
  body.set("refresh_token", input.refreshToken);
  body.set("grant_type", "refresh_token");
  body.set("client_id", input.clientId);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (input.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`;
  }
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body
  });
  const text = await response.text();
  const json = parseJsonObject(text);
  if (!response.ok) throw new Error(`X OAuth token refresh failed (${response.status}): ${extractError(json, text)}`);
  return json as XTokenResponse;
}

async function exchangeCodeForToken(input: { code: string; codeVerifier: string; redirectUri: string; clientId: string; clientSecret: string | null }): Promise<XTokenResponse> {
  const body = new URLSearchParams();
  body.set("code", input.code);
  body.set("grant_type", "authorization_code");
  body.set("client_id", input.clientId);
  body.set("redirect_uri", input.redirectUri);
  body.set("code_verifier", input.codeVerifier);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (input.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`;
  }
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body
  });
  const text = await response.text();
  const json = parseJsonObject(text);
  if (!response.ok) throw new Error(`X OAuth token exchange failed (${response.status}): ${extractError(json, text)}`);
  return json as XTokenResponse;
}

async function fetchXMe(accessToken: string): Promise<{ id: string; username: string; name?: string }> {
  const response = await fetch("https://api.x.com/2/users/me?user.fields=username,name", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const text = await response.text();
  const json = parseJsonObject(text);
  if (!response.ok) throw new Error(`X users/me failed (${response.status}): ${extractError(json, text)}`);
  const data = json?.data as Record<string, unknown> | undefined;
  if (!data?.id || !data?.username) throw new Error("X users/me response did not include id and username.");
  return { id: String(data.id), username: String(data.username), name: data.name ? String(data.name) : undefined };
}

async function loadXOAuthEnv(): Promise<XOAuthEnv> {
  const values = {
    ...(await readEnvFile(".env.local")),
    ...(await readEnvFile("XAPI.env")),
    ...readProcessEnv()
  };
  return {
    clientId: values.X_CLIENT_ID || null,
    clientSecret: values.X_CLIENT_SECRET || null,
    redirectUri: values.X_OAUTH_REDIRECT_URI || "http://localhost:4321/auth/x/callback"
  };
}

async function writeOAuthState(state: XOAuthState): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(statePath(state.state), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readOAuthState(state: string): Promise<XOAuthState> {
  const raw = await readFile(statePath(state), "utf8");
  return JSON.parse(raw) as XOAuthState;
}

async function deleteOAuthState(state: string): Promise<void> {
  await unlink(statePath(state)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

function assertFreshState(state: XOAuthState): void {
  const ageMs = Date.now() - Date.parse(state.created_at);
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) {
    throw new Error("X OAuth state expired. Start the connect flow again.");
  }
}

function stateDir(): string {
  return join(process.cwd(), "data", "token-vault", "x", "oauth-states");
}

function statePath(state: string): string {
  return join(stateDir(), `${state.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`);
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function randomUrlToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function normalizeUsername(value: string | undefined): string {
  return (value || "").trim().replace(/^@/, "").toLowerCase();
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

function extractError(body: Record<string, unknown> | null, fallback: string): string {
  if (!body) return fallback.slice(0, 500);
  if (typeof body.error_description === "string") return body.error_description;
  if (typeof body.error === "string") return body.error;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.errors)) return body.errors.map((error) => JSON.stringify(error)).join("; ").slice(0, 500);
  return JSON.stringify(body).slice(0, 500);
}

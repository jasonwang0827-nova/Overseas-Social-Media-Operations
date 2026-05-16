import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlatformAccount } from "../../core/types.js";

export interface XUserTokenVaultEntry {
  account_id: string;
  client_id: string;
  platform: "x";
  x_user_id: string;
  x_username: string;
  oauth_version: "1.0a" | "2.0";
  access_token: string;
  access_token_secret?: string;
  refresh_token?: string;
  scopes: string[];
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface XAccountAuthStatus {
  account_id: string;
  client_id: string;
  x_username: string | null;
  token_ref: string;
  token_path: string;
  token_exists: boolean;
  token_status: "not_configured" | "configured" | "expired" | "revoked" | "unknown";
  setup_status: "not_started" | "needs_x_oauth" | "ready_for_read" | "ready_for_write" | "ready_for_manual";
  scopes: string[];
  missing_scopes: string[];
  can_read_as_user: boolean;
  can_write_as_user: boolean;
  can_follow_as_user: boolean;
  can_dm_as_user: boolean;
  notes: string[];
}

const readScopes = ["tweet.read", "users.read"];
const writeScopes = ["tweet.write"];
const followScopes = ["follows.write"];
const dmScopes = ["dm.read", "dm.write"];

export function xTokenVaultPath(tokenRef: string): string {
  return join(process.cwd(), "data", "token-vault", "x", `${safeTokenRef(tokenRef)}.json`);
}

export function defaultXTokenRef(account: PlatformAccount): string {
  return account.x_binding?.token_ref || account.account_id;
}

export async function readXUserToken(tokenRef: string): Promise<XUserTokenVaultEntry | null> {
  try {
    const raw = await readFile(xTokenVaultPath(tokenRef), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as XUserTokenVaultEntry : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeXUserToken(tokenRef: string, token: XUserTokenVaultEntry): Promise<void> {
  const path = xTokenVaultPath(tokenRef);
  await mkdir(join(process.cwd(), "data", "token-vault", "x"), { recursive: true });
  await writeFile(path, `${JSON.stringify(token, null, 2)}\n`, "utf8");
}

export async function checkXAccountAuth(account: PlatformAccount): Promise<XAccountAuthStatus> {
  if (account.platform !== "x") {
    throw new Error(`Account ${account.account_id} is ${account.platform}, not x.`);
  }
  const tokenRef = defaultXTokenRef(account);
  const token = await readXUserToken(tokenRef);
  const tokenExists = Boolean(token);
  const tokenExpired = Boolean(token?.expires_at && Date.parse(token.expires_at) <= Date.now());
  const scopes = token?.scopes || account.x_binding?.scopes || [];
  const missingReadScopes = missing(scopes, readScopes);
  const missingWriteScopes = missing(scopes, writeScopes);
  const missingFollowScopes = missing(scopes, followScopes);
  const missingDmScopes = missing(scopes, dmScopes);
  const canReadAsUser = tokenExists && !tokenExpired && missingReadScopes.length === 0;
  const canWriteAsUser = tokenExists && !tokenExpired && missingWriteScopes.length === 0;
  const canFollowAsUser = tokenExists && !tokenExpired && missingFollowScopes.length === 0;
  const canDmAsUser = tokenExists && !tokenExpired && missingDmScopes.length === 0;
  const notes: string[] = [];
  if (!tokenExists) notes.push("No account-level X token found. Run X OAuth for this account before follow/DM/comment/publish actions.");
  if (tokenExpired) notes.push("Account-level X token is expired. Reconnect this X account.");
  if (token && token.x_username && account.account_name && token.x_username.toLowerCase() !== account.account_name.toLowerCase()) {
    notes.push(`Token username @${token.x_username} does not match account_name @${account.account_name}. Verify before using.`);
  }
  if (canFollowAsUser) {
    notes.push("Follow actions can be performed as this account only after human approval and automation settings allow it.");
  }
  const tokenStatus = !tokenExists ? "not_configured" : tokenExpired ? "expired" : "configured";
  const setupStatus = !tokenExists
    ? "needs_x_oauth"
    : canWriteAsUser
      ? "ready_for_write"
      : canReadAsUser
        ? "ready_for_read"
        : "ready_for_manual";
  return {
    account_id: account.account_id,
    client_id: account.client_id,
    x_username: token?.x_username || account.x_binding?.x_username || account.account_name || null,
    token_ref: tokenRef,
    token_path: `data/token-vault/x/${safeTokenRef(tokenRef)}.json`,
    token_exists: tokenExists,
    token_status: tokenStatus,
    setup_status: setupStatus,
    scopes,
    missing_scopes: unique([...missingReadScopes, ...missingWriteScopes, ...missingFollowScopes, ...missingDmScopes]),
    can_read_as_user: canReadAsUser,
    can_write_as_user: canWriteAsUser,
    can_follow_as_user: canFollowAsUser,
    can_dm_as_user: canDmAsUser,
    notes
  };
}

export async function tokenVaultExists(tokenRef: string): Promise<boolean> {
  try {
    await access(xTokenVaultPath(tokenRef));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function missing(scopes: string[], required: string[]): string[] {
  return required.filter((scope) => !scopes.includes(scope));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function safeTokenRef(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

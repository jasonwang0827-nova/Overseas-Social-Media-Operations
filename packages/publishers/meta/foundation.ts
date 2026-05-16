import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MetaAccountBinding, Platform, PlatformAccount, PlatformVariant, PublishTask } from "../../core/types.js";

export type MetaMode = "mock" | "dry_run" | "manual";

export interface MetaFoundationConfig {
  phase: string;
  graph_api_version: string;
  safety_rules: {
    real_publish_enabled: boolean;
    auto_reply_enabled: boolean;
    auto_dm_enabled: boolean;
    auto_comment_enabled: boolean;
    auto_follow_enabled: boolean;
    web_ui_live_publish_enabled: boolean;
    allowed_modes: MetaMode[];
  };
  shared_meta_auth: {
    env_file: string;
    required_env_vars: string[];
    optional_env_vars: string[];
    token_storage_policy: string;
  };
  facebook: MetaPlatformFoundation;
  instagram: MetaPlatformFoundation;
}

export interface MetaPlatformFoundation {
  account_type: string;
  required_account_binding: Array<keyof MetaAccountBinding>;
  recommended_permissions: string[];
  phase_1_workflows: string[];
  reserved_later_workflows: string[];
  notes: string;
}

export interface MetaAccountCheckResult {
  ok: boolean;
  platform: "facebook" | "instagram";
  account_id: string;
  mode: MetaMode;
  missing_bindings: string[];
  missing_permissions: string[];
  warnings: string[];
  next_steps: string[];
}

export interface MetaDryRunPreview {
  ok: boolean;
  platform: "facebook" | "instagram";
  mode: "dry_run";
  task_id?: string;
  account_id: string;
  endpoint_preview: string;
  payload_preview: Record<string, unknown>;
  warnings: string[];
  message: string;
}

export async function readMetaFoundationConfig(): Promise<MetaFoundationConfig> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "meta-platform-foundation.json"), "utf8")) as MetaFoundationConfig;
}

export async function loadMetaEnv(): Promise<Record<string, string>> {
  return {
    ...(await readEnvFile(".env.local")),
    ...(await readEnvFile("MetaAPI.env")),
    ...readProcessEnv()
  };
}

export async function checkMetaAccount(account: PlatformAccount, mode: MetaMode = "dry_run"): Promise<MetaAccountCheckResult> {
  assertMetaPlatform(account.platform);
  const config = await readMetaFoundationConfig();
  const platformConfig = config[account.platform];
  const binding = account.meta_binding ?? {};
  const permissions = new Set(binding.permissions ?? []);
  const missingBindings = platformConfig.required_account_binding.filter((field) => !binding[field]);
  const missingPermissions = platformConfig.recommended_permissions.filter((permission) => !permissions.has(permission));
  const warnings: string[] = [];
  const blockers: string[] = [];
  const nextSteps: string[] = [];

  if (account.status !== "active") blockers.push(`Account ${account.account_id} is not active.`);
  if (!account.posting_enabled) blockers.push(`Account ${account.account_id} has posting disabled.`);
  if (mode !== "mock" && account.auth_status !== "connected") warnings.push(`auth_status is ${account.auth_status}; real API is not allowed.`);
  if (mode !== "mock" && binding.token_status !== "configured") warnings.push(`meta_binding.token_status is ${binding.token_status ?? "not_configured"}.`);
  if (missingBindings.length) nextSteps.push(`Add meta_binding fields: ${missingBindings.join(", ")}.`);
  if (missingPermissions.length) nextSteps.push(`Confirm Meta permissions before future API work: ${missingPermissions.join(", ")}.`);
  if (!config.safety_rules.real_publish_enabled) warnings.push("Meta real publishing is disabled in the foundation config.");
  if (config.safety_rules.web_ui_live_publish_enabled === false) warnings.push("Web UI live publish is disabled.");

  return {
    ok: blockers.length === 0 && missingBindings.length === 0,
    platform: account.platform,
    account_id: account.account_id,
    mode,
    missing_bindings: missingBindings.map(String),
    missing_permissions: missingPermissions,
    warnings: [...blockers, ...warnings],
    next_steps: nextSteps
  };
}

export async function buildMetaDryRunPreview(input: {
  account: PlatformAccount;
  variant: PlatformVariant;
  task?: PublishTask;
}): Promise<MetaDryRunPreview> {
  const { account, variant, task } = input;
  assertMetaPlatform(account.platform);
  if (variant.platform !== account.platform) {
    throw new Error(`Variant platform ${variant.platform} does not match account platform ${account.platform}.`);
  }
  const check = await checkMetaAccount(account, "dry_run");
  const endpoint = account.platform === "facebook"
    ? `/${account.meta_binding?.page_id ?? "{page_id}"}/feed`
    : `/${account.meta_binding?.instagram_business_account_id ?? "{ig_user_id}"}/media -> /{ig_user_id}/media_publish`;
  const payload = account.platform === "facebook"
    ? {
        message: buildMetaCaption(variant),
        published: false,
        phase: "dry_run_only"
      }
    : {
        caption: buildMetaCaption(variant),
        media_type: inferInstagramMediaType(variant),
        image_url: variant.media_path ? "{future_public_media_url}" : null,
        video_url: variant.media_path ? "{future_public_media_url}" : null,
        phase: "dry_run_only"
      };

  return {
    ok: check.ok,
    platform: account.platform,
    mode: "dry_run",
    task_id: task?.publish_task_id,
    account_id: account.account_id,
    endpoint_preview: endpoint,
    payload_preview: payload,
    warnings: check.warnings,
    message: "Meta dry-run preview only. No Graph API request was made."
  };
}

export function buildMetaCaption(variant: PlatformVariant): string {
  return [variant.caption, variant.cta, (variant.hashtags ?? []).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function inferInstagramMediaType(variant: PlatformVariant): "IMAGE" | "VIDEO" | "CAROUSEL" | "REELS" {
  const format = variant.format.toLowerCase();
  if (format.includes("carousel")) return "CAROUSEL";
  if (format.includes("reel")) return "REELS";
  if (format.includes("video")) return "VIDEO";
  return "IMAGE";
}

function assertMetaPlatform(platform: Platform): asserts platform is "facebook" | "instagram" {
  if (platform !== "facebook" && platform !== "instagram") {
    throw new Error(`Meta foundation only supports facebook and instagram. Received: ${platform}`);
  }
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

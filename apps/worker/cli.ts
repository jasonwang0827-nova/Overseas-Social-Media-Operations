import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertContentApproved, assertPublishApproved, assertVariantApproved } from "../../packages/core/approval.js";
import { categories, getCategory } from "../../packages/core/category.js";
import type {
  Client,
  ContentAsset,
  AccountRole,
  ContentAngle,
  ContentFocus,
  ContentTheme,
  Lead,
  Platform,
  PlatformAccount,
  PlatformCapabilities,
  PlatformVariant,
  PublishRecord,
  PublishTask,
  ReplyDraft
} from "../../packages/core/types.js";
import { classifyIntent } from "../../packages/lead-intelligence/classifyIntent.js";
import { generateReplyDraft } from "../../packages/lead-intelligence/generateReplyDraft.js";
import { scoreLead, type LeadScoringRule } from "../../packages/lead-intelligence/scoreLead.js";
import { facebookPublisher } from "../../packages/publishers/facebook/index.js";
import { instagramPublisher } from "../../packages/publishers/instagram/index.js";
import { tiktokPublisher } from "../../packages/publishers/tiktok/index.js";
import type { Publisher } from "../../packages/publishers/types.js";
import { xPublisher } from "../../packages/publishers/x/index.js";
import {
  clientDir,
  clientFile,
  ensureClientDirectories,
  readClientArray,
  readJson,
  writeClientArray,
  writeJson
} from "../../packages/storage/jsonStore.js";

type Args = Record<string, string | boolean>;

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

type PublishablePlatform = "facebook" | "instagram" | "tiktok" | "x";

const supportedPlatforms: Platform[] = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube"];
const publishablePlatforms: PublishablePlatform[] = ["facebook", "instagram", "tiktok", "x"];
const accountRoles: AccountRole[] = ["official_brand", "founder_voice", "expert_advisor", "case_study", "education_content", "community_account", "sales_conversion", "local_market"];
const contentFocuses: ContentFocus[] = ["brand_awareness", "lead_generation", "trust_building", "product_education", "case_study", "community_engagement", "sales_conversion", "customer_support"];
const contentThemes: ContentTheme[] = ["brand_intro", "product_intro", "pain_point", "case_study", "faq", "comparison", "myth_busting", "how_to", "checklist", "offer", "lead_magnet", "testimonial"];
const contentAngles: ContentAngle[] = ["education", "problem_solution", "trust_building", "conversion", "authority", "urgency", "story", "objection_handling"];

interface PublishRule {
  max_posts_per_account_per_day: number;
  min_minutes_between_posts: number;
  allowed_time_windows: Array<[string, string]>;
  default_timezone: string;
  supports_text_only: boolean;
}

type PublishRules = Record<Platform, PublishRule>;
type LeadScoringRules = Record<string, LeadScoringRule>;
type PlatformCapabilityMap = Record<Platform, PlatformCapabilities>;
const leadStages: Lead["lead_stage"][] = ["new", "qualified", "replied", "waiting_response", "booked", "converted", "not_interested", "spam"];
const leadSourceTypes: Lead["source_type"][] = ["comment", "dm", "form", "manual", "email", "whatsapp"];

const publishers: Record<PublishablePlatform, Publisher> = {
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  tiktok: tiktokPublisher,
  x: xPublisher
};

async function main(): Promise<void> {
  switch (command) {
    case "client:create":
      return createClient();
    case "account:add":
      return addAccount();
    case "account:list":
      return listAccounts();
    case "account:update":
      return updateAccount();
    case "account:disable":
      return setAccountPosting(false);
    case "account:enable":
      return setAccountPosting(true);
    case "account:status":
      return accountStatus();
    case "content:add":
      return addContent();
    case "content:list":
      return listContent();
    case "content:update":
      return updateContent();
    case "content:generate":
      return generateContent();
    case "content:variant":
      return createVariant();
    case "content:variant:generate":
      return generateVariants();
    case "content:approve":
      return approveContent();
    case "content:reject":
      return rejectContent();
    case "content:status":
      return contentStatus();
    case "variant:approve":
      return approveVariant();
    case "variant:reject":
      return rejectVariant();
    case "publish:schedule":
      return schedulePublish();
    case "publish:schedule:batch":
      return scheduleBatch();
    case "publish:list":
      return listPublishTasks();
    case "publish:run":
      return runPublishQueue();
    case "publish:status":
      return publishStatus();
    case "publish:cancel":
      return cancelPublishTask();
    case "publish:reschedule":
      return reschedulePublishTask();
    case "publish:retry":
      return retryPublishTask();
    case "publish:calendar":
      return publishCalendar();
    case "lead:import":
      return importLead();
    case "lead:score":
      return scoreLeads();
    case "lead:update":
      return updateLead();
    case "reply:generate":
      return generateReplyForLead();
    case "reply:approve":
      return approveReplyDraft();
    case "reply:reject":
      return rejectReplyDraft();
    case "reply:list":
      return listReplyDrafts();
    case "report:daily":
      return generateDailyReport();
    case "report:weekly":
      return generateWeeklyReport();
    case "demo:seed":
      return seedDemo();
    default:
      printHelp();
  }
}

function parseArgs(values: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function arg(name: string, fallback?: string): string {
  const value = args[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required argument --${name}`);
}

function id(prefix: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${stamp}_${random}`;
}

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function nullableArg(name: string): string | null {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function boolArg(name: string, fallback: boolean): boolean {
  const value = args[name];
  if (typeof value !== "string") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(value.toLowerCase());
}

function enumArg<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const value = arg(name, fallback);
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid --${name}: ${value}. Allowed: ${allowed.join(", ")}`);
  }
  return value as T;
}

function assertValidPlatform(platform: Platform): void {
  if (!supportedPlatforms.includes(platform)) {
    throw new Error(`Invalid platform: ${platform}. Allowed: ${supportedPlatforms.join(", ")}`);
  }
}

function isPublishablePlatform(platform: Platform): platform is PublishablePlatform {
  return publishablePlatforms.includes(platform as PublishablePlatform);
}

function findAccount(accounts: PlatformAccount[], accountId: string): PlatformAccount {
  const account = accounts.find((item) => item.account_id === accountId);
  if (!account) {
    throw new Error(`Account ${accountId} was not found.`);
  }
  return account;
}

function applyAccountUpdates(account: PlatformAccount): void {
  for (const field of ["account_name", "display_name", "language", "region", "notes"] as const) {
    const value = args[field];
    if (typeof value === "string") account[field] = value;
  }
  if (typeof args.account_url === "string") account.account_url = args.account_url || null;
  if (typeof args.platform === "string") {
    const platform = args.platform as Platform;
    assertValidPlatform(platform);
    account.platform = platform;
  }
  if (typeof args.account_role === "string") account.account_role = enumArg("account_role", account.account_role, accountRoles);
  if (typeof args.content_focus === "string") account.content_focus = enumArg("content_focus", account.content_focus, contentFocuses);
  if (typeof args.posting_enabled === "string") account.posting_enabled = boolArg("posting_enabled", account.posting_enabled);
  if (typeof args.lead_tracking_enabled === "string") account.lead_tracking_enabled = boolArg("lead_tracking_enabled", account.lead_tracking_enabled);
  if (typeof args.auth_status === "string") account.auth_status = args.auth_status as PlatformAccount["auth_status"];
  if (typeof args.status === "string") account.status = args.status as PlatformAccount["status"];
  if (typeof args.capability_override === "string") account.capability_override = JSON.parse(args.capability_override) as Partial<PlatformCapabilities>;
  account.updated_at = new Date().toISOString();
}

function applyContentUpdates(content: ContentAsset): void {
  for (const field of ["title", "hook", "cta", "language"] as const) {
    const value = args[field];
    if (typeof value === "string") content[field] = value;
  }
  if (typeof args.content_theme === "string") content.content_theme = enumArg("content_theme", content.content_theme, contentThemes);
  if (typeof args.content_angle === "string") content.content_angle = enumArg("content_angle", content.content_angle, contentAngles);
  if (typeof args.content_type === "string") content.content_type = args.content_type as ContentAsset["content_type"];
  if (typeof args.funnel_stage === "string") content.funnel_stage = args.funnel_stage as ContentAsset["funnel_stage"];
  if (typeof args.main_points === "string") content.main_points = csv(args.main_points);
  if (typeof args.target_audience === "string") content.target_audience = csv(args.target_audience);
  content.updated_at = new Date().toISOString();
}

function assertAccountCanPublish(account: PlatformAccount | undefined, accountId: string): void {
  if (!account) {
    throw new Error(`Account ${accountId} was not found.`);
  }
  if (account.status !== "active") {
    throw new Error(`Account ${accountId} is not active.`);
  }
  if (!account.posting_enabled) {
    throw new Error(`Account ${accountId} has posting disabled.`);
  }
}

function blockTask(task: PublishTask, reason: string, needsManualReview = false): void {
  task.status = needsManualReview ? "needs_manual_review" : "blocked";
  task.blocked_reason = reason;
  task.error_message = reason;
  task.last_error = reason;
  task.updated_at = new Date().toISOString();
}

async function readClient(clientId: string): Promise<Client> {
  return readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
}

async function createClient(): Promise<void> {
  const categoryId = arg("category_id", "study_abroad");
  const category = getCategory(categoryId);
  const clientId = arg("client_id", categoryId === "study_abroad" ? "client_study_001" : `client_${categoryId}_001`);
  await ensureClientDirectories(clientId);

  const client: Client = {
    client_id: clientId,
    client_name: arg("client_name", "ABC Study Abroad"),
    industry: categoryId,
    business_type: arg("business_type", `${categoryId}_consulting`),
    region: arg("region", "Canada"),
    language: csv(arg("language", "zh,en")),
    target_audience: csv(arg("target_audience", "Chinese students,Chinese parents,international students,new immigrants")),
    service_keywords: csv(arg("service_keywords", category.lead_keywords.join(","))),
    brand_tone: arg("brand_tone", "professional, trustworthy, friendly"),
    lead_goal: csv(arg("lead_goal", "book consultation,DM inquiry,WhatsApp contact,website visit")),
    status: "active"
  };

  await writeJson(clientFile(clientId, "client.json"), client);
  await writeJson(clientFile(clientId, "categories.json"), categories);
  await writeClientArray<PlatformAccount>(clientId, "accounts.json", await readClientArray(clientId, "accounts.json"));
  await writeClientArray<ContentAsset>(clientId, "content-pool.json", await readClientArray(clientId, "content-pool.json"));
  await writeClientArray<PlatformVariant>(clientId, "platform-variants.json", await readClientArray(clientId, "platform-variants.json"));
  await writeClientArray<PublishTask>(clientId, "publish-queue.json", await readClientArray(clientId, "publish-queue.json"));
  await writeClientArray<PublishRecord>(clientId, "publish-records.json", await readClientArray(clientId, "publish-records.json"));
  await writeClientArray<Lead>(clientId, "leads.json", await readClientArray(clientId, "leads.json"));
  await writeClientArray<ReplyDraft>(clientId, "reply-drafts.json", await readClientArray(clientId, "reply-drafts.json"));

  console.log(`Created client ${clientId}`);
}

async function addAccount(): Promise<void> {
  const clientId = arg("client_id");
  await readClient(clientId);
  const platform = arg("platform", "instagram") as Platform;
  assertValidPlatform(platform);
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const accountId = arg("account_id", `${platform}_${id("account")}`);
  if (accounts.some((account) => account.account_id === accountId)) {
    throw new Error(`Account ${accountId} already exists under ${clientId}.`);
  }
  const now = new Date().toISOString();
  const account: PlatformAccount = {
    account_id: accountId,
    client_id: clientId,
    platform,
    account_name: arg("account_name", `${clientId}_${platform}`),
    display_name: arg("display_name", arg("account_name", `${clientId}_${platform}`)),
    account_url: nullableArg("account_url"),
    language: arg("language", "zh"),
    region: arg("region", "Canada"),
    account_role: enumArg("account_role", "official_brand", accountRoles),
    content_focus: enumArg("content_focus", "brand_awareness", contentFocuses),
    posting_enabled: boolArg("posting_enabled", true),
    lead_tracking_enabled: boolArg("lead_tracking_enabled", true),
    auth_status: "mock",
    status: "active",
    capability_override: {},
    notes: arg("notes", ""),
    created_at: now,
    updated_at: now
  };

  accounts.push(account);
  await writeClientArray(clientId, "accounts.json", accounts);
  console.log(`Added ${platform} account ${account.account_id} to ${clientId}`);
}

async function listAccounts(): Promise<void> {
  const clientId = arg("client_id");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  console.log(JSON.stringify(accounts, null, 2));
}

async function updateAccount(): Promise<void> {
  const clientId = arg("client_id");
  const accountId = arg("account_id");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = findAccount(accounts, accountId);
  applyAccountUpdates(account);
  await writeClientArray(clientId, "accounts.json", accounts);
  console.log(`Updated account ${accountId}`);
}

async function setAccountPosting(enabled: boolean): Promise<void> {
  const clientId = arg("client_id");
  const accountId = arg("account_id");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = findAccount(accounts, accountId);
  account.posting_enabled = enabled;
  account.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "accounts.json", accounts);
  console.log(`${enabled ? "Enabled" : "Disabled"} posting for ${accountId}`);
}

async function accountStatus(): Promise<void> {
  const clientId = arg("client_id");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const summary = accounts.map((account) => ({
    account_id: account.account_id,
    platform: account.platform,
    account_name: account.account_name,
    posting_enabled: account.posting_enabled,
    lead_tracking_enabled: account.lead_tracking_enabled,
    auth_status: account.auth_status,
    status: account.status,
    publish_tasks: queue.filter((task) => task.account_id === account.account_id).length,
    leads: account.lead_tracking_enabled ? leads.filter((lead) => lead.account_id === account.account_id).length : 0
  }));
  console.log(JSON.stringify(summary, null, 2));
}

async function addContent(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const categoryId = arg("category_id", client.industry);
  getCategory(categoryId);
  const content = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const now = new Date().toISOString();
  const asset: ContentAsset = {
    content_id: arg("content_id", id("content")),
    client_id: clientId,
    category_id: categoryId,
    content_theme: enumArg("content_theme", "pain_point", contentThemes),
    content_type: arg("content_type", "short_video") as ContentAsset["content_type"],
    content_angle: enumArg("content_angle", "problem_solution", contentAngles),
    title: arg("title", "加拿大大学转学分，很多家长一开始就搞错了"),
    hook: arg("hook", "很多家长以为转学分只是换学校，其实最容易亏的是这些学分。"),
    main_points: csv(arg("main_points", "不是所有课程都能转,学校之间评估标准不同,专业方向会影响转学分结果,提前规划可以减少时间和学费浪费")),
    cta: arg("cta", "想知道你的情况能不能转学分，可以私信我。"),
    language: arg("language", "zh"),
    target_audience: csv(arg("target_audience", "parents,students")),
    funnel_stage: arg("funnel_stage", "lead_generation") as ContentAsset["funnel_stage"],
    media_assets: [],
    status: "draft",
    created_by: "openclaw",
    approved_by_human: false,
    created_at: now,
    updated_at: now
  };

  content.push(asset);
  await writeClientArray(clientId, "content-pool.json", content);
  console.log(`Added content ${asset.content_id}`);
}

async function listContent(): Promise<void> {
  const clientId = arg("client_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  console.log(JSON.stringify(contents, null, 2));
}

async function updateContent(): Promise<void> {
  const clientId = arg("client_id");
  const contentId = arg("content_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const content = contents.find((item) => item.content_id === contentId);
  if (!content) throw new Error(`Content ${contentId} was not found under ${clientId}`);
  applyContentUpdates(content);
  await writeClientArray(clientId, "content-pool.json", contents);
  console.log(`Updated content ${contentId}`);
}

async function generateContent(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const category = getCategory(client.industry);
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const theme = enumArg("theme", "brand_intro", contentThemes);
  const now = new Date().toISOString();
  const angle = defaultAngleForTheme(theme);
  const title = buildContentTitle(client, theme);
  const asset: ContentAsset = {
    content_id: arg("content_id", id("content")),
    client_id: clientId,
    category_id: client.industry,
    content_theme: theme,
    content_type: "short_video",
    content_angle: angle,
    title,
    hook: buildContentHook(client, theme, category.content_angles),
    main_points: buildMainPoints(client, theme, accounts),
    cta: buildContentCta(client, theme),
    language: client.language[0] ?? "en",
    target_audience: client.target_audience.slice(0, 3),
    funnel_stage: defaultFunnelForTheme(theme),
    media_assets: [],
    status: "ready_for_review",
    created_by: "openclaw_mock_generator",
    approved_by_human: false,
    created_at: now,
    updated_at: now
  };
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  contents.push(asset);
  await writeClientArray(clientId, "content-pool.json", contents);
  console.log(JSON.stringify(asset, null, 2));
}

async function createVariant(): Promise<void> {
  const clientId = arg("client_id");
  const contentId = arg("content_id");
  const platform = arg("platform", "instagram") as Platform;
  assertValidPlatform(platform);
  const accountId = arg("account_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const content = contents.find((item) => item.content_id === contentId);
  const account = accounts.find((item) => item.account_id === accountId && item.platform === platform);
  if (!content) {
    throw new Error(`Content ${contentId} was not found under ${clientId}`);
  }
  if (!account) {
    throw new Error(`Account ${accountId} was not found for platform ${platform} under ${clientId}`);
  }

  const variant: PlatformVariant = {
    variant_id: arg("variant_id", id(`variant_${platform}`)),
    content_id: content.content_id,
    client_id: clientId,
    platform,
    account_id: account.account_id,
    format: arg("format", defaultFormat(platform)),
    caption: arg("caption", buildPlatformCaption(platform, content)),
    hashtags: csv(arg("hashtags", defaultHashtags(platform, content.category_id).join(","))),
    media_path: arg("media_path", `data/clients/${clientId}/exports/${platform}/${content.content_theme}_${platform}.mp4`),
    cta: arg("cta", defaultCta(platform, content.cta)),
    language: account.language,
    account_role: account.account_role,
    content_focus: account.content_focus,
    status: "ready_for_review",
    approval_status: "ready_for_review",
    rejection_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  variants.push(variant);
  await writeClientArray(clientId, "platform-variants.json", variants);
  console.log(`Created ${platform} variant ${variant.variant_id}`);
}

async function generateVariants(): Promise<void> {
  const clientId = arg("client_id");
  const contentId = arg("content_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const content = contents.find((item) => item.content_id === contentId);
  if (!content) throw new Error(`Content ${contentId} was not found under ${clientId}`);
  const accounts = (await readClientArray<PlatformAccount>(clientId, "accounts.json")).filter((account) => account.status === "active" && account.posting_enabled);
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const rules = await readStyleRules();
  const created: PlatformVariant[] = [];
  for (const account of accounts) {
    const variant = buildVariantForAccount(content, account, rules);
    if (variants.some((item) => item.content_id === content.content_id && item.account_id === account.account_id)) continue;
    variants.push(variant);
    created.push(variant);
  }
  ensureDistinctCaptions(created);
  await writeClientArray(clientId, "platform-variants.json", variants);
  console.log(JSON.stringify(created, null, 2));
}

async function approveContent(): Promise<void> {
  const clientId = arg("client_id");
  const contentId = arg("content_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const content = contents.find((item) => item.content_id === contentId);
  if (!content) {
    throw new Error(`Content ${contentId} was not found under ${clientId}`);
  }
  content.status = "approved";
  content.approved_by_human = true;
  content.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "content-pool.json", contents);
  console.log(`Approved content ${contentId}`);
}

async function rejectContent(): Promise<void> {
  const clientId = arg("client_id");
  const contentId = arg("content_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const content = contents.find((item) => item.content_id === contentId);
  if (!content) throw new Error(`Content ${contentId} was not found under ${clientId}`);
  content.status = "failed";
  content.approved_by_human = false;
  content.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "content-pool.json", contents);
  console.log(`Rejected content ${contentId}`);
}

async function contentStatus(): Promise<void> {
  const clientId = arg("client_id");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const summary = contents.map((content) => ({
    content_id: content.content_id,
    theme: content.content_theme,
    status: content.status,
    approved_by_human: content.approved_by_human,
    variants: variants.filter((variant) => variant.content_id === content.content_id).length,
    approved_variants: variants.filter((variant) => variant.content_id === content.content_id && variant.approval_status === "approved").length
  }));
  console.log(JSON.stringify(summary, null, 2));
}

async function approveVariant(): Promise<void> {
  const clientId = arg("client_id");
  const variantId = arg("variant_id");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) {
    throw new Error(`Variant ${variantId} was not found under ${clientId}`);
  }
  variant.status = "approved";
  variant.approval_status = "approved";
  variant.rejection_reason = null;
  variant.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "platform-variants.json", variants);
  console.log(`Approved variant ${variantId}`);
}

async function rejectVariant(): Promise<void> {
  const clientId = arg("client_id");
  const variantId = arg("variant_id");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) throw new Error(`Variant ${variantId} was not found under ${clientId}`);
  variant.status = "failed";
  variant.approval_status = "rejected";
  variant.rejection_reason = arg("rejection_reason", "Rejected by human reviewer");
  variant.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "platform-variants.json", variants);
  console.log(`Rejected variant ${variantId}`);
}

async function schedulePublish(): Promise<void> {
  const clientId = arg("client_id");
  const variantId = arg("variant_id");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) {
    throw new Error(`Variant ${variantId} was not found under ${clientId}`);
  }
  const content = contents.find((item) => item.content_id === variant.content_id);
  const account = accounts.find((item) => item.account_id === variant.account_id);
  const now = new Date().toISOString();
  const task: PublishTask = {
    publish_task_id: arg("publish_task_id", id("pub")),
    client_id: clientId,
    content_id: variant.content_id,
    variant_id: variant.variant_id,
    platform: variant.platform,
    account_id: variant.account_id,
    scheduled_at: arg("scheduled_at", new Date().toISOString()),
    status: "scheduled",
    approval_status: "approved",
    publish_method: "mock",
    platform_post_id: null,
    published_at: null,
    error_message: null,
    blocked_reason: null,
    retry_count: 0,
    max_retry: Number(arg("max_retry", "3")),
    last_error: null,
    next_retry_at: null,
    created_at: now,
    updated_at: now
  };
  const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities });
  if (!readiness.ready) {
    blockTask(task, readiness.reason, readiness.needsManualReview);
  }

  queue.push(task);
  await writeClientArray(clientId, "publish-queue.json", queue);
  console.log(`${task.status === "blocked" ? "Blocked" : "Scheduled"} publish task ${task.publish_task_id}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`);
}

async function runPublishQueue(): Promise<void> {
  const clientId = arg("client_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const now = new Date();

  for (const task of queue) {
    if (task.status !== "scheduled") {
      continue;
    }
    if (new Date(task.scheduled_at) > now) {
      continue;
    }
    if (task.next_retry_at && new Date(task.next_retry_at) > now) {
      continue;
    }
    if (task.platform_post_id || task.published_at) {
      task.status = "published";
      continue;
    }
    try {
      assertPublishApproved(task);
    } catch (error) {
      blockTask(task, error instanceof Error ? error.message : "approval_status must be approved before publishing");
      continue;
    }
    const variant = variants.find((item) => item.variant_id === task.variant_id);
    const content = contents.find((item) => item.content_id === task.content_id);
    const account = accounts.find((item) => item.account_id === task.account_id);
    const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities, currentTaskId: task.publish_task_id });
    if (!readiness.ready) {
      blockTask(task, readiness.reason, readiness.needsManualReview);
      continue;
    }

    task.status = "publishing";
    task.updated_at = new Date().toISOString();
    if (!isPublishablePlatform(task.platform)) {
      blockTask(task, `${task.platform} is reserved and cannot publish in Phase 1`);
      continue;
    }
    if (!variant) {
      blockTask(task, `Variant ${task.variant_id} was not found`);
      continue;
    }
    const result = await publishers[task.platform].publish(task, variant);
    if (result.ok) {
      task.status = "published";
      task.platform_post_id = result.platform_post_id;
      task.published_at = new Date().toISOString();
      task.error_message = null;
      task.blocked_reason = null;
      task.last_error = null;
      task.next_retry_at = null;
      task.updated_at = new Date().toISOString();
      records.push({
        publish_record_id: id("record"),
        publish_task_id: task.publish_task_id,
        client_id: task.client_id,
        content_id: task.content_id,
        variant_id: task.variant_id,
        platform: task.platform,
        account_id: task.account_id,
        platform_post_id: result.platform_post_id ?? `${task.platform}_mock_${task.publish_task_id}`,
        published_at: task.published_at,
        status: "published",
        publish_mode: "mock",
        mock_url: result.mock_url ?? `https://mock.social/${task.platform}/${result.platform_post_id ?? task.publish_task_id}`
      });
    } else {
      registerPublishFailure(task, result.error_message ?? "Unknown publish error");
    }
  }

  await writeClientArray(clientId, "publish-queue.json", queue);
  await writeClientArray(clientId, "publish-records.json", records);
  console.log(`Publish queue processed for ${clientId}`);
}

async function publishStatus(): Promise<void> {
  const clientId = arg("client_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const grouped = queue.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify(grouped, null, 2));
}

async function listPublishTasks(): Promise<void> {
  const clientId = arg("client_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  console.log(JSON.stringify(queue, null, 2));
}

async function cancelPublishTask(): Promise<void> {
  const clientId = arg("client_id");
  const taskId = arg("publish_task_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const task = findPublishTask(queue, taskId);
  if (task.status === "published") throw new Error("Published task cannot be cancelled.");
  task.status = "cancelled";
  task.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "publish-queue.json", queue);
  console.log(`Cancelled publish task ${taskId}`);
}

async function reschedulePublishTask(): Promise<void> {
  const clientId = arg("client_id");
  const taskId = arg("publish_task_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const task = findPublishTask(queue, taskId);
  if (task.status === "published") throw new Error("Published task cannot be rescheduled.");
  task.scheduled_at = arg("scheduled_at");
  task.status = "scheduled";
  task.blocked_reason = null;
  task.error_message = null;
  task.updated_at = new Date().toISOString();
  const variant = variants.find((item) => item.variant_id === task.variant_id);
  const content = contents.find((item) => item.content_id === task.content_id);
  const account = accounts.find((item) => item.account_id === task.account_id);
  const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities, currentTaskId: task.publish_task_id });
  if (!readiness.ready) blockTask(task, readiness.reason, readiness.needsManualReview);
  await writeClientArray(clientId, "publish-queue.json", queue);
  console.log(`${task.blocked_reason ? "Blocked" : "Rescheduled"} publish task ${taskId}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`);
}

async function retryPublishTask(): Promise<void> {
  const clientId = arg("client_id");
  const taskId = arg("publish_task_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const task = findPublishTask(queue, taskId);
  if (task.status === "published") throw new Error("Published task cannot be retried.");
  if (task.status === "cancelled") throw new Error("Cancelled task cannot be retried.");
  task.status = "scheduled";
  task.next_retry_at = null;
  task.blocked_reason = null;
  task.error_message = null;
  task.updated_at = new Date().toISOString();
  const variant = variants.find((item) => item.variant_id === task.variant_id);
  const content = contents.find((item) => item.content_id === task.content_id);
  const account = accounts.find((item) => item.account_id === task.account_id);
  const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities, currentTaskId: task.publish_task_id });
  if (!readiness.ready) blockTask(task, readiness.reason, readiness.needsManualReview);
  await writeClientArray(clientId, "publish-queue.json", queue);
  console.log(`${task.blocked_reason ? "Blocked" : "Retried"} publish task ${taskId}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`);
}

async function publishCalendar(): Promise<void> {
  const clientId = arg("client_id");
  const from = arg("from", new Date().toISOString().slice(0, 10));
  const to = arg("to", from);
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const calendar = queue
    .filter((task) => task.scheduled_at.slice(0, 10) >= from && task.scheduled_at.slice(0, 10) <= to)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  console.log(JSON.stringify(calendar, null, 2));
}

async function scheduleBatch(): Promise<void> {
  const clientId = arg("client_id");
  const date = arg("date", new Date().toISOString().slice(0, 10));
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const created: PublishTask[] = [];
  const existingVariantIds = new Set(queue.filter((task) => task.status !== "cancelled").map((task) => task.variant_id));
  for (const variant of variants.filter((item) => item.approval_status === "approved" && item.status === "approved")) {
    if (existingVariantIds.has(variant.variant_id)) continue;
    const content = contents.find((item) => item.content_id === variant.content_id);
    const account = accounts.find((item) => item.account_id === variant.account_id);
    const scheduledAt = findNextSlot(date, variant.platform, variant.account_id, queue, rules);
    const now = new Date().toISOString();
    const task: PublishTask = {
      publish_task_id: id("pub"),
      client_id: clientId,
      content_id: variant.content_id,
      variant_id: variant.variant_id,
      platform: variant.platform,
      account_id: variant.account_id,
      scheduled_at: scheduledAt,
      status: "scheduled",
      approval_status: "approved",
      publish_method: "mock",
      platform_post_id: null,
      published_at: null,
      error_message: null,
      blocked_reason: null,
      retry_count: 0,
      max_retry: 3,
      last_error: null,
      next_retry_at: null,
      created_at: now,
      updated_at: now
    };
    const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities });
    if (!readiness.ready) blockTask(task, readiness.reason, readiness.needsManualReview);
    queue.push(task);
    created.push(task);
  }
  await writeClientArray(clientId, "publish-queue.json", queue);
  console.log(JSON.stringify(created.map((task) => ({ publish_task_id: task.publish_task_id, variant_id: task.variant_id, scheduled_at: task.scheduled_at, status: task.status, blocked_reason: task.blocked_reason })), null, 2));
}

async function importLead(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const category = getCategory(client.industry);
  const rule = (await readLeadScoringRules())[client.industry];
  const capabilities = await readPlatformCapabilities();
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const platform = arg("platform", "instagram") as Platform;
  const fallbackAccount = accounts.find((account) => account.platform === platform && account.status === "active" && account.lead_tracking_enabled);
  const accountId = arg("account_id", fallbackAccount?.account_id ?? "");
  const account = accounts.find((item) => item.account_id === accountId);
  if (!account) throw new Error(`Account ${accountId} was not found under ${clientId}.`);
  if (account.client_id !== clientId) throw new Error(`Account ${accountId} does not belong to ${clientId}.`);
  if (account.status !== "active") throw new Error(`Account ${accountId} is inactive and cannot import valid leads.`);
  if (!account.lead_tracking_enabled) throw new Error(`Account ${accountId} has lead tracking disabled.`);
  const sourceType = enumArg("source_type", "comment", leadSourceTypes);
  const sourceMode = leadSourceMode(sourceType, account, capabilities);
  const messageText = arg("message_text", "我孩子现在大一，可以转到加拿大吗？");
  const leadScore = scoreLead(messageText, category, rule);
  const intent = classifyIntent(messageText, rule);
  const now = new Date().toISOString();
  const lead: Lead = {
    lead_id: arg("lead_id", id("lead")),
    client_id: clientId,
    platform,
    account_id: account.account_id,
    source_type: sourceType,
    source_mode: sourceMode,
    source_post_id: nullableArg("source_post_id"),
    source_url: nullableArg("source_url"),
    user_handle: arg("user_handle", "canada_parent_88"),
    user_display_name: arg("user_display_name", "Lily"),
    message_text: messageText,
    detected_intent: intent,
    lead_score: leadScore,
    lead_stage: leadStageFromScore(leadScore, rule),
    recommended_reply: "",
    human_review_required: leadScore >= (rule?.score_rules.qualified_threshold ?? 60),
    assigned_to: arg("assigned_to", "jason"),
    next_follow_up_at: nullableArg("next_follow_up_at"),
    last_contacted_at: null,
    contact_method: arg("contact_method", account.platform === "instagram" ? "dm" : "unknown") as Lead["contact_method"],
    lead_notes: csv(arg("lead_notes", "")),
    created_at: now,
    updated_at: now
  };
  lead.recommended_reply = generateReplyDraft(client, lead);
  leads.push(lead);
  await writeClientArray(clientId, "leads.json", leads);
  console.log(`Imported lead ${lead.lead_id} with score ${lead.lead_score}`);
}

async function scoreLeads(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const category = getCategory(client.industry);
  const rule = (await readLeadScoringRules())[client.industry];
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  for (const lead of leads) {
    lead.detected_intent = classifyIntent(lead.message_text, rule);
    lead.lead_score = scoreLead(lead.message_text, category, rule);
    lead.lead_stage = leadStageFromScore(lead.lead_score, rule, lead.lead_stage);
    lead.recommended_reply = generateReplyDraft(client, lead);
    lead.human_review_required = lead.lead_score >= (rule?.score_rules.qualified_threshold ?? 60);
    lead.updated_at = new Date().toISOString();
  }
  await writeClientArray(clientId, "leads.json", leads);
  console.log(`Scored ${leads.length} leads for ${clientId}`);
}

async function upsertReplyDraft(clientId: string, lead: Lead): Promise<void> {
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const existing = drafts.find((draft) => draft.lead_id === lead.lead_id);
  const now = new Date().toISOString();
  if (existing) {
    existing.draft_text = lead.recommended_reply;
    existing.platform = lead.platform;
    existing.account_id = lead.account_id;
    existing.tone = existing.tone || "professional, helpful";
    existing.approval_status = "draft";
    existing.rejection_reason = null;
    existing.updated_at = now;
  } else {
    drafts.push({
      reply_draft_id: id("reply"),
      lead_id: lead.lead_id,
      client_id: clientId,
      platform: lead.platform,
      account_id: lead.account_id,
      draft_text: lead.recommended_reply,
      tone: arg("tone", "professional, helpful"),
      approval_status: "draft",
      rejection_reason: null,
      sent_status: "not_sent",
      created_at: now,
      updated_at: now
    });
  }
  await writeClientArray(clientId, "reply-drafts.json", drafts);
}

async function generateReplyForLead(): Promise<void> {
  const clientId = arg("client_id");
  const leadId = arg("lead_id");
  const client = await readClient(clientId);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const lead = findLead(leads, leadId);
  lead.recommended_reply = generateReplyDraft(client, lead);
  lead.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "leads.json", leads);
  await upsertReplyDraft(clientId, lead);
  console.log(`Generated reply draft for ${leadId}`);
}

async function approveReplyDraft(): Promise<void> {
  await setReplyDraftApproval("approved");
}

async function rejectReplyDraft(): Promise<void> {
  await setReplyDraftApproval("rejected");
}

async function setReplyDraftApproval(status: "approved" | "rejected"): Promise<void> {
  const clientId = arg("client_id");
  const draftId = arg("reply_draft_id");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const draft = findReplyDraft(drafts, draftId);
  draft.approval_status = status;
  draft.rejection_reason = status === "rejected" ? arg("rejection_reason", "Rejected by human reviewer") : null;
  draft.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "reply-drafts.json", drafts);
  console.log(`${status === "approved" ? "Approved" : "Rejected"} reply draft ${draftId}`);
}

async function listReplyDrafts(): Promise<void> {
  const clientId = arg("client_id");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  console.log(JSON.stringify(drafts, null, 2));
}

async function updateLead(): Promise<void> {
  const clientId = arg("client_id");
  const leadId = arg("lead_id");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const lead = findLead(leads, leadId);
  if (typeof args.lead_stage === "string") lead.lead_stage = enumArg("lead_stage", lead.lead_stage, leadStages);
  if (typeof args.assigned_to === "string") lead.assigned_to = args.assigned_to;
  if (typeof args.next_follow_up_at === "string") lead.next_follow_up_at = args.next_follow_up_at || null;
  if (typeof args.last_contacted_at === "string") lead.last_contacted_at = args.last_contacted_at || null;
  if (typeof args.contact_method === "string") lead.contact_method = args.contact_method as Lead["contact_method"];
  if (typeof args.lead_notes === "string") lead.lead_notes = csv(args.lead_notes);
  lead.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "leads.json", leads);
  console.log(`Updated lead ${leadId}`);
}

function findLead(leads: Lead[], leadId: string): Lead {
  const lead = leads.find((item) => item.lead_id === leadId);
  if (!lead) throw new Error(`Lead ${leadId} was not found.`);
  return lead;
}

function findReplyDraft(drafts: ReplyDraft[], draftId: string): ReplyDraft {
  const draft = drafts.find((item) => item.reply_draft_id === draftId);
  if (!draft) throw new Error(`Reply draft ${draftId} was not found.`);
  return draft;
}

function leadStageFromScore(score: number, rule?: LeadScoringRule, existing?: Lead["lead_stage"]): Lead["lead_stage"] {
  if (score <= (rule?.score_rules.spam_threshold ?? 10)) return "spam";
  if (score >= (rule?.score_rules.qualified_threshold ?? 60)) return "qualified";
  return existing && existing !== "spam" && existing !== "qualified" ? existing : "new";
}

function leadSourceMode(sourceType: Lead["source_type"], account: PlatformAccount, capabilities: PlatformCapabilityMap): Lead["source_mode"] {
  const capability = mergedCapabilities(account.platform, account, capabilities);
  if (sourceType === "manual" || sourceType === "form" || sourceType === "email" || sourceType === "whatsapp") return "manual";
  if (sourceType === "comment" && capability.can_read_comments === false) return "manual";
  if (sourceType === "dm" && capability.can_read_dm === false) return "manual";
  if (capability.supports_real_api !== true) return "manual";
  return "api";
}

async function generateDailyReport(): Promise<void> {
  const clientId = arg("client_id");
  const date = arg("date", new Date().toISOString().slice(0, 10));
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const activeAccountIds = new Set(accounts.filter((account) => account.status === "active").map((account) => account.account_id));
  const leadTrackingAccountIds = new Set(accounts.filter((account) => account.status === "active" && account.lead_tracking_enabled).map((account) => account.account_id));
  const reportQueue = queue.filter((task) => activeAccountIds.has(task.account_id));
  const reportRecords = records.filter((record) => activeAccountIds.has(record.account_id));
  const reportLeads = leads.filter((lead) => leadTrackingAccountIds.has(lead.account_id));
  const reportDrafts = drafts.filter((draft) => leadTrackingAccountIds.has(draft.account_id));
  const report = {
    client_id: clientId,
    date,
    publish_count: reportRecords.filter((record) => record.published_at?.startsWith(date)).length,
    platform_status: reportQueue.reduce<Record<string, Record<string, number>>>((acc, task) => {
      acc[task.platform] ??= {};
      acc[task.platform][task.status] = (acc[task.platform][task.status] ?? 0) + 1;
      return acc;
    }, {}),
    failed_tasks: reportQueue.filter((task) => task.status === "failed"),
    interaction_count: reportLeads.filter((lead) => lead.created_at.startsWith(date)).length,
    new_leads: reportLeads.filter((lead) => lead.created_at.startsWith(date) && lead.lead_stage === "new").length,
    qualified_leads: reportLeads.filter((lead) => lead.created_at.startsWith(date) && lead.lead_stage === "qualified").length,
    high_score_leads: reportLeads.filter((lead) => lead.lead_score >= 70),
    spam_count: reportLeads.filter((lead) => lead.created_at.startsWith(date) && lead.lead_stage === "spam").length,
    reply_drafts_generated: reportDrafts.filter((draft) => draft.created_at.startsWith(date)).length,
    follow_ups_due: reportLeads.filter((lead) => lead.next_follow_up_at?.slice(0, 10) === date),
    converted_leads: reportLeads.filter((lead) => lead.created_at.startsWith(date) && lead.lead_stage === "converted").length,
    human_follow_up_required: reportLeads.filter((lead) => lead.human_review_required && lead.lead_stage !== "spam"),
    top_content_themes: summarizeThemes(contents)
  };
  const reportPath = join(clientDir(clientId), "reports", "daily", `${date}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Daily report written to ${reportPath}`);
}

async function generateWeeklyReport(): Promise<void> {
  const clientId = arg("client_id");
  const weekStart = arg("week_start", startOfWeek(new Date()).toISOString().slice(0, 10));
  const weekEnd = arg("week_end", endOfWeek(new Date(`${weekStart}T00:00:00.000Z`)).toISOString().slice(0, 10));
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const activeAccountIds = new Set(accounts.filter((account) => account.status === "active").map((account) => account.account_id));
  const leadTrackingAccountIds = new Set(accounts.filter((account) => account.status === "active" && account.lead_tracking_enabled).map((account) => account.account_id));
  const reportQueue = queue.filter((task) => activeAccountIds.has(task.account_id));
  const reportRecords = records.filter((record) => activeAccountIds.has(record.account_id));
  const reportLeads = leads.filter((lead) => leadTrackingAccountIds.has(lead.account_id));
  const reportDrafts = drafts.filter((draft) => leadTrackingAccountIds.has(draft.account_id));
  const inRange = (value: string | null): boolean => Boolean(value && value >= `${weekStart}T00:00:00` && value <= `${weekEnd}T23:59:59`);
  const weeklyLeads = reportLeads.filter((lead) => inRange(lead.created_at));
  const weeklyRecords = reportRecords.filter((record) => inRange(record.published_at));
  const report = {
    client_id: clientId,
    week_start: weekStart,
    week_end: weekEnd,
    published_count: weeklyRecords.length,
    platform_publish_status: reportQueue.reduce<Record<string, Record<string, number>>>((acc, task) => {
      acc[task.platform] ??= {};
      acc[task.platform][task.status] = (acc[task.platform][task.status] ?? 0) + 1;
      return acc;
    }, {}),
    failed_tasks: reportQueue.filter((task) => task.status === "failed"),
    retry_pending_tasks: reportQueue.filter((task) => task.next_retry_at),
    new_leads: weeklyLeads.length,
    qualified_leads: weeklyLeads.filter((lead) => lead.lead_stage === "qualified").length,
    high_value_leads: weeklyLeads.filter((lead) => lead.lead_score >= 70),
    spam_count: weeklyLeads.filter((lead) => lead.lead_stage === "spam").length,
    reply_drafts_generated: reportDrafts.filter((draft) => inRange(draft.created_at)).length,
    follow_ups_due: reportLeads.filter((lead) => inRange(lead.next_follow_up_at)),
    converted_leads: weeklyLeads.filter((lead) => lead.lead_stage === "converted").length,
    follow_up_required: weeklyLeads.filter((lead) => lead.human_review_required && lead.lead_stage !== "spam"),
    best_content_themes: summarizeThemes(contents),
    next_week_recommendations: buildWeeklyRecommendations(contents, weeklyLeads)
  };
  const reportPath = join(clientDir(clientId), "reports", "weekly", `${weekStart}_${weekEnd}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Weekly report written to ${reportPath}`);
}

function registerPublishFailure(task: PublishTask, message: string): void {
  task.retry_count = (task.retry_count ?? 0) + 1;
  task.error_message = message;
  task.last_error = message;
  if (task.retry_count < (task.max_retry ?? 3)) {
    task.status = "scheduled";
    task.next_retry_at = new Date(Date.now() + task.retry_count * 15 * 60 * 1000).toISOString();
  } else {
    task.status = "failed";
    task.next_retry_at = null;
  }
  task.updated_at = new Date().toISOString();
}

function findPublishTask(queue: PublishTask[], taskId: string): PublishTask {
  const task = queue.find((item) => item.publish_task_id === taskId);
  if (!task) throw new Error(`Publish task ${taskId} was not found.`);
  return task;
}

async function readPublishRules(): Promise<PublishRules> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "publish-rules.json"), "utf8")) as PublishRules;
}

async function readLeadScoringRules(): Promise<LeadScoringRules> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "lead-scoring-rules.json"), "utf8")) as LeadScoringRules;
}

async function readPlatformCapabilities(): Promise<PlatformCapabilityMap> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "platform-capabilities.json"), "utf8")) as PlatformCapabilityMap;
}

async function checkPublishReadiness(input: {
  content: ContentAsset | undefined;
  variant: PlatformVariant | undefined;
  account: PlatformAccount | undefined;
  queue: PublishTask[];
  task: PublishTask;
  rules: PublishRules;
  capabilities: PlatformCapabilityMap;
  currentTaskId?: string;
}): Promise<{ ready: true } | { ready: false; reason: string; needsManualReview?: boolean }> {
  const { content, variant, account, queue, task, rules, capabilities, currentTaskId } = input;
  if (!content) return { ready: false, reason: `Content ${task.content_id} was not found` };
  try {
    assertContentApproved(content);
  } catch (error) {
    return { ready: false, reason: error instanceof Error ? error.message : "content must be approved" };
  }
  if (!variant) return { ready: false, reason: `Variant ${task.variant_id} was not found` };
  try {
    assertVariantApproved(variant);
  } catch (error) {
    return { ready: false, reason: error instanceof Error ? error.message : "variant must be approved" };
  }
  if (variant.status !== "approved") return { ready: false, reason: `Variant ${variant.variant_id} status must be approved` };
  if (variant.account_id !== task.account_id) return { ready: false, reason: `Variant ${variant.variant_id} is not bound to account ${task.account_id}` };
  try {
    assertAccountCanPublish(account, task.account_id);
  } catch (error) {
    return { ready: false, reason: error instanceof Error ? error.message : "account cannot publish" };
  }
  if (!isPublishablePlatform(task.platform)) return { ready: false, reason: `${task.platform} is reserved and cannot publish in Phase 1` };
  const taskCapability = mergedCapabilities(task.platform, account, capabilities);
  if (task.publish_method === "official_api" && taskCapability.supports_real_api === false) {
    return { ready: false, reason: `${task.platform} does not support real API publishing; use mock or manual workflow` };
  }
  if (task.publish_method === "official_api" && taskCapability.supports_real_api === "limited") {
    return { ready: false, reason: `${task.platform} real API publishing is limited and needs manual workflow`, needsManualReview: true };
  }
  const capabilityResult = checkPublishCapabilities(content, variant, account, capabilities);
  if (!capabilityResult.ready) return capabilityResult;
  const scheduled = new Date(task.scheduled_at);
  if (Number.isNaN(scheduled.getTime())) return { ready: false, reason: `Invalid scheduled_at: ${task.scheduled_at}` };
  const rule = rules[task.platform];
  if (!rule) return { ready: false, reason: `No publish rules configured for ${task.platform}` };
  if (!isWithinAllowedWindow(task.scheduled_at, rule)) return { ready: false, reason: `${task.platform} scheduled_at is outside allowed time windows` };
  const frequencyReason = checkFrequencyLimit(task, queue, rule, currentTaskId);
  if (frequencyReason) return { ready: false, reason: frequencyReason };
  if (!(await hasPublishableMedia(variant, rule))) return { ready: false, reason: `media_path is missing or does not exist for ${task.platform}` };
  return { ready: true };
}

function checkPublishCapabilities(
  content: ContentAsset,
  variant: PlatformVariant,
  account: PlatformAccount | undefined,
  capabilities: PlatformCapabilityMap
): { ready: true } | { ready: false; reason: string; needsManualReview?: boolean } {
  const capability = mergedCapabilities(variant.platform, account, capabilities);
  if (!capability.supports_mock) return { ready: false, reason: `${variant.platform} does not support mock workflow` };
  const checks: Array<[keyof PlatformCapabilities, string]> = [];
  const format = variant.format.toLowerCase();
  const hasImage = content.content_type === "image_post" || content.media_assets.some((asset) => asset.type === "image");
  const hasVideo = content.content_type === "short_video" || content.media_assets.some((asset) => asset.type === "video") || Boolean(variant.media_path);
  const isCarousel = content.content_type === "carousel" || format.includes("carousel");
  const isReel = format.includes("reel");
  const isDraft = format.includes("draft");
  const isTextOnly = !hasImage && !hasVideo && !isCarousel && !isReel;
  if (isTextOnly) checks.push(["can_publish_text", "text publishing"]);
  if (hasImage) checks.push(["can_publish_image", "image publishing"]);
  if (hasVideo) checks.push(["can_publish_video", "video publishing"]);
  if (isCarousel) checks.push(["can_publish_carousel", "carousel publishing"]);
  if (isReel) checks.push(["can_publish_reel", "reel publishing"]);
  if (isDraft) checks.push(["can_publish_draft", "draft publishing"]);
  for (const [field, label] of checks) {
    const value = capability[field];
    if (value === false) return { ready: false, reason: `${variant.platform} cannot perform ${label}` };
    if (value === "limited" || capability.requires_human_review === true || capability.requires_human_review === "limited") {
      return { ready: false, reason: `${variant.platform} ${label} is limited and needs manual review`, needsManualReview: true };
    }
  }
  return { ready: true };
}

function mergedCapabilities(platform: Platform, account: PlatformAccount | undefined, capabilities: PlatformCapabilityMap): PlatformCapabilities {
  return { ...capabilities[platform], ...(account?.capability_override ?? {}) };
}

function checkFrequencyLimit(task: PublishTask, queue: PublishTask[], rule: PublishRule, currentTaskId?: string): string | null {
  const date = task.scheduled_at.slice(0, 10);
  const relevant = queue.filter((item) =>
    item.publish_task_id !== currentTaskId &&
    item.account_id === task.account_id &&
    item.scheduled_at.slice(0, 10) === date &&
    !["cancelled", "failed", "blocked"].includes(item.status)
  );
  if (relevant.length >= rule.max_posts_per_account_per_day) {
    return `${task.account_id} exceeds ${rule.max_posts_per_account_per_day} posts per day for ${task.platform}`;
  }
  const scheduledTime = new Date(task.scheduled_at).getTime();
  const minMs = rule.min_minutes_between_posts * 60 * 1000;
  const tooClose = relevant.find((item) => Math.abs(new Date(item.scheduled_at).getTime() - scheduledTime) < minMs);
  return tooClose ? `${task.account_id} needs at least ${rule.min_minutes_between_posts} minutes between posts` : null;
}

async function hasPublishableMedia(variant: PlatformVariant, rule: PublishRule): Promise<boolean> {
  if (rule.supports_text_only) return true;
  if (!variant.media_path) return false;
  try {
    await access(join(process.cwd(), variant.media_path));
    return true;
  } catch {
    return false;
  }
}

function isWithinAllowedWindow(isoValue: string, rule: PublishRule): boolean {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return rule.allowed_time_windows.some(([start, end]) => {
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    return minutes >= startMinutes && minutes <= endMinutes;
  });
}

function findNextSlot(date: string, platform: Platform, accountId: string, queue: PublishTask[], rules: PublishRules): string {
  const rule = rules[platform];
  const [start] = rule.allowed_time_windows[0] ?? ["09:00", "17:00"];
  const [hour, minute] = start.split(":").map(Number);
  const slot = new Date(`${date}T00:00:00`);
  slot.setHours(hour, minute, 0, 0);
  for (let attempt = 0; attempt < rule.max_posts_per_account_per_day + 8; attempt += 1) {
    const candidate = slot.toISOString();
    const tempTask = {
      publish_task_id: "__candidate__",
      account_id: accountId,
      platform,
      scheduled_at: candidate,
      status: "scheduled"
    } as PublishTask;
    if (!checkFrequencyLimit(tempTask, queue, rule, "__candidate__") && isWithinAllowedWindow(candidate, rule)) {
      return candidate;
    }
    slot.setMinutes(slot.getMinutes() + rule.min_minutes_between_posts);
  }
  return new Date(`${date}T23:59:00`).toISOString();
}

function startOfWeek(date: Date): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function endOfWeek(date: Date): Date {
  const result = startOfWeek(date);
  result.setUTCDate(result.getUTCDate() + 6);
  return result;
}

function buildWeeklyRecommendations(contents: ContentAsset[], leads: Lead[]): string[] {
  const themes = Object.keys(summarizeThemes(contents));
  const leadIntents = [...new Set(leads.map((lead) => lead.detected_intent))].filter(Boolean);
  return [
    themes.length > 0 ? `继续复用表现中的内容主题：${themes.slice(0, 3).join(", ")}` : "下周先补齐 3-5 条基础内容资产。",
    leadIntents.length > 0 ? `围绕高意图线索继续制作内容：${leadIntents.slice(0, 3).join(", ")}` : "补充更明确的 CTA 来提高评论和私信线索。",
    "优先检查所有高分线索，并安排人工跟进。"
  ];
}

function summarizeThemes(contents: ContentAsset[]): Record<string, number> {
  return contents.reduce<Record<string, number>>((acc, content) => {
    acc[content.content_theme] = (acc[content.content_theme] ?? 0) + 1;
    return acc;
  }, {});
}

async function seedDemo(): Promise<void> {
  await runWithArgs("client:create", {
    client_id: "client_study_001",
    client_name: "ABC Study Abroad",
    category_id: "study_abroad"
  });
  for (const platform of ["instagram", "tiktok", "facebook", "x"] as const) {
    await runWithArgs("account:add", {
      client_id: "client_study_001",
      platform,
      account_id: `${platform === "instagram" ? "ig" : platform}_study_001`,
      account_name: `abc_study_${platform}`
    });
  }
  await runWithArgs("content:add", { client_id: "client_study_001", content_id: "content_20260508_001" });
  await runWithArgs("content:approve", { client_id: "client_study_001", content_id: "content_20260508_001" });
  await runWithArgs("content:variant", { client_id: "client_study_001", content_id: "content_20260508_001", platform: "instagram", account_id: "ig_study_001", variant_id: "variant_ig_001" });
  await runWithArgs("content:variant", { client_id: "client_study_001", content_id: "content_20260508_001", platform: "tiktok", account_id: "tiktok_study_001", variant_id: "variant_tk_001" });
  await runWithArgs("content:variant", { client_id: "client_study_001", content_id: "content_20260508_001", platform: "facebook", account_id: "facebook_study_001", variant_id: "variant_fb_001" });
  await runWithArgs("variant:approve", { client_id: "client_study_001", variant_id: "variant_ig_001" });
  await runWithArgs("variant:approve", { client_id: "client_study_001", variant_id: "variant_tk_001" });
  await runWithArgs("variant:approve", { client_id: "client_study_001", variant_id: "variant_fb_001" });
  await runWithArgs("publish:schedule", { client_id: "client_study_001", variant_id: "variant_ig_001", publish_task_id: "pub_20260508_001" });
  await runWithArgs("lead:import", { client_id: "client_study_001", message_text: "我孩子现在大一，可以转到加拿大吗？", platform: "instagram", account_id: "ig_study_001" });
  console.log("Demo data seeded for client_study_001");
}

async function runWithArgs(nextCommand: string, nextArgs: Record<string, string>): Promise<void> {
  const originalCommand = process.argv[2];
  const originalArgs = { ...args };
  Object.keys(args).forEach((key) => delete args[key]);
  Object.assign(args, nextArgs);
  process.argv[2] = nextCommand;
  switch (nextCommand) {
    case "client:create":
      await createClient();
      break;
    case "account:add":
      await addAccount();
      break;
    case "content:add":
      await addContent();
      break;
    case "content:approve":
      await approveContent();
      break;
    case "variant:approve":
      await approveVariant();
      break;
    case "content:variant":
      await createVariant();
      break;
    case "publish:schedule":
      await schedulePublish();
      break;
    case "lead:import":
      await importLead();
      break;
  }
  Object.keys(args).forEach((key) => delete args[key]);
  Object.assign(args, originalArgs);
  process.argv[2] = originalCommand;
}

function defaultFormat(platform: Platform): string {
  const formats: Record<Platform, string> = {
    instagram: "reel",
    tiktok: "short_video",
    facebook: "page_post",
    x: "post",
    linkedin: "company_post",
    youtube: "short"
  };
  return formats[platform];
}

function buildPlatformCaption(platform: Platform, content: ContentAsset): string {
  if (platform === "tiktok") {
    return `${content.title}。${content.hook} 评论区打关键词，我帮你判断。`;
  }
  if (platform === "facebook") {
    return `${content.title}\n\n${content.hook}\n\n${content.main_points.map((point) => `- ${point}`).join("\n")}\n\n${content.cta}`;
  }
  if (platform === "x") {
    return `${content.hook} ${content.cta}`;
  }
  return `${content.hook}\n\n${content.cta}`;
}

function defaultHashtags(platform: Platform, categoryId: string): string[] {
  if (categoryId === "study_abroad") {
    return platform === "facebook" ? ["#CanadaStudy", "#StudyAbroad", "#TransferCredit"] : ["#加拿大留学", "#转学分", "#留学生", "#多伦多留学"];
  }
  if (categoryId === "real_estate") {
    return ["#加拿大地产", "#买房", "#卖房", "#房产投资"];
  }
  return ["#海外社媒", "#品牌出海", "#获客"];
}

function defaultCta(platform: Platform, fallback: string): string {
  if (platform === "tiktok") {
    return "想知道你的情况能不能转，评论区打“转学分”。";
  }
  if (platform === "instagram") {
    return "私信我，帮你判断能不能转。";
  }
  return fallback;
}

async function readStyleRules(): Promise<Record<string, { formats: string[]; tone: string; caption_style: string; hashtag_count: number; cta_style: string }>> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "platform-style-rules.json"), "utf8"));
}

function defaultAngleForTheme(theme: ContentTheme): ContentAngle {
  const map: Record<ContentTheme, ContentAngle> = {
    brand_intro: "trust_building",
    product_intro: "education",
    pain_point: "problem_solution",
    case_study: "story",
    faq: "objection_handling",
    comparison: "education",
    myth_busting: "authority",
    how_to: "education",
    checklist: "education",
    offer: "conversion",
    lead_magnet: "conversion",
    testimonial: "trust_building"
  };
  return map[theme];
}

function defaultFunnelForTheme(theme: ContentTheme): ContentAsset["funnel_stage"] {
  if (["offer", "lead_magnet"].includes(theme)) return "lead_generation";
  if (["testimonial", "case_study"].includes(theme)) return "trust_building";
  if (theme === "brand_intro") return "awareness";
  return "lead_generation";
}

function buildContentTitle(client: Client, theme: ContentTheme): string {
  const readable = theme.replaceAll("_", " ");
  return `${client.client_name}: ${readable}`;
}

function buildContentHook(client: Client, theme: ContentTheme, categoryAngles: string[]): string {
  const audience = client.target_audience[0] ?? "your audience";
  const service = client.service_keywords[0] ?? client.business_type;
  if (theme === "pain_point") return `${audience} often struggle with ${service}, but the real issue is usually earlier in the decision process.`;
  if (theme === "brand_intro") return `${client.client_name} helps ${audience} make better decisions around ${service}.`;
  if (theme === "faq") return `One question we hear often: how should ${audience} think about ${service}?`;
  return `${categoryAngles[0] ?? "A practical insight"} for ${audience}: ${service} is easier to understand with the right framework.`;
}

function buildMainPoints(client: Client, theme: ContentTheme, accounts: PlatformAccount[]): string[] {
  const service = client.service_keywords[0] ?? client.business_type;
  const platformNote = accounts.length > 0 ? `Adapt this message across ${accounts.map((account) => account.platform).join(", ")}` : "Use this as a base content asset before platform adaptation";
  return [
    `Clarify the audience problem around ${service}`,
    `Explain why ${client.client_name} is relevant and trustworthy`,
    platformNote,
    "End with a soft CTA that creates a lead signal"
  ];
}

function buildContentCta(client: Client, theme: ContentTheme): string {
  const goal = client.lead_goal[0] ?? "DM inquiry";
  if (theme === "lead_magnet") return `Want the checklist? Send us a message and ask for ${client.service_keywords[0] ?? "the guide"}.`;
  return `Interested in ${goal}? Send us a message and we can help you decide the next step.`;
}

function buildVariantForAccount(content: ContentAsset, account: PlatformAccount, rules: Awaited<ReturnType<typeof readStyleRules>>): PlatformVariant {
  const now = new Date().toISOString();
  const rule = rules[account.platform] ?? rules.instagram;
  const caption = buildVariantCaption(content, account, rule);
  return {
    variant_id: id(`variant_${account.platform}`),
    content_id: content.content_id,
    client_id: content.client_id,
    platform: account.platform,
    account_id: account.account_id,
    format: rule.formats[0] ?? defaultFormat(account.platform),
    caption,
    hashtags: buildHashtags(content, account, rule.hashtag_count),
    media_path: null,
    cta: adaptCta(content.cta, account.platform),
    language: account.language,
    account_role: account.account_role,
    content_focus: account.content_focus,
    status: "ready_for_review",
    approval_status: "ready_for_review",
    rejection_reason: null,
    created_at: now,
    updated_at: now
  };
}

function buildVariantCaption(content: ContentAsset, account: PlatformAccount, rule: { tone: string; caption_style: string }): string {
  const role = account.account_role.replaceAll("_", " ");
  const focus = account.content_focus.replaceAll("_", " ");
  if (account.platform === "tiktok") return `${content.hook} Here is the quick version for ${focus}. ${content.cta}`;
  if (account.platform === "facebook") return `${content.title}\n\n${content.hook}\n\n${content.main_points.map((point) => `- ${point}`).join("\n")}\n\n${content.cta}`;
  if (account.platform === "x") return `${content.hook} ${content.main_points[0] ?? ""} ${content.cta}`;
  if (account.platform === "linkedin") return `${content.title}\n\n${content.hook}\n\nFor a ${role} account, the key point is ${content.main_points[0] ?? "clarity"}.\n\n${content.cta}`;
  return `${content.hook}\n\n${content.main_points.slice(0, 2).join("\n")}\n\n${content.cta}\n\nTone: ${rule.tone}`;
}

function buildHashtags(content: ContentAsset, account: PlatformAccount, count: number): string[] {
  const tags = [
    `#${content.content_theme.replaceAll("_", "")}`,
    `#${content.content_angle.replaceAll("_", "")}`,
    `#${account.content_focus.replaceAll("_", "")}`,
    `#${account.platform}`,
    "#socialops",
    "#leadgeneration"
  ];
  return tags.slice(0, count);
}

function adaptCta(cta: string, platform: Platform): string {
  if (platform === "tiktok") return `${cta} Comment a keyword if you want the next step.`;
  if (platform === "x") return `${cta} Reply or DM.`;
  if (platform === "facebook") return `${cta} Message the page to start.`;
  return cta;
}

function ensureDistinctCaptions(variants: PlatformVariant[]): void {
  const seen = new Map<string, number>();
  for (const variant of variants) {
    const count = seen.get(variant.caption) ?? 0;
    if (count > 0) {
      variant.caption = `${variant.caption}\n\nAccount angle: ${variant.account_role} / ${variant.content_focus}`;
    }
    seen.set(variant.caption, count + 1);
  }
}

function printHelp(): void {
  console.log(`Usage:
  npm run client:create -- --client_id client_study_001
  npm run account:add -- --client_id client_study_001 --platform instagram
  npm run content:add -- --client_id client_study_001
  npm run content:generate -- --client_id client_study_001 --theme brand_intro
  npm run content:variant:generate -- --client_id client_study_001 --content_id content_20260508_001
  npm run content:variant -- --client_id client_study_001 --content_id content_20260508_001 --platform instagram --account_id ig_study_001
  npm run content:approve -- --client_id client_study_001 --content_id content_20260508_001
  npm run variant:approve -- --client_id client_study_001 --variant_id variant_ig_001
  npm run publish:schedule -- --client_id client_study_001 --variant_id variant_ig_001
  npm run publish:run -- --client_id client_study_001
  npm run lead:import -- --client_id client_study_001 --message_text "我孩子现在大一，可以转到加拿大吗？"
  npm run report:daily -- --client_id client_study_001
  npm run report:weekly -- --client_id client_study_001`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

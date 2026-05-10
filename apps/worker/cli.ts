import { access, readFile, rm, writeFile } from "node:fs/promises";
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
  ReplyDraft,
  XEngagementItem,
  XKolProspect,
  XLeadCandidate,
  XPublicMetrics,
  XQueryHistoryEntry,
  XResearchPost
} from "../../packages/core/types.js";
import { classifyIntent } from "../../packages/lead-intelligence/classifyIntent.js";
import { generateReplyDraft } from "../../packages/lead-intelligence/generateReplyDraft.js";
import { scoreLead, type LeadScoringRule } from "../../packages/lead-intelligence/scoreLead.js";
import { facebookPublisher } from "../../packages/publishers/facebook/index.js";
import { instagramPublisher } from "../../packages/publishers/instagram/index.js";
import { tiktokPublisher } from "../../packages/publishers/tiktok/index.js";
import type { Publisher } from "../../packages/publishers/types.js";
import { getXApiUsageStats, resetXApiUsageStats, xApiGet } from "../../packages/publishers/x/apiClient.js";
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
const xApiCacheTtlHours = 24;
const xSearchPostLimit = 100;
const xKolDefaultPostLimit = 50;

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
interface XApiUsageEntry {
  timestamp: string;
  client_id: string;
  method: "GET";
  path: string;
  url: string;
  cost_units: number;
  cache_hit: boolean;
}
interface XBudgetCheck {
  estimatedCost: number;
  budgetUsed: number;
  budgetRemaining: number;
  budget: number;
}
const leadStages: Lead["lead_stage"][] = ["new", "qualified", "replied", "waiting_response", "booked", "converted", "not_interested", "spam"];
const leadSourceTypes: Lead["source_type"][] = ["comment", "dm", "form", "manual", "email", "whatsapp", "csv"];

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
    case "demo:e2e":
      return runE2EDemo();
    case "x:publish:test":
      return runXPublishTest();
    case "x:research:search":
      return xResearchSearch();
    case "x:kol:discover":
      return xKolDiscover();
    case "x:competitor:mine":
      return xCompetitorMine();
    case "x:lead:discover":
      return xLeadDiscover();
    case "x:engagement:sync":
      return xEngagementSync();
    case "x:dm:sync":
      return xDmSync();
    case "x:report":
      return xReport();
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
  if (value === true) return true;
  if (typeof value !== "string") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(value.toLowerCase());
}

function flagArg(name: string): boolean {
  return boolArg(name, false);
}

function modeArg(): "mock" | "api" {
  return enumArg("mode", "mock", ["mock", "api"]);
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
  if (typeof args.automation_settings === "string") account.automation_settings = {
    ...defaultAutomationSettings(),
    ...(JSON.parse(args.automation_settings) as Partial<NonNullable<PlatformAccount["automation_settings"]>>)
  };
  account.updated_at = new Date().toISOString();
}

function defaultAutomationSettings(): NonNullable<PlatformAccount["automation_settings"]> {
  return {
    auto_publish_enabled: false,
    auto_reply_enabled: false,
    auto_dm_enabled: false,
    auto_follow_enabled: false,
    auto_kol_discovery_enabled: false,
    auto_lead_discovery_enabled: false
  };
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
    monthly_api_budget: Number(arg("monthly_api_budget", "1000")),
    budget_warn_at: Number(arg("budget_warn_at", "700")),
    budget_block_at: Number(arg("budget_block_at", "950")),
    max_cost_per_command: Number(arg("max_cost_per_command", "100")),
    default_x_search_limit: Number(arg("default_x_search_limit", "50")),
    default_kol_discovery_limit: Number(arg("default_kol_discovery_limit", "50")),
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
  await writeClientArray<XResearchPost>(clientId, "x-research-posts.json", await readClientArray(clientId, "x-research-posts.json"));
  await writeClientArray<XKolProspect>(clientId, "kol-prospects.json", await readClientArray(clientId, "kol-prospects.json"));
  await writeClientArray<XLeadCandidate>(clientId, "lead-candidates.json", await readClientArray(clientId, "lead-candidates.json"));
  await writeClientArray<XEngagementItem>(clientId, "x-engagement-inbox.json", await readClientArray(clientId, "x-engagement-inbox.json"));
  await writeClientArray<XQueryHistoryEntry>(clientId, "x-query-history.json", await readClientArray(clientId, "x-query-history.json"));

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
    automation_settings: defaultAutomationSettings(),
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
    publish_method: enumArg("publish_method", "mock", ["mock", "official_api"]),
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
    console.log(`[publish] task=${task.publish_task_id} platform=${task.platform} method=${task.publish_method}`);
    if (result.ok) {
      const recordUrl = result.post_url ?? result.mock_url ?? `https://mock.social/${task.platform}/${result.platform_post_id ?? task.publish_task_id}`;
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
        publish_mode: result.publish_mode ?? (task.publish_method === "official_api" ? "api" : "mock"),
        mock_url: result.mock_url ?? recordUrl,
        post_url: recordUrl
      });
      console.log(`[publish] success task=${task.publish_task_id} mode=${result.publish_mode ?? "mock"} post_id=${task.platform_post_id} url=${recordUrl}`);
    } else {
      registerPublishFailure(task, result.error_message ?? "Unknown publish error");
      console.log(`[publish] failed task=${task.publish_task_id} retries=${task.retry_count}/${task.max_retry} error=${task.last_error}`);
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
      publish_method: enumArg("publish_method", "mock", ["mock", "official_api"]),
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
  if (sourceType === "csv") return "csv";
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
  if (task.publish_method === "official_api" && account?.auth_status !== "connected") {
    return { ready: false, reason: `Account ${task.account_id} must have auth_status connected for official API publishing` };
  }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
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
  const clientId = "client_demo_001";
  const now = "2026-05-10T09:00:00.000Z";
  await rm(clientDir(clientId), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await ensureClientDirectories(clientId);

  const client: Client = {
    client_id: clientId,
    client_name: "Maple Growth Demo",
    industry: "brand_global",
    business_type: "overseas_social_media_operations",
    region: "Canada",
    language: ["zh", "en"],
    target_audience: ["Chinese founders", "cross-border brands", "local service businesses"],
    service_keywords: ["overseas social media", "lead generation", "content operations", "brand awareness"],
    brand_tone: "professional, practical, trustworthy",
    lead_goal: ["book consultation", "DM inquiry", "website visit"],
    monthly_api_budget: 1000,
    budget_warn_at: 700,
    budget_block_at: 950,
    max_cost_per_command: 100,
    default_x_search_limit: 50,
    default_kol_discovery_limit: 50,
    status: "active"
  };

  const accountCapabilityOverride: Partial<PlatformCapabilities> = {
    can_publish_text: true,
    can_publish_image: true,
    can_publish_video: true,
    can_publish_carousel: true,
    can_publish_reel: true,
    can_publish_draft: true,
    supports_mock: true,
    requires_human_review: false
  };
  const accounts: PlatformAccount[] = [
    {
      account_id: "ig_demo_001",
      client_id: clientId,
      platform: "instagram",
      account_name: "maple_growth_ig",
      display_name: "Maple Growth Instagram",
      account_url: "https://instagram.com/maple_growth_demo",
      language: "zh",
      region: "Canada",
      account_role: "expert_advisor",
      content_focus: "lead_generation",
      posting_enabled: true,
      lead_tracking_enabled: true,
      auth_status: "mock",
      status: "active",
      capability_override: { ...accountCapabilityOverride, can_read_comments: false },
      automation_settings: defaultAutomationSettings(),
      notes: "Demo override: comments are manual import only.",
      created_at: now,
      updated_at: now
    },
    {
      account_id: "tiktok_demo_001",
      client_id: clientId,
      platform: "tiktok",
      account_name: "maple_growth_tiktok",
      display_name: "Maple Growth TikTok",
      account_url: "https://tiktok.com/@maple_growth_demo",
      language: "zh",
      region: "Canada",
      account_role: "education_content",
      content_focus: "brand_awareness",
      posting_enabled: true,
      lead_tracking_enabled: true,
      auth_status: "mock",
      status: "active",
      capability_override: { ...accountCapabilityOverride, can_read_dm: false },
      automation_settings: defaultAutomationSettings(),
      notes: "Demo override: TikTok DMs are manual workflow.",
      created_at: now,
      updated_at: now
    },
    {
      account_id: "facebook_demo_001",
      client_id: clientId,
      platform: "facebook",
      account_name: "maple_growth_facebook",
      display_name: "Maple Growth Facebook Page",
      account_url: "https://facebook.com/maple_growth_demo",
      language: "en",
      region: "Canada",
      account_role: "official_brand",
      content_focus: "trust_building",
      posting_enabled: true,
      lead_tracking_enabled: true,
      auth_status: "mock",
      status: "active",
      capability_override: { ...accountCapabilityOverride, can_read_dm: false },
      automation_settings: defaultAutomationSettings(),
      notes: "Demo override: Page posting enabled, DMs manual.",
      created_at: now,
      updated_at: now
    },
    {
      account_id: "x_demo_001",
      client_id: clientId,
      platform: "x",
      account_name: "maple_growth_x",
      display_name: "Maple Growth X",
      account_url: "https://x.com/maple_growth_demo",
      language: "en",
      region: "Canada",
      account_role: "founder_voice",
      content_focus: "community_engagement",
      posting_enabled: true,
      lead_tracking_enabled: true,
      auth_status: "mock",
      status: "active",
      capability_override: { ...accountCapabilityOverride, can_fetch_analytics: false },
      automation_settings: defaultAutomationSettings(),
      notes: "Demo override: analytics unavailable.",
      created_at: now,
      updated_at: now
    }
  ];

  const contents: ContentAsset[] = [
    {
      content_id: "content_demo_brand_intro_001",
      client_id: clientId,
      category_id: "brand_global",
      content_theme: "brand_intro",
      content_type: "text_post",
      content_angle: "trust_building",
      title: "Maple Growth Demo: 帮中国品牌把海外社媒变成线索系统",
      hook: "很多品牌出海第一步不是多发帖，而是先把客户、账号、内容和线索流程打通。",
      main_points: [
        "先定义客户业务和目标人群",
        "每个平台账号承担不同内容角色",
        "内容资产先审核，再生成平台版本",
        "发布后的评论和私信进入线索池"
      ],
      cta: "想看你的品牌适合怎么搭海外社媒获客流程，可以私信我们。",
      language: "zh",
      target_audience: ["Chinese founders", "cross-border brands"],
      funnel_stage: "awareness",
      media_assets: [],
      status: "approved",
      created_by: "demo:seed",
      approved_by_human: true,
      created_at: now,
      updated_at: now
    },
    {
      content_id: "content_demo_lead_generation_001",
      client_id: clientId,
      category_id: "brand_global",
      content_theme: "lead_magnet",
      content_type: "text_post",
      content_angle: "conversion",
      title: "Maple Growth Demo: 3 个信号判断海外社媒有没有带来真实线索",
      hook: "如果评论区和私信里开始出现预算、时间、怎么合作这些问题，就说明内容正在靠近成交。",
      main_points: [
        "高意向词通常包含价格、方案、预约和联系方式",
        "不同平台的线索质量要分开统计",
        "回复草稿必须留给人工审核或夜间复盘",
        "周报要能看出内容和线索之间的关系"
      ],
      cta: "想要一份海外社媒线索检查清单，可以留言 checklist。",
      language: "zh",
      target_audience: ["cross-border brands", "local service businesses"],
      funnel_stage: "lead_generation",
      media_assets: [],
      status: "approved",
      created_by: "demo:seed",
      approved_by_human: true,
      created_at: now,
      updated_at: now
    }
  ];

  const variants: PlatformVariant[] = contents.flatMap((content) => accounts.map((account) => {
    const variant = buildVariantForAccount(content, account, {
      instagram: { formats: ["caption"], tone: "visual and concise", caption_style: "short", hashtag_count: 4, cta_style: "dm" },
      tiktok: { formats: ["short_caption"], tone: "direct and conversational", caption_style: "quick", hashtag_count: 4, cta_style: "comment" },
      facebook: { formats: ["page_post"], tone: "trustworthy and explanatory", caption_style: "long", hashtag_count: 3, cta_style: "message" },
      x: { formats: ["post"], tone: "sharp and concise", caption_style: "thread starter", hashtag_count: 2, cta_style: "reply" },
      linkedin: { formats: ["company_post"], tone: "professional", caption_style: "insight", hashtag_count: 3, cta_style: "contact" },
      youtube: { formats: ["short"], tone: "video-first", caption_style: "description", hashtag_count: 3, cta_style: "comment" }
    });
    variant.variant_id = `variant_${content.content_theme}_${account.platform}_demo_001`;
    variant.status = "approved";
    variant.approval_status = "approved";
    variant.created_at = now;
    variant.updated_at = now;
    return variant;
  }));
  ensureDistinctCaptions(variants);

  await writeJson(clientFile(clientId, "client.json"), client);
  await writeJson(clientFile(clientId, "categories.json"), categories);
  await writeClientArray(clientId, "accounts.json", accounts);
  await writeClientArray(clientId, "content-pool.json", contents);
  await writeClientArray(clientId, "platform-variants.json", variants);
  await writeClientArray(clientId, "publish-queue.json", []);
  await writeClientArray(clientId, "publish-records.json", []);
  await writeClientArray(clientId, "leads.json", []);
  await writeClientArray(clientId, "reply-drafts.json", []);
  await writeClientArray(clientId, "x-research-posts.json", []);
  await writeClientArray(clientId, "kol-prospects.json", []);
  await writeClientArray(clientId, "lead-candidates.json", []);
  await writeClientArray(clientId, "x-engagement-inbox.json", []);
  console.log(`Demo data seeded for ${clientId}: ${accounts.length} accounts, ${contents.length} contents, ${variants.length} approved variants.`);
}

async function runE2EDemo(): Promise<void> {
  const clientId = arg("client_id", "client_demo_001");
  const date = arg("date", "2026-05-10");
  if (clientId !== "client_demo_001") {
    throw new Error("demo:e2e currently uses the built-in client_demo_001 fixture.");
  }

  await seedDemo();

  const originalTimezone = process.env.TZ;
  process.env.TZ = arg("test_timezone", "Pacific/Kiritimati");
  try {
    await runWithArgs("publish:schedule:batch", { client_id: clientId, date });
    await runWithArgs("publish:run", { client_id: clientId });
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }

  const leadInputs = [
    {
      platform: "instagram",
      account_id: "ig_demo_001",
      source_type: "comment",
      source_post_id: "post_demo_ig_001",
      user_handle: "founder_li",
      user_display_name: "Founder Li",
      message_text: "可以咨询吗？我们想了解品牌出海社媒获客和代运营报价，怎么合作？"
    },
    {
      platform: "tiktok",
      account_id: "tiktok_demo_001",
      source_type: "dm",
      source_post_id: "post_demo_tk_001",
      user_handle: "crossborder_amy",
      user_display_name: "Amy",
      message_text: "How much is your agency pricing? Can we book a call for social media lead generation?"
    },
    {
      platform: "facebook",
      account_id: "facebook_demo_001",
      source_type: "manual",
      source_post_id: "post_demo_fb_001",
      user_handle: "maple_service_owner",
      user_display_name: "Service Owner",
      message_text: "我们本地服务想做社媒内容运营获客，可以预约聊一下广告投放吗？"
    },
    {
      platform: "x",
      account_id: "x_demo_001",
      source_type: "csv",
      source_post_id: "post_demo_x_001",
      user_handle: "b2b_founder",
      user_display_name: "B2B Founder",
      message_text: "Need a quote for overseas social media campaign and lead generation. What is the next step?"
    },
    {
      platform: "instagram",
      account_id: "ig_demo_001",
      source_type: "comment",
      source_post_id: "post_demo_ig_spam",
      user_handle: "spam_user",
      user_display_name: "Spam User",
      message_text: "骗子 广告 spam not interested"
    }
  ] as const;

  for (const leadInput of leadInputs) {
    await runWithArgs("lead:import", { client_id: clientId, ...leadInput });
  }

  await runWithArgs("lead:score", { client_id: clientId });
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  for (const lead of leads.filter((item) => item.lead_score >= 70)) {
    await runWithArgs("reply:generate", { client_id: clientId, lead_id: lead.lead_id });
  }

  await runWithArgs("report:daily", { client_id: clientId, date });
  await runWithArgs("report:weekly", { client_id: clientId, week_start: "2026-05-04", week_end: "2026-05-10" });
  await writeE2ETestReport(clientId, date);
  console.log(`E2E demo completed for ${clientId}. Report: ${join(clientDir(clientId), "reports", "e2e-test-report.md")}`);
}

async function runXPublishTest(): Promise<void> {
  const mode = enumArg("mode", "dry-run", ["dry-run", "live"]);
  const clientId = arg("client_id", "client_demo_001");
  const accountId = arg("account_id", "x_demo_001");
  if (mode === "live" && arg("confirm", "") !== "LIVE") {
    throw new Error("Live X publish requires --confirm LIVE. Dry-run remains the default safe path.");
  }
  if (clientId === "client_demo_001" && !(await fileExists(clientFile(clientId, "client.json")))) {
    await seedDemo();
  }

  const originalDryRun = process.env.X_API_DRY_RUN;
  process.env.X_API_DRY_RUN = mode === "live" ? "false" : "true";
  try {
    const now = new Date().toISOString();
    const suffix = now.replace(/\D/g, "").slice(0, 14);
    const contentId = `content_x_api_test_${suffix}`;
    const variantId = `variant_x_api_test_${suffix}`;
    const taskId = `pub_x_api_test_${suffix}`;
    const safeText = `Social Ops Hub X API integration test ${suffix}. Controlled publish check from an approved workflow.`;

    const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
    const account = findAccount(accounts, accountId);
    if (account.platform !== "x") {
      throw new Error(`Account ${accountId} must be an X account for x:publish:test.`);
    }
    account.auth_status = "connected";
    account.status = "active";
    account.posting_enabled = true;
    account.capability_override = {
      ...(account.capability_override ?? {}),
      can_publish_text: true,
      supports_real_api: true,
      supports_mock: true,
      requires_human_review: false
    };
    account.updated_at = now;
    await writeClientArray(clientId, "accounts.json", accounts);

    const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
    const content: ContentAsset = {
      content_id: contentId,
      client_id: clientId,
      category_id: "brand_global",
      content_theme: "brand_intro",
      content_type: "text_post",
      content_angle: "trust_building",
      title: "Social Ops Hub X API integration test",
      hook: safeText,
      main_points: ["Controlled adapter test", "Approved content", "Official API path"],
      cta: "",
      language: "en",
      target_audience: ["internal operators"],
      funnel_stage: "trust_building",
      media_assets: [],
      status: "approved",
      created_by: "x:publish:test",
      approved_by_human: true,
      created_at: now,
      updated_at: now
    };
    contents.push(content);
    await writeClientArray(clientId, "content-pool.json", contents);

    const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
    const variant: PlatformVariant = {
      variant_id: variantId,
      content_id: contentId,
      client_id: clientId,
      platform: "x",
      account_id: accountId,
      format: "post",
      caption: safeText,
      hashtags: [],
      media_path: null,
      cta: "",
      language: "en",
      account_role: account.account_role,
      content_focus: account.content_focus,
      status: "approved",
      approval_status: "approved",
      rejection_reason: null,
      created_at: now,
      updated_at: now
    };
    variants.push(variant);
    await writeClientArray(clientId, "platform-variants.json", variants);

    const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
    const task: PublishTask = {
      publish_task_id: taskId,
      client_id: clientId,
      content_id: contentId,
      variant_id: variantId,
      platform: "x",
      account_id: accountId,
      scheduled_at: arg("scheduled_at", defaultXTestScheduledAt()),
      status: "scheduled",
      approval_status: "approved",
      publish_method: "official_api",
      platform_post_id: null,
      published_at: null,
      error_message: null,
      blocked_reason: null,
      retry_count: 0,
      max_retry: Number(arg("max_retry", "1")),
      last_error: null,
      next_retry_at: null,
      created_at: now,
      updated_at: now
    };

    const rules = await readPublishRules();
    const capabilities = await readPlatformCapabilities();
    const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities });
    queue.push(task);
    if (!readiness.ready) {
      blockTask(task, readiness.reason, readiness.needsManualReview);
      await writeClientArray(clientId, "publish-queue.json", queue);
      console.log(`[x:publish:test] blocked mode=${mode} task=${taskId} estimated_cost=0 api_calls=0 cache_hits=0 reason=${task.blocked_reason}`);
      return;
    }

    task.status = "publishing";
    task.updated_at = new Date().toISOString();
    console.log(`[x:publish:test] publishing mode=${mode} task=${taskId} dry_run=${process.env.X_API_DRY_RUN} estimated_cost=0 api_calls=0 cache_hits=0`);
    const result = await publishers.x.publish(task, variant);
    const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
    if (result.ok) {
      const publishedAt = new Date().toISOString();
      const recordUrl = result.post_url ?? result.mock_url ?? `https://mock.social/x/${result.platform_post_id ?? taskId}`;
      task.status = "published";
      task.platform_post_id = result.platform_post_id;
      task.published_at = publishedAt;
      task.error_message = null;
      task.blocked_reason = null;
      task.last_error = null;
      task.next_retry_at = null;
      task.updated_at = publishedAt;
      records.push({
        publish_record_id: id("record"),
        publish_task_id: task.publish_task_id,
        client_id: task.client_id,
        content_id: task.content_id,
        variant_id: task.variant_id,
        platform: task.platform,
        account_id: task.account_id,
        platform_post_id: result.platform_post_id ?? `x_${taskId}`,
        published_at: publishedAt,
        status: "published",
        publish_mode: result.publish_mode ?? (mode === "live" ? "api" : "mock"),
        mock_url: result.mock_url ?? recordUrl,
        post_url: recordUrl
      });
      console.log(`[x:publish:test] success mode=${result.publish_mode ?? "mock"} estimated_cost=0 api_calls=0 cache_hits=0 post_id=${task.platform_post_id} url=${recordUrl}`);
    } else {
      registerPublishFailure(task, result.error_message ?? "Unknown X publish error");
      console.log(`[x:publish:test] failed mode=${mode} estimated_cost=0 api_calls=0 cache_hits=0 retries=${task.retry_count}/${task.max_retry} error=${task.last_error}`);
    }
    await writeClientArray(clientId, "publish-queue.json", queue);
    await writeClientArray(clientId, "publish-records.json", records);
  } finally {
    if (originalDryRun === undefined) {
      delete process.env.X_API_DRY_RUN;
    } else {
      process.env.X_API_DRY_RUN = originalDryRun;
    }
  }
}

function defaultXTestScheduledAt(): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

async function xResearchSearch(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const mode = modeArg();
  const keywords = csv(arg("keywords", client.service_keywords.join(","))).slice(0, 8);
  const maxResults = boundedXPostLimit("max_results", client.default_x_search_limit ?? xKolDefaultPostLimit);
  const budget = await guardXApiReadCommand(client, mode, estimateXReadCost("research", maxResults));
  if (await handleEstimateOnly(clientId, "x:research:search", mode, keywords, maxResults, "x-research-posts.json", budget)) return;
  resetXApiUsageStats();
  const posts = await fetchXResearchPosts(clientId, mode, keywords, maxResults);
  const existing = await readClientArray<XResearchPost>(clientId, "x-research-posts.json");
  const merged = mergeBy(existing, posts, (post) => post.post_id);
  await writeClientArray(clientId, "x-research-posts.json", merged);
  await appendXQueryHistory(clientId, {
    command: "x:research:search",
    mode,
    keywords,
    requested_limit: maxResults,
    returned_count: posts.length,
    saved_count: posts.length,
    result_ids: posts.map((post) => post.post_id),
    result_file: "x-research-posts.json"
  });
  const usage = getXApiUsageStats();
  console.log(`[x:research] mode=${mode} saved=${posts.length} total=${merged.length} estimated_cost=${usage.estimatedCost} api_calls=${usage.apiCalls} cache_hits=${usage.cacheHits}`);
}

async function xKolDiscover(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const mode = modeArg();
  const depth = enumArg("depth", "light", ["light", "deep"]);
  const keywords = csv(arg("keywords", client.service_keywords.join(","))).slice(0, 8);
  const maxResults = boundedXPostLimit("max_results", client.default_kol_discovery_limit ?? xKolDefaultPostLimit);
  const postsPerAuthor = boundedXPostLimit("posts_per_author", 25, 30);
  const threshold = Number(arg("threshold", "40"));
  const budget = await guardXApiReadCommand(client, mode, estimateXReadCost("kol", maxResults, depth));
  if (await handleEstimateOnly(clientId, "x:kol:discover", mode, keywords, maxResults, "kol-prospects.json", budget)) return;
  resetXApiUsageStats();
  const posts = await fetchXResearchPosts(clientId, mode, keywords, maxResults);
  const prospects = await buildScoredKolProspects(client, mode, posts, "keyword_search", postsPerAuthor, threshold, depth);
  const existingPosts = await readClientArray<XResearchPost>(clientId, "x-research-posts.json");
  const existingProspects = await readClientArray<XKolProspect>(clientId, "kol-prospects.json");
  await writeClientArray(clientId, "x-research-posts.json", mergeBy(existingPosts, posts, (post) => post.post_id));
  await writeClientArray(clientId, "kol-prospects.json", mergeKolProspects(existingProspects, prospects, threshold));
  await appendXQueryHistory(clientId, {
    command: "x:kol:discover",
    mode,
    keywords,
    requested_limit: maxResults,
    returned_count: posts.length,
    saved_count: prospects.length,
    result_ids: prospects.map((prospect) => prospect.prospect_id),
    result_file: "kol-prospects.json"
  });
  const usage = getXApiUsageStats();
  console.log(`[x:kol] mode=${mode} depth=${depth} posts_scanned=${posts.length} profiles_scored=${new Set(posts.map((post) => post.author_id)).size} prospects_saved=${prospects.length} threshold=${threshold} estimated_cost=${usage.estimatedCost} api_calls=${usage.apiCalls} cache_hits=${usage.cacheHits}. No follow, comment, or DM was sent.`);
}

async function xCompetitorMine(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const mode = modeArg();
  const username = arg("username").replace(/^@/, "");
  const maxResults = boundedXPostLimit("max_results", 50);
  const postsPerAuthor = boundedXPostLimit("posts_per_author", 25, 30);
  const threshold = Number(arg("threshold", "40"));
  const budget = await guardXApiReadCommand(client, mode, estimateXReadCost("competitor", maxResults));
  if (await handleEstimateOnly(clientId, "x:competitor:mine", mode, [username], maxResults, "kol-prospects.json,lead-candidates.json", budget, username)) return;
  resetXApiUsageStats();
  const profile = await fetchXUserProfile(clientId, mode, username);
  const recentPosts = await fetchXUserRecentPosts(clientId, mode, profile.user_id, username, maxResults);
  const prospects = await buildScoredKolProspects(client, mode, recentPosts, "competitor_mining", postsPerAuthor, threshold, "deep");
  const leadCandidates = recentPosts
    .filter((post) => scoreIntent(post.text, defaultBuyingIntentKeywords()) >= 50)
    .map((post) => buildLeadCandidate(client, post, defaultBuyingIntentKeywords()));
  const existingProspects = await readClientArray<XKolProspect>(clientId, "kol-prospects.json");
  const existingCandidates = await readClientArray<XLeadCandidate>(clientId, "lead-candidates.json");
  await writeClientArray(clientId, "kol-prospects.json", mergeKolProspects(existingProspects, prospects, threshold));
  await writeClientArray(clientId, "lead-candidates.json", mergeBy(existingCandidates, leadCandidates, (candidate) => candidate.candidate_id));
  await appendXQueryHistory(clientId, {
    command: "x:competitor:mine",
    mode,
    keywords: [username],
    username,
    requested_limit: maxResults,
    returned_count: recentPosts.length,
    saved_count: prospects.length + leadCandidates.length,
    result_ids: [...prospects.map((prospect) => prospect.prospect_id), ...leadCandidates.map((candidate) => candidate.candidate_id)],
    result_file: "kol-prospects.json,lead-candidates.json"
  });
  const usage = getXApiUsageStats();
  console.log(`[x:competitor] mode=${mode} competitor=@${profile.username} posts_scanned=${recentPosts.length} prospects=${prospects.length} lead_candidates=${leadCandidates.length} estimated_cost=${usage.estimatedCost} api_calls=${usage.apiCalls} cache_hits=${usage.cacheHits}. Followers/following analysis was not run.`);
}

async function xLeadDiscover(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const category = getCategory(client.industry);
  const rule = (await readLeadScoringRules())[client.industry];
  const mode = modeArg();
  const keywords = csv(arg("keywords", defaultBuyingIntentKeywords().join(","))).slice(0, 12);
  const maxResults = boundedXPostLimit("max_results", client.default_x_search_limit ?? xKolDefaultPostLimit);
  const budget = await guardXApiReadCommand(client, mode, estimateXReadCost("lead", maxResults));
  if (await handleEstimateOnly(clientId, "x:lead:discover", mode, keywords, maxResults, "lead-candidates.json,leads.json,reply-drafts.json", budget)) return;
  const account = await findXAccount(clientId);
  resetXApiUsageStats();
  const posts = await fetchXResearchPosts(clientId, mode, keywords, maxResults);
  const candidates = posts
    .map((post) => buildLeadCandidate(client, post, keywords))
    .filter((candidate) => candidate.intent_score >= Number(arg("min_score", "50")));
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const now = new Date().toISOString();
  for (const candidate of candidates) {
    if (leads.some((lead) => lead.source_post_id === candidate.source_post_id && lead.user_handle === candidate.username)) continue;
    const score = scoreLead(candidate.message_text, category, rule);
    const lead: Lead = {
      lead_id: id("lead"),
      client_id: clientId,
      platform: "x",
      account_id: account.account_id,
      source_type: "manual",
      source_mode: mode === "api" ? "api" : "mock",
      source_post_id: candidate.source_post_id,
      source_url: candidate.source_url,
      user_handle: candidate.username,
      user_display_name: candidate.display_name,
      message_text: candidate.message_text,
      detected_intent: classifyIntent(candidate.message_text, rule),
      lead_score: score,
      lead_stage: leadStageFromScore(score, rule),
      recommended_reply: candidate.recommended_reply,
      human_review_required: true,
      assigned_to: "",
      next_follow_up_at: null,
      last_contacted_at: null,
      contact_method: "unknown",
      lead_notes: ["Imported from X lead discovery. Reply draft only; no auto-send."],
      created_at: now,
      updated_at: now
    };
    leads.push(lead);
    drafts.push({
      reply_draft_id: id("reply"),
      lead_id: lead.lead_id,
      client_id: clientId,
      platform: "x",
      account_id: account.account_id,
      draft_text: generateReplyDraft(client, lead),
      tone: client.brand_tone,
      approval_status: "draft",
      rejection_reason: null,
      sent_status: "not_sent",
      created_at: now,
      updated_at: now
    });
  }
  const existingCandidates = await readClientArray<XLeadCandidate>(clientId, "lead-candidates.json");
  await writeClientArray(clientId, "lead-candidates.json", mergeBy(existingCandidates, candidates, (candidate) => candidate.candidate_id));
  await writeClientArray(clientId, "leads.json", leads);
  await writeClientArray(clientId, "reply-drafts.json", drafts);
  await appendXQueryHistory(clientId, {
    command: "x:lead:discover",
    mode,
    keywords,
    requested_limit: maxResults,
    returned_count: posts.length,
    saved_count: candidates.length,
    result_ids: candidates.map((candidate) => candidate.candidate_id),
    result_file: "lead-candidates.json,leads.json,reply-drafts.json"
  });
  const usage = getXApiUsageStats();
  console.log(`[x:lead] mode=${mode} posts_scanned=${posts.length} candidates=${candidates.length} leads_total=${leads.length} estimated_cost=${usage.estimatedCost} api_calls=${usage.apiCalls} cache_hits=${usage.cacheHits}. Reply drafts generated only.`);
}

async function xEngagementSync(): Promise<void> {
  const clientId = arg("client_id");
  const mode = modeArg();
  const account = await findXAccount(clientId);
  const username = arg("username", account.account_name).replace(/^@/, "");
  const maxResults = boundedXPostLimit("max_results", 50);
  const client = await readClient(clientId);
  const budget = await guardXApiReadCommand(client, mode, estimateXReadCost("engagement", maxResults));
  if (await handleEstimateOnly(clientId, "x:engagement:sync", mode, [`@${username}`], maxResults, "x-engagement-inbox.json", budget, username)) return;
  resetXApiUsageStats();
  const profile = await fetchXUserProfile(clientId, mode, username);
  const posts = await fetchXMentions(clientId, mode, profile.user_id, username, maxResults);
  const items = posts.map((post) => buildEngagementItem(clientId, account.account_id, post, "mention"));
  const existing = await readClientArray<XEngagementItem>(clientId, "x-engagement-inbox.json");
  await writeClientArray(clientId, "x-engagement-inbox.json", mergeBy(existing, items, (item) => item.engagement_id));
  await appendXQueryHistory(clientId, {
    command: "x:engagement:sync",
    mode,
    keywords: [`@${username}`],
    username,
    requested_limit: maxResults,
    returned_count: posts.length,
    saved_count: items.length,
    result_ids: items.map((item) => item.engagement_id),
    result_file: "x-engagement-inbox.json"
  });
  const usage = getXApiUsageStats();
  console.log(`[x:engagement] mode=${mode} account=${account.account_id} items=${items.length} estimated_cost=${usage.estimatedCost} api_calls=${usage.apiCalls} cache_hits=${usage.cacheHits}`);
}

async function xDmSync(): Promise<void> {
  const clientId = arg("client_id");
  const mode = modeArg();
  const account = await findXAccount(clientId);
  const capabilities = await readPlatformCapabilities();
  const capability = mergedCapabilities("x", account, capabilities);
  if (capability.can_read_dm === false) {
    console.log(`[x:dm] blocked account=${account.account_id} estimated_cost=0 api_calls=0 cache_hits=0 reason=can_read_dm is false`);
    return;
  }
  const maxResults = boundedXPostLimit("max_results", 50);
  const client = await readClient(clientId);
  const budget = await guardXApiReadCommand(client, mode, estimateXReadCost("dm", maxResults));
  if (await handleEstimateOnly(clientId, "x:dm:sync", mode, ["dm_events"], maxResults, "x-engagement-inbox.json", budget)) return;
  resetXApiUsageStats();
  const dmPosts = mode === "api" ? await fetchXDirectMessages(clientId, mode, maxResults) : [{
    post_id: `dm_mock_${Date.now()}`,
    text: arg("message_text", "Need help with overseas social media lead generation. Can you share next steps?"),
    author_id: "mock_dm_user",
    username: arg("username", "mock_dm_lead"),
    post_url: "",
    public_metrics: {},
    matched_keywords: ["need help"],
    saved_at: new Date().toISOString(),
    research_status: "suggested" as const
  }];
  const items = dmPosts.map((post) => buildEngagementItem(clientId, account.account_id, post, "dm"));
  const existing = await readClientArray<XEngagementItem>(clientId, "x-engagement-inbox.json");
  await writeClientArray(clientId, "x-engagement-inbox.json", mergeBy(existing, items, (entry) => entry.engagement_id));
  await appendXQueryHistory(clientId, {
    command: "x:dm:sync",
    mode,
    keywords: ["dm_events"],
    requested_limit: maxResults,
    returned_count: dmPosts.length,
    saved_count: items.length,
    result_ids: items.map((item) => item.engagement_id),
    result_file: "x-engagement-inbox.json"
  });
  const usage = getXApiUsageStats();
  console.log(`[x:dm] mode=${mode} saved=${items.length} estimated_cost=${usage.estimatedCost} api_calls=${usage.apiCalls} cache_hits=${usage.cacheHits} incoming DM items for manual review. No DM reply was sent.`);
}

async function xReport(): Promise<void> {
  const clientId = arg("client_id");
  const date = arg("date", new Date().toISOString().slice(0, 10));
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const research = await readClientArray<XResearchPost>(clientId, "x-research-posts.json");
  const prospects = await readClientArray<XKolProspect>(clientId, "kol-prospects.json");
  const candidates = await readClientArray<XLeadCandidate>(clientId, "lead-candidates.json");
  const inbox = await readClientArray<XEngagementItem>(clientId, "x-engagement-inbox.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const report = {
    client_id: clientId,
    date,
    phase: "Phase 1: full features, manual-gated actions",
    published_posts: records.filter((record) => record.platform === "x"),
    engagement_metrics: summarizeXEngagement(inbox),
    top_posts: research.slice().sort((a, b) => metricTotal(b.public_metrics) - metricTotal(a.public_metrics)).slice(0, 10),
    new_kol_prospects: prospects.filter((prospect) => prospect.saved_at.startsWith(date)),
    new_lead_candidates: candidates.filter((candidate) => candidate.saved_at.startsWith(date)),
    pending_reply_drafts: drafts.filter((draft) => draft.platform === "x" && draft.approval_status !== "approved"),
    recommended_next_actions: [
      "Review high-score lead candidates before replying.",
      "Approve or reject pending X reply drafts manually.",
      "Move promising KOL prospects to outreach planning; do not auto-follow or auto-DM in Phase 1."
    ]
  };
  const reportPath = join(clientDir(clientId), "reports", "x", `${date}.json`);
  await writeJson(reportPath, report);
  console.log(`[x:report] written ${reportPath} estimated_cost=0 api_calls=0 cache_hits=0`);
}

async function fetchXResearchPosts(clientId: string, mode: "mock" | "api", keywords: string[], maxResults: number): Promise<XResearchPost[]> {
  const now = new Date().toISOString();
  if (mode === "mock") {
    return keywords.slice(0, Math.min(5, maxResults)).map((keyword, index) => ({
      post_id: `mock_x_post_${keyword.replace(/\W+/g, "_").toLowerCase()}_${index}`,
      text: `${keyword} - looking for recommendations and practical next steps for overseas growth.`,
      author_id: `mock_author_${index}`,
      username: `mock_x_user_${index}`,
      post_url: `https://x.com/mock_x_user_${index}/status/mock_x_post_${index}`,
      public_metrics: { like_count: 10 + index, reply_count: index + 1, retweet_count: index, quote_count: 0 },
      matched_keywords: [keyword],
      created_at: now,
      saved_at: now,
      research_status: "suggested"
    }));
  }
  const query = keywords.map((keyword) => `"${keyword}"`).join(" OR ");
  const body = await xApiGet({
    mode,
    clientId,
    path: "/2/tweets/search/recent",
    costUnits: 1,
    cacheTtlHours: xApiCacheTtlHours,
    query: {
      query,
      max_results: maxResults,
      "tweet.fields": "author_id,created_at,public_metrics,conversation_id",
      "expansions": "author_id",
      "user.fields": "username,name,public_metrics,description"
    }
  });
  return normalizeXPosts(body, keywords);
}

async function fetchXUserProfile(clientId: string, mode: "mock" | "api", username: string): Promise<{ user_id: string; username: string; display_name: string; bio: string; public_metrics: XPublicMetrics }> {
  if (mode === "mock") {
    return {
      user_id: `mock_user_${username}`,
      username,
      display_name: username,
      bio: "Mock competitor or KOL profile",
      public_metrics: { followers_count: 2400, following_count: 300, tweet_count: 800, listed_count: 12 }
    };
  }
  const body = await xApiGet({
    mode,
    clientId,
    path: `/2/users/by/username/${encodeURIComponent(username)}`,
    costUnits: 1,
    cacheTtlHours: xApiCacheTtlHours,
    query: { "user.fields": "description,public_metrics,verified,verified_type,url,created_at" }
  });
  const data = body.data as Record<string, unknown> | undefined;
  return {
    user_id: String(data?.id ?? username),
    username: String(data?.username ?? username),
    display_name: String(data?.name ?? username),
    bio: String(data?.description ?? ""),
    public_metrics: normalizeMetrics(data?.public_metrics)
  };
}

async function fetchXUserRecentPosts(clientId: string, mode: "mock" | "api", userId: string, username: string, maxResults: number): Promise<XResearchPost[]> {
  if (mode === "mock") {
    const now = new Date().toISOString();
    const themes = [username, "recommendation", "need help", "lead generation", "case study", "pricing", "overseas social media"];
    return Array.from({ length: Math.min(maxResults, 30) }, (_, index) => {
      const keyword = themes[index % themes.length];
      return {
        post_id: `mock_recent_${username}_${index}`,
        text: `${keyword} practical note ${index + 1}: sharing useful context, examples, and next steps for buyers.`,
        author_id: userId,
        username,
        post_url: `https://x.com/${username}/status/mock_recent_${index}`,
        public_metrics: { like_count: 8 + index, reply_count: index % 5, retweet_count: index % 4, quote_count: index % 3 },
        matched_keywords: [keyword],
        created_at: now,
        saved_at: now,
        research_status: "suggested" as const
      };
    });
  }
  const body = await xApiGet({
    mode,
    clientId,
    path: `/2/users/${encodeURIComponent(userId)}/tweets`,
    costUnits: 1,
    cacheTtlHours: xApiCacheTtlHours,
    query: { max_results: maxResults, "tweet.fields": "author_id,created_at,public_metrics" }
  });
  return normalizeXPosts(body, [username]).map((post) => ({ ...post, username }));
}

async function fetchXMentions(clientId: string, mode: "mock" | "api", userId: string, username: string, maxResults: number): Promise<XResearchPost[]> {
  if (mode === "mock") return fetchXResearchPosts(clientId, "mock", [`@${username}`, "need help"], maxResults);
  const body = await xApiGet({
    mode,
    clientId,
    path: `/2/users/${encodeURIComponent(userId)}/mentions`,
    costUnits: 1,
    cacheTtlHours: xApiCacheTtlHours,
    query: {
      max_results: maxResults,
      "tweet.fields": "author_id,created_at,public_metrics,conversation_id,referenced_tweets",
      "expansions": "author_id",
      "user.fields": "username,name,public_metrics"
    }
  });
  return normalizeXPosts(body, [username]);
}

async function fetchXDirectMessages(clientId: string, mode: "api", maxResults: number): Promise<XResearchPost[]> {
  const body = await xApiGet({
    mode,
    clientId,
    path: "/2/dm_events",
    costUnits: 1,
    cacheTtlHours: xApiCacheTtlHours,
    query: {
      max_results: maxResults,
      event_types: "MessageCreate",
      "dm_event.fields": "created_at,dm_conversation_id,event_type,id,participant_ids,sender_id,text"
    }
  });
  const now = new Date().toISOString();
  return (Array.isArray(body.data) ? body.data as Record<string, unknown>[] : []).map((event) => ({
    post_id: String(event.id),
    text: String(event.text ?? ""),
    author_id: String(event.sender_id ?? "unknown"),
    username: String(event.sender_id ?? "unknown"),
    post_url: "",
    public_metrics: {},
    matched_keywords: defaultBuyingIntentKeywords().filter((keyword) => String(event.text ?? "").toLowerCase().includes(keyword.toLowerCase())),
    created_at: typeof event.created_at === "string" ? event.created_at : now,
    saved_at: now,
    research_status: "suggested"
  }));
}

function normalizeXPosts(body: Record<string, unknown>, keywords: string[]): XResearchPost[] {
  const now = new Date().toISOString();
  const users = new Map<string, string>();
  const includes = body.includes as Record<string, unknown> | undefined;
  for (const user of Array.isArray(includes?.users) ? includes.users as Record<string, unknown>[] : []) {
    users.set(String(user.id), String(user.username ?? user.id));
  }
  return (Array.isArray(body.data) ? body.data as Record<string, unknown>[] : []).map((post) => {
    const authorId = String(post.author_id ?? "unknown");
    const username = users.get(authorId) ?? authorId;
    return {
      post_id: String(post.id),
      text: String(post.text ?? ""),
      author_id: authorId,
      username,
      post_url: `https://x.com/${username}/status/${String(post.id)}`,
      public_metrics: normalizeMetrics(post.public_metrics),
      matched_keywords: keywords.filter((keyword) => String(post.text ?? "").toLowerCase().includes(keyword.toLowerCase())),
      created_at: typeof post.created_at === "string" ? post.created_at : now,
      saved_at: now,
      research_status: "suggested"
    };
  });
}

function boundedXPostLimit(name: string, fallback: number, upperLimit = xSearchPostLimit): number {
  const raw = Number(arg(name, String(fallback)));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(Math.floor(raw), 10), upperLimit);
}

async function appendXQueryHistory(clientId: string, value: Omit<XQueryHistoryEntry, "query_id" | "client_id" | "estimated_cost" | "api_calls" | "cache_hits" | "created_at">): Promise<void> {
  const usage = getXApiUsageStats();
  const history = await readClientArray<XQueryHistoryEntry>(clientId, "x-query-history.json");
  history.push({
    query_id: id("xquery"),
    client_id: clientId,
    ...value,
    estimated_cost: usage.estimatedCost,
    api_calls: usage.apiCalls,
    cache_hits: usage.cacheHits,
    created_at: new Date().toISOString()
  });
  await writeClientArray(clientId, "x-query-history.json", history);
}

async function appendXQueryAttempt(clientId: string, value: Omit<XQueryHistoryEntry, "query_id" | "client_id" | "api_calls" | "cache_hits" | "created_at"> & { api_calls?: number; cache_hits?: number }): Promise<void> {
  const history = await readClientArray<XQueryHistoryEntry>(clientId, "x-query-history.json");
  history.push({
    query_id: id("xquery"),
    client_id: clientId,
    ...value,
    api_calls: value.api_calls ?? 0,
    cache_hits: value.cache_hits ?? 0,
    created_at: new Date().toISOString()
  });
  await writeClientArray(clientId, "x-query-history.json", history);
}

async function handleEstimateOnly(clientId: string, commandName: string, mode: "mock" | "api", keywords: string[], requestedLimit: number, resultFile: string, budget: XBudgetCheck, username?: string): Promise<boolean> {
  if (!flagArg("estimate-only")) return false;
  await appendXQueryAttempt(clientId, {
    command: commandName,
    mode,
    keywords,
    username,
    requested_limit: requestedLimit,
    returned_count: 0,
    saved_count: 0,
    estimated_cost: budget.estimatedCost,
    result_file: `${resultFile} (estimate-only)`
  });
  console.log(`[${commandName}] estimate_only=true mode=${mode} estimated_cost=${budget.estimatedCost} budget_used=${budget.budgetUsed} budget_remaining=${budget.budgetRemaining}`);
  return true;
}

async function guardXApiReadCommand(client: Client, mode: "mock" | "api", estimatedCost: number): Promise<XBudgetCheck> {
  const budget = Number(client.monthly_api_budget ?? 0);
  const used = await readXMonthlyApiUsage(client.client_id);
  const remaining = budget > 0 ? Math.max(0, budget - used) : Number.POSITIVE_INFINITY;
  const check = { estimatedCost: mode === "api" ? estimatedCost : 0, budgetUsed: used, budgetRemaining: remaining, budget };
  console.log(`[x:budget] mode=${mode} estimated_cost=${check.estimatedCost} budget_used=${used} budget_remaining=${Number.isFinite(remaining) ? remaining : "unlimited"}`);
  if (mode !== "api") return check;
  const maxCost = Number(client.max_cost_per_command ?? 0);
  const warnAt = Number(client.budget_warn_at ?? 0);
  const blockAt = Number(client.budget_block_at ?? budget);
  const force = flagArg("force");
  const reasons: string[] = [];
  if (maxCost > 0 && estimatedCost > maxCost) reasons.push(`estimated cost ${estimatedCost} exceeds max_cost_per_command ${maxCost}`);
  if (budget > 0 && used + estimatedCost > remaining + used) reasons.push(`estimated cost ${estimatedCost} exceeds remaining budget ${remaining}`);
  if (budget > 0 && blockAt > 0 && used + estimatedCost >= blockAt) reasons.push(`budget_block_at would be reached: ${used + estimatedCost}/${blockAt}`);
  if (budget > 0 && warnAt > 0 && used + estimatedCost >= warnAt) console.log(`[x:budget] warning budget_warn_at reached: projected=${used + estimatedCost} warn_at=${warnAt}`);
  if (reasons.length > 0 && !force) {
    await appendXQueryAttempt(client.client_id, {
      command: command || "x:unknown",
      mode,
      keywords: typeof args.keywords === "string" ? csv(args.keywords) : typeof args.username === "string" ? [args.username] : [],
      username: typeof args.username === "string" ? args.username : undefined,
      requested_limit: typeof args.max_results === "string" ? Number(args.max_results) : undefined,
      returned_count: 0,
      saved_count: 0,
      estimated_cost: estimatedCost,
      result_file: `blocked: ${reasons.join("; ")}`
    });
    throw new Error(`X API read blocked: ${reasons.join("; ")}. Use --force to override, or use --mode mock / manual workflow. Existing data was not changed.`);
  }
  if (reasons.length > 0 && force) console.log(`[x:budget] force=true override: ${reasons.join("; ")}`);
  return check;
}

async function readXMonthlyApiUsage(clientId: string): Promise<number> {
  const usage = await readJson<XApiUsageEntry[]>(clientFile(clientId, "x-api-usage.json"), []);
  const month = new Date().toISOString().slice(0, 7);
  return usage
    .filter((entry) => entry.timestamp.startsWith(month))
    .reduce((total, entry) => total + Number(entry.cost_units || 0), 0);
}

function estimateXReadCost(commandName: "research" | "kol" | "competitor" | "lead" | "engagement" | "dm", limit: number, depth: "light" | "deep" = "light"): number {
  if (commandName === "kol") return depth === "deep" ? 1 + limit * 2 : 1 + limit;
  if (commandName === "competitor") return 2;
  if (commandName === "engagement") return 2;
  return 1;
}

async function buildScoredKolProspects(client: Client, mode: "mock" | "api", posts: XResearchPost[], source: XKolProspect["source"], postsPerAuthor: number, threshold: number, depth: "light" | "deep"): Promise<XKolProspect[]> {
  const grouped = new Map<string, XResearchPost[]>();
  for (const post of posts) grouped.set(post.author_id, [...(grouped.get(post.author_id) ?? []), post]);
  const category = getCategory(client.industry);
  const keywords = uniqueStrings([
    ...client.service_keywords,
    ...category.lead_keywords,
    ...category.content_angles,
    ...defaultBuyingIntentKeywords()
  ]);
  const prospects: XKolProspect[] = [];
  for (const [userId, seedPosts] of grouped.entries()) {
    const username = seedPosts[0]?.username ?? userId;
    const profile = await fetchXUserProfile(client.client_id, mode, username);
    const recentPosts = depth === "deep"
      ? mergeBy(seedPosts, await fetchXUserRecentPosts(client.client_id, mode, profile.user_id, profile.username, postsPerAuthor), (post) => post.post_id)
      : seedPosts;
    const scored = buildScoredKolProspect(client, profile, recentPosts, keywords, source);
    if (scored.kol_score >= threshold) prospects.push(scored);
  }
  return prospects.sort((a, b) => b.kol_score - a.kol_score);
}

function buildScoredKolProspect(
  client: Client,
  profile: { user_id: string; username: string; display_name: string; bio: string; public_metrics: XPublicMetrics },
  recentPosts: XResearchPost[],
  keywords: string[],
  source: XKolProspect["source"]
): XKolProspect {
  const now = new Date().toISOString();
  const contentMatchScore = calculateContentMatchScore(recentPosts, keywords);
  const engagementScore = calculateEngagementScore(recentPosts);
  const followerScore = calculateFollowerScore(profile.public_metrics.followers_count ?? 0);
  const audienceFitScore = calculateAudienceFitScore(recentPosts, keywords);
  const collaborationScore = calculateCollaborationScore(client, profile, recentPosts);
  const kolScore = Math.round(
    contentMatchScore * 0.3 +
    engagementScore * 0.2 +
    followerScore * 0.2 +
    audienceFitScore * 0.2 +
    collaborationScore * 0.1
  );
  const priority = kolPriority(kolScore);
  return {
    prospect_id: `kol_${profile.user_id}`,
    client_id: client.client_id,
    source,
    user_id: profile.user_id,
    username: profile.username,
    display_name: profile.display_name,
    profile_url: `https://x.com/${profile.username}`,
    bio: profile.bio,
    public_metrics: profile.public_metrics,
    recent_posts: recentPosts.slice(0, 5),
    matched_keywords: matchedKeywords(recentPosts.map((post) => post.text).join("\n"), keywords),
    kol_score: kolScore,
    engagement_score: engagementScore,
    content_match_score: contentMatchScore,
    follower_score: followerScore,
    audience_fit_score: audienceFitScore,
    collaboration_score: collaborationScore,
    kol_priority: priority,
    collaboration_status: priority === "high_priority" ? "priority" : priority === "watchlist" ? "watchlist" : "new",
    prospect_status: "suggested",
    notes: `KOL score ${kolScore}/100 (${priority}). Phase 1 discovery only. Do not auto-follow, auto-comment, or auto-DM.`,
    saved_at: now,
    updated_at: now
  };
}

function buildKolProspects(clientId: string, posts: XResearchPost[], source: XKolProspect["source"]): XKolProspect[] {
  const grouped = new Map<string, XResearchPost[]>();
  for (const post of posts) grouped.set(post.author_id, [...(grouped.get(post.author_id) ?? []), post]);
  const now = new Date().toISOString();
  return [...grouped.entries()].map(([userId, recentPosts]) => ({
    prospect_id: `kol_${userId}`,
    client_id: clientId,
    source,
    user_id: userId,
    username: recentPosts[0]?.username ?? userId,
    display_name: recentPosts[0]?.username ?? userId,
    profile_url: `https://x.com/${recentPosts[0]?.username ?? userId}`,
    bio: "",
    public_metrics: aggregatePostMetrics(recentPosts),
    recent_posts: recentPosts.slice(0, 5),
    matched_keywords: [...new Set(recentPosts.flatMap((post) => post.matched_keywords))],
    kol_score: calculateKolScore(recentPosts),
    prospect_status: "suggested",
    notes: "Phase 1 discovery only. Do not auto-follow, auto-comment, or auto-DM.",
    saved_at: now,
    updated_at: now
  }));
}

function buildLeadCandidate(client: Client, post: XResearchPost, keywords: string[]): XLeadCandidate {
  const now = new Date().toISOString();
  const category = getCategory(client.industry);
  const buyerIntentScore = calculateBuyerIntentScore(post.text);
  const industryMatchScore = calculateIndustryMatchScore(post.text, client, category, keywords);
  const urgencyScore = calculateUrgencyScore(post.text);
  const negativeScore = calculateNegativeScore(post.text, category.negative_keywords);
  const replyValueScore = calculateReplyValueScore(post.text, buyerIntentScore, industryMatchScore, urgencyScore, negativeScore);
  const score = clampScore(Math.round(
    buyerIntentScore * 0.45 +
    industryMatchScore * 0.25 +
    urgencyScore * 0.15 +
    replyValueScore * 0.2 -
    negativeScore * 0.25
  ));
  const matched = matchedKeywords(post.text, uniqueStrings([...keywords, ...client.service_keywords, ...category.lead_keywords]));
  return {
    candidate_id: `xlead_${post.post_id}`,
    client_id: client.client_id,
    platform: "x",
    source_post_id: post.post_id,
    source_url: post.post_url,
    user_id: post.author_id,
    username: post.username,
    display_name: post.username,
    message_text: post.text,
    matched_keywords: matched,
    intent_score: score,
    buyer_intent_score: buyerIntentScore,
    industry_match_score: industryMatchScore,
    urgency_score: urgencyScore,
    negative_score: negativeScore,
    reply_value_score: replyValueScore,
    lead_priority: leadCandidatePriority(score),
    candidate_status: "suggested",
    recommended_reply: buildXLeadRecommendedReply(client, post.text, score),
    saved_at: now,
    updated_at: now
  };
}

function buildEngagementItem(clientId: string, accountId: string, post: XResearchPost, sourceType: XEngagementItem["source_type"]): XEngagementItem {
  const now = new Date().toISOString();
  const classification = classifyXEngagement(post.text);
  return {
    engagement_id: `${sourceType}_${post.post_id}`,
    client_id: clientId,
    platform: "x",
    account_id: accountId,
    source_type: sourceType,
    source_id: post.post_id,
    source_url: post.post_url,
    user_id: post.author_id,
    username: post.username,
    text: post.text,
    classification,
    lead_score: scoreIntent(post.text, defaultBuyingIntentKeywords()),
    action_status: "suggested",
    saved_at: now,
    updated_at: now
  };
}

async function findXAccount(clientId: string): Promise<PlatformAccount> {
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = accounts.find((item) => item.platform === "x" && item.status === "active");
  if (!account) throw new Error(`No active X account found for ${clientId}.`);
  return account;
}

function defaultBuyingIntentKeywords(): string[] {
  return ["looking for", "need help with", "any recommendation", "visa refused", "study permit help", "Toronto realtor recommendation", "quote", "pricing", "book a call"];
}

function scoreIntent(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 20;
  for (const keyword of keywords) if (lower.includes(keyword.toLowerCase())) score += 20;
  if (/[?？]/.test(text)) score += 10;
  if (/(spam|scam|骗子|广告)/i.test(text)) score -= 60;
  return Math.max(0, Math.min(score, 100));
}

function calculateBuyerIntentScore(text: string): number {
  const high = ["looking for", "need help", "recommendation", "quote", "pricing", "price", "cost", "book a call", "consultation", "how much", "can anyone recommend", "怎么申请", "费用多少", "可以咨询吗", "怎么联系"];
  const medium = ["thinking about", "considering", "any advice", "how to", "help with", "options", "方案", "想了解", "咨询"];
  return clampScore(matchedKeywords(text, high).length * 28 + matchedKeywords(text, medium).length * 14 + (/[?？]/.test(text) ? 10 : 0));
}

function calculateIndustryMatchScore(text: string, client: Client, category: ReturnType<typeof getCategory>, extraKeywords: string[]): number {
  const matches = matchedKeywords(text, uniqueStrings([...client.service_keywords, ...category.lead_keywords, ...category.content_angles, ...extraKeywords]));
  return clampScore(matches.length * 18);
}

function calculateUrgencyScore(text: string): number {
  const urgent = ["urgent", "asap", "today", "this week", "deadline", "refused", "rejected", "denied", "stuck", "emergency", "马上", "今天", "被拒", "着急", "急"];
  return clampScore(matchedKeywords(text, urgent).length * 30);
}

function calculateNegativeScore(text: string, negativeKeywords: string[]): number {
  const spam = ["spam", "scam", "bot", "giveaway", "airdrop", "casino", "crypto pump", "onlyfans", "广告", "骗子", "不需要", "无聊"];
  return clampScore(matchedKeywords(text, uniqueStrings([...spam, ...negativeKeywords])).length * 35);
}

function calculateReplyValueScore(text: string, buyerIntentScore: number, industryMatchScore: number, urgencyScore: number, negativeScore: number): number {
  if (negativeScore >= 70) return 0;
  let score = Math.round((buyerIntentScore + industryMatchScore + urgencyScore) / 3);
  if (/[?？]/.test(text)) score += 15;
  if (text.length >= 25 && text.length <= 280) score += 10;
  return clampScore(score);
}

function leadCandidatePriority(score: number): NonNullable<XLeadCandidate["lead_priority"]> {
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  if (score >= 40) return "low";
  return "ignore";
}

function buildXLeadRecommendedReply(client: Client, text: string, score: number): string {
  const nextStep = client.lead_goal[0] ?? "book consultation";
  if (score >= 75) return `Thanks for sharing this. This sounds worth looking at carefully. If you want, send a few details and we can help you map the next step toward ${nextStep}.`;
  if (/[?？]/.test(text)) return "Good question. The right answer depends on your situation; share a bit more context and we can point you in the right direction.";
  return "Thanks for sharing. This may be relevant, and we can help you think through practical next steps if you want more context.";
}

function classifyXEngagement(text: string): XEngagementItem["classification"] {
  const lower = text.toLowerCase();
  if (/(spam|scam|骗子|广告)/i.test(text)) return "spam";
  if (/(angry|bad|complaint|not working|糟糕|投诉)/i.test(text)) return "complaint";
  if (/(partner|collab|partnership|合作)/i.test(text)) return "partnership";
  if (defaultBuyingIntentKeywords().some((keyword) => lower.includes(keyword.toLowerCase()))) return "lead";
  if (/[?？]/.test(text)) return "question";
  return "general_engagement";
}

function calculateKolScore(posts: XResearchPost[]): number {
  const metrics = aggregatePostMetrics(posts);
  const score = (metrics.like_count ?? 0) + (metrics.reply_count ?? 0) * 3 + (metrics.retweet_count ?? 0) * 4 + (metrics.quote_count ?? 0) * 5;
  return Math.max(0, Math.min(Math.round(score / Math.max(posts.length, 1)), 100));
}

function calculateContentMatchScore(posts: XResearchPost[], keywords: string[]): number {
  const text = posts.map((post) => post.text).join("\n");
  const matches = matchedKeywords(text, keywords);
  const coverageScore = Math.min(70, matches.length * 12);
  const densityScore = Math.min(30, posts.filter((post) => matchedKeywords(post.text, keywords).length > 0).length * 8);
  return clampScore(coverageScore + densityScore);
}

function calculateEngagementScore(posts: XResearchPost[]): number {
  if (posts.length === 0) return 0;
  const totals = aggregatePostMetrics(posts);
  const avgLikes = (totals.like_count ?? 0) / posts.length;
  const avgReplies = (totals.reply_count ?? 0) / posts.length;
  const avgReposts = (totals.retweet_count ?? 0) / posts.length;
  const avgQuotes = (totals.quote_count ?? 0) / posts.length;
  return clampScore(Math.round(avgLikes * 1.2 + avgReplies * 6 + avgReposts * 8 + avgQuotes * 10));
}

function calculateFollowerScore(followers: number): number {
  if (followers >= 5_000 && followers <= 50_000) return 100;
  if (followers >= 1_000 && followers < 5_000) return 85;
  if (followers > 50_000 && followers <= 100_000) return 80;
  if (followers >= 500 && followers < 1_000) return 65;
  if (followers > 100_000 && followers <= 500_000) return 55;
  if (followers > 0 && followers < 500) return 40;
  if (followers > 500_000) return 35;
  return 30;
}

function calculateAudienceFitScore(posts: XResearchPost[], keywords: string[]): number {
  const buyerIntentMatches = matchedKeywords(posts.map((post) => post.text).join("\n"), defaultBuyingIntentKeywords()).length;
  const industryMatches = matchedKeywords(posts.map((post) => post.text).join("\n"), keywords).length;
  return clampScore(buyerIntentMatches * 18 + industryMatches * 10);
}

function calculateCollaborationScore(
  client: Client,
  profile: { username: string; display_name: string; bio: string; public_metrics: XPublicMetrics },
  posts: XResearchPost[]
): number {
  const profileText = `${profile.username} ${profile.display_name} ${profile.bio}`.toLowerCase();
  let score = 35;
  if (/(https?:\/\/|www\.|\.com|\.ca|\.io|\.co)\b/i.test(profile.bio)) score += 20;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(profile.bio)) score += 20;
  if (hasRecentActivity(posts)) score += 15;
  const promoRatio = posts.length === 0 ? 0 : posts.filter((post) => /(buy now|discount|promo|giveaway|airdrop|casino|crypto pump|onlyfans)/i.test(post.text)).length / posts.length;
  if (promoRatio <= 0.2) score += 15;
  if (client.language.some((language) => languageMatchesText(language, profileText) || posts.some((post) => languageMatchesText(language, post.text)))) score += 5;
  if (client.region && (profileText.includes(client.region.toLowerCase()) || posts.some((post) => post.text.toLowerCase().includes(client.region.toLowerCase())))) score += 5;
  return clampScore(score);
}

function hasRecentActivity(posts: XResearchPost[]): boolean {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return posts.some((post) => {
    const timestamp = Date.parse(post.created_at || post.saved_at || "");
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function languageMatchesText(language: string, text: string): boolean {
  const lower = text.toLowerCase();
  if (language === "zh") return /[\u3400-\u9fff]/.test(text);
  if (language === "en") return /[a-z]/i.test(text);
  return lower.includes(language.toLowerCase());
}

function kolPriority(score: number): NonNullable<XKolProspect["kol_priority"]> {
  if (score >= 80) return "high_priority";
  if (score >= 60) return "medium_priority";
  if (score >= 40) return "watchlist";
  return "ignored";
}

function matchedKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return uniqueStrings(keywords).filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function aggregatePostMetrics(posts: XResearchPost[]): XPublicMetrics {
  return posts.reduce<XPublicMetrics>((acc, post) => ({
    like_count: (acc.like_count ?? 0) + (post.public_metrics.like_count ?? 0),
    reply_count: (acc.reply_count ?? 0) + (post.public_metrics.reply_count ?? 0),
    retweet_count: (acc.retweet_count ?? 0) + (post.public_metrics.retweet_count ?? 0),
    quote_count: (acc.quote_count ?? 0) + (post.public_metrics.quote_count ?? 0),
    impression_count: (acc.impression_count ?? 0) + (post.public_metrics.impression_count ?? 0)
  }), {});
}

function metricTotal(metrics: XPublicMetrics): number {
  return (metrics.like_count ?? 0) + (metrics.reply_count ?? 0) + (metrics.retweet_count ?? 0) + (metrics.quote_count ?? 0) + (metrics.impression_count ?? 0);
}

function normalizeMetrics(value: unknown): XPublicMetrics {
  return typeof value === "object" && value !== null ? value as XPublicMetrics : {};
}

function summarizeXEngagement(items: XEngagementItem[]): Record<string, number> {
  return countBy(items, (item) => item.classification);
}

function mergeBy<T>(existing: T[], incoming: T[], key: (item: T) => string): T[] {
  const map = new Map(existing.map((item) => [key(item), item]));
  for (const item of incoming) map.set(key(item), item);
  return [...map.values()];
}

function mergeKolProspects(existing: XKolProspect[], incoming: XKolProspect[], threshold: number): XKolProspect[] {
  const aboveThreshold = existing.filter((prospect) => (prospect.kol_score ?? 0) >= threshold);
  return mergeBy(aboveThreshold, incoming, (prospect) => prospect.username.toLowerCase())
    .filter((prospect) => (prospect.kol_score ?? 0) >= threshold)
    .sort((a, b) => b.kol_score - a.kol_score);
}

async function writeE2ETestReport(clientId: string, date: string): Promise<void> {
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const blocked = queue.filter((task) => ["blocked", "needs_manual_review"].includes(task.status));
  const highScoreLeads = leads.filter((lead) => lead.lead_score >= 70);
  const dailyPath = join(clientDir(clientId), "reports", "daily", `${date}.json`);
  const weeklyPath = join(clientDir(clientId), "reports", "weekly", "2026-05-04_2026-05-10.json");
  const dailyExists = await fileExists(dailyPath);
  const weeklyExists = await fileExists(weeklyPath);
  const stageSummary = countBy(leads, (lead) => lead.lead_stage);
  const queueSummary = countBy(queue, (task) => task.status);
  const sourceModes = [...new Set(leads.map((lead) => lead.source_mode))];
  const publishModes = [...new Set(records.map((record) => record.publish_mode))];

  const report = `# E2E Demo Test Report

Client: \`${clientId}\`

Run date: \`${date}\`

## Summary

| Checkpoint | Result |
| --- | ---: |
| Platform accounts created | ${accounts.length} |
| Content assets created | ${contents.length} |
| Platform variants generated | ${variants.length} |
| Distinct variant captions | ${new Set(variants.map((variant) => variant.caption)).size} |
| Publish tasks scheduled | ${queue.length} |
| Mock published records | ${records.length} |
| Blocked tasks | ${blocked.length} |
| Leads imported | ${leads.length} |
| High-score leads | ${highScoreLeads.length} |
| Reply drafts generated | ${drafts.length} |
| Daily report generated | ${dailyExists ? "Yes" : "No"} |
| Weekly report generated | ${weeklyExists ? "Yes" : "No"} |

## Accounts

${accounts.map((account) => `- \`${account.platform}\`: \`${account.account_id}\` / \`${account.account_role}\` / \`${account.content_focus}\``).join("\n")}

Each demo account includes posting, lead tracking, mock auth, and account-level \`capability_override\` examples.

## Content And Variants

${contents.map((content) => `- \`${content.content_id}\`: \`${content.content_theme}\` / \`${content.status}\``).join("\n")}

Each content asset has one approved variant per Phase 1 platform. Captions are account-aware and platform-specific.

## Publish Queue

Queue status:

${formatCountList(queueSummary)}

Blocked tasks:

${blocked.length > 0 ? blocked.map((task) => `- \`${task.publish_task_id}\`: ${task.blocked_reason ?? task.status}`).join("\n") : "- None"}

Publish modes observed:

${publishModes.map((mode) => `- \`${mode}\``).join("\n")}

## Leads

Lead stages:

${formatCountList(stageSummary)}

Source modes observed:

${sourceModes.map((mode) => `- \`${mode}\``).join("\n")}

## Reply Drafts

Reply drafts were generated for all leads with \`lead_score >= 70\`. No auto-reply or auto-DM sending was performed.

## Reports

- Daily report: \`${dailyPath}\` ${dailyExists ? "created" : "missing"}
- Weekly report: \`${weeklyPath}\` ${weeklyExists ? "created" : "missing"}

## Current Findings

- The complete demo flow works from seed through approved content, approved variants, batch scheduling, mock publishing, lead import, lead scoring, reply draft generation, daily report, and weekly report.
- \`publish:run\` correctly respects scheduled times; \`demo:e2e\` uses a test timezone so the fixed \`${date}\` schedule can be processed immediately.
- Platform capabilities keep lead import in manual/csv mode while real API reading is not enabled.

## Next Suggestions

- Use \`npm run demo:e2e\` as the regression check before and after adding the X adapter.
- Start the X adapter behind capability checks and keep mock/manual fallback intact.
`;
  await writeFile(join(clientDir(clientId), "reports", "e2e-test-report.md"), report, "utf8");
}

function countBy<T>(items: T[], select: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = select(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function formatCountList(values: Record<string, number>): string {
  const entries = Object.entries(values);
  return entries.length > 0 ? entries.map(([key, value]) => `- \`${key}\`: ${value}`).join("\n") : "- None";
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
    case "publish:schedule:batch":
      await scheduleBatch();
      break;
    case "publish:run":
      await runPublishQueue();
      break;
    case "lead:import":
      await importLead();
      break;
    case "lead:score":
      await scoreLeads();
      break;
    case "reply:generate":
      await generateReplyForLead();
      break;
    case "report:daily":
      await generateDailyReport();
      break;
    case "report:weekly":
      await generateWeeklyReport();
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
  npm run report:weekly -- --client_id client_study_001
  npm run demo:e2e
  npm run x:publish:dry-run
  npm run x:publish:live -- --confirm LIVE
  npm run x:research:search -- --client_id client_demo_001 --mode mock
  npm run x:kol:discover -- --client_id client_demo_001 --mode mock
  npm run x:lead:discover -- --client_id client_demo_001 --mode mock
  npm run x:engagement:sync -- --client_id client_demo_001 --mode mock
  npm run x:dm:sync -- --client_id client_demo_001
  npm run x:report -- --client_id client_demo_001`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

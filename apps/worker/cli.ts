import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertContentApproved, assertPublishApproved, assertVariantApproved } from "../../packages/core/approval.js";
import { categories, getCategory } from "../../packages/core/category.js";
import type {
  Client,
  ContentAsset,
  AccountRole,
  ContentFocus,
  Lead,
  Platform,
  PlatformAccount,
  PlatformVariant,
  PublishRecord,
  PublishTask,
  ReplyDraft
} from "../../packages/core/types.js";
import { classifyIntent } from "../../packages/lead-intelligence/classifyIntent.js";
import { generateReplyDraft } from "../../packages/lead-intelligence/generateReplyDraft.js";
import { scoreLead } from "../../packages/lead-intelligence/scoreLead.js";
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
    case "content:variant":
      return createVariant();
    case "content:approve":
      return approveContent();
    case "variant:approve":
      return approveVariant();
    case "publish:schedule":
      return schedulePublish();
    case "publish:run":
      return runPublishQueue();
    case "publish:status":
      return publishStatus();
    case "lead:import":
      return importLead();
    case "lead:score":
      return scoreLeads();
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
  account.updated_at = new Date().toISOString();
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
  const asset: ContentAsset = {
    content_id: arg("content_id", id("content")),
    client_id: clientId,
    category_id: categoryId,
    content_theme: arg("content_theme", "college_transfer"),
    content_type: arg("content_type", "short_video") as ContentAsset["content_type"],
    content_angle: arg("content_angle", "pain_point"),
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
    approved_by_human: false
  };

  content.push(asset);
  await writeClientArray(clientId, "content-pool.json", content);
  console.log(`Added content ${asset.content_id}`);
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
    status: "ready_for_review",
    approval_status: "ready_for_review"
  };

  variants.push(variant);
  await writeClientArray(clientId, "platform-variants.json", variants);
  console.log(`Created ${platform} variant ${variant.variant_id}`);
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
  await writeClientArray(clientId, "content-pool.json", contents);
  console.log(`Approved content ${contentId}`);
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
  await writeClientArray(clientId, "platform-variants.json", variants);
  console.log(`Approved variant ${variantId}`);
}

async function schedulePublish(): Promise<void> {
  const clientId = arg("client_id");
  const variantId = arg("variant_id");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) {
    throw new Error(`Variant ${variantId} was not found under ${clientId}`);
  }
  if (!isPublishablePlatform(variant.platform)) {
    throw new Error(`${variant.platform} is reserved and cannot be scheduled in Phase 1.`);
  }
  const account = accounts.find((item) => item.account_id === variant.account_id);
  assertAccountCanPublish(account, variant.account_id);
  const content = contents.find((item) => item.content_id === variant.content_id);
  if (!content) {
    throw new Error(`Content ${variant.content_id} was not found under ${clientId}`);
  }
  assertContentApproved(content);
  assertVariantApproved(variant);

  const task: PublishTask = {
    publish_task_id: arg("publish_task_id", id("pub")),
    client_id: clientId,
    content_id: content.content_id,
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
    retry_count: 0,
    max_retry: Number(arg("max_retry", "3")),
    last_error: null,
    next_retry_at: null
  };

  queue.push(task);
  await writeClientArray(clientId, "publish-queue.json", queue);
  console.log(`Scheduled publish task ${task.publish_task_id}`);
}

async function runPublishQueue(): Promise<void> {
  const clientId = arg("client_id");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
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
    try {
      assertPublishApproved(task);
    } catch (error) {
      task.status = "failed";
      task.error_message = error instanceof Error ? error.message : "approval_status must be approved before publishing";
      continue;
    }
    if (!isPublishablePlatform(task.platform)) {
      task.status = "failed";
      task.error_message = `${task.platform} is reserved and cannot publish in Phase 1`;
      continue;
    }
    const variant = variants.find((item) => item.variant_id === task.variant_id);
    if (!variant) {
      task.status = "failed";
      task.error_message = `Variant ${task.variant_id} was not found`;
      task.last_error = task.error_message;
      continue;
    }
    try {
      assertVariantApproved(variant);
    } catch (error) {
      task.status = "failed";
      task.error_message = error instanceof Error ? error.message : "variant must be approved before publishing";
      task.last_error = task.error_message;
      continue;
    }
    const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
    const account = accounts.find((item) => item.account_id === task.account_id);
    try {
      assertAccountCanPublish(account, task.account_id);
    } catch (error) {
      task.status = "failed";
      task.error_message = error instanceof Error ? error.message : "account cannot publish";
      task.last_error = task.error_message;
      continue;
    }

    task.status = "publishing";
    const result = await publishers[task.platform].publish(task, variant);
    if (result.ok) {
      task.status = "published";
      task.platform_post_id = result.platform_post_id;
      task.published_at = new Date().toISOString();
      task.error_message = null;
      task.last_error = null;
      task.next_retry_at = null;
      records.push({ ...task, record_id: id("record") });
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

async function importLead(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const category = getCategory(client.industry);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const platform = arg("platform", "instagram") as Platform;
  const fallbackAccount = accounts.find((account) => account.platform === platform);
  const messageText = arg("message_text", "我孩子现在大一，可以转到加拿大吗？");
  const leadScore = scoreLead(messageText, category);
  const intent = classifyIntent(messageText);
  const lead: Lead = {
    lead_id: arg("lead_id", id("lead")),
    client_id: clientId,
    platform,
    account_id: arg("account_id", fallbackAccount?.account_id ?? `${platform}_unknown`),
    source_type: arg("source_type", "comment") as Lead["source_type"],
    source_post_id: arg("source_post_id", "platform_post_mock"),
    user_handle: arg("user_handle", "canada_parent_88"),
    user_display_name: arg("user_display_name", "Lily"),
    message_text: messageText,
    detected_intent: intent,
    lead_score: leadScore,
    lead_stage: leadScore === 0 ? "spam" : leadScore >= 60 ? "qualified" : "new",
    recommended_reply: "",
    human_review_required: true,
    assigned_to: arg("assigned_to", "jason"),
    next_follow_up_at: arg("next_follow_up_at", ""),
    last_contacted_at: null,
    contact_method: arg("contact_method", "unknown") as Lead["contact_method"],
    lead_notes: csv(arg("lead_notes", "")),
    created_at: new Date().toISOString()
  };
  lead.recommended_reply = generateReplyDraft(client, lead);
  leads.push(lead);
  await writeClientArray(clientId, "leads.json", leads);
  await upsertReplyDraft(clientId, lead);
  console.log(`Imported lead ${lead.lead_id} with score ${lead.lead_score}`);
}

async function scoreLeads(): Promise<void> {
  const clientId = arg("client_id");
  const client = await readClient(clientId);
  const category = getCategory(client.industry);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  for (const lead of leads) {
    lead.detected_intent = classifyIntent(lead.message_text);
    lead.lead_score = scoreLead(lead.message_text, category);
    lead.lead_stage = lead.lead_score === 0 ? "spam" : lead.lead_score >= 60 ? "qualified" : lead.lead_stage === "spam" ? "new" : lead.lead_stage;
    lead.recommended_reply = generateReplyDraft(client, lead);
    await upsertReplyDraft(clientId, lead);
  }
  await writeClientArray(clientId, "leads.json", leads);
  console.log(`Scored ${leads.length} leads for ${clientId}`);
}

async function upsertReplyDraft(clientId: string, lead: Lead): Promise<void> {
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const existing = drafts.find((draft) => draft.lead_id === lead.lead_id);
  if (existing) {
    existing.draft_text = lead.recommended_reply;
    existing.approval_status = "draft";
  } else {
    drafts.push({
      reply_draft_id: id("reply"),
      lead_id: lead.lead_id,
      client_id: clientId,
      draft_text: lead.recommended_reply,
      approval_status: "draft",
      sent_status: "not_sent",
      created_at: new Date().toISOString()
    });
  }
  await writeClientArray(clientId, "reply-drafts.json", drafts);
}

async function generateDailyReport(): Promise<void> {
  const clientId = arg("client_id");
  const date = arg("date", new Date().toISOString().slice(0, 10));
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const activeAccountIds = new Set(accounts.filter((account) => account.status === "active").map((account) => account.account_id));
  const leadTrackingAccountIds = new Set(accounts.filter((account) => account.status === "active" && account.lead_tracking_enabled).map((account) => account.account_id));
  const reportQueue = queue.filter((task) => activeAccountIds.has(task.account_id));
  const reportRecords = records.filter((record) => activeAccountIds.has(record.account_id));
  const reportLeads = leads.filter((lead) => leadTrackingAccountIds.has(lead.account_id));
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
    high_score_leads: reportLeads.filter((lead) => lead.lead_score >= 70),
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
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const activeAccountIds = new Set(accounts.filter((account) => account.status === "active").map((account) => account.account_id));
  const leadTrackingAccountIds = new Set(accounts.filter((account) => account.status === "active" && account.lead_tracking_enabled).map((account) => account.account_id));
  const reportQueue = queue.filter((task) => activeAccountIds.has(task.account_id));
  const reportRecords = records.filter((record) => activeAccountIds.has(record.account_id));
  const reportLeads = leads.filter((lead) => leadTrackingAccountIds.has(lead.account_id));
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
    high_value_leads: weeklyLeads.filter((lead) => lead.lead_score >= 70),
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

function printHelp(): void {
  console.log(`Usage:
  npm run client:create -- --client_id client_study_001
  npm run account:add -- --client_id client_study_001 --platform instagram
  npm run content:add -- --client_id client_study_001
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

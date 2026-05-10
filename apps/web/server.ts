import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { AccountRole, Client, ContentAngle, ContentAsset, ContentFocus, ContentTheme, Lead, Platform, PlatformAccount, PlatformCapabilities, PlatformVariant, PublishRecord, PublishTask, ReplyDraft, XEngagementItem, XKolProspect, XLeadCandidate, XQueryHistoryEntry, XResearchPost } from "../../packages/core/types.js";
import { assertContentApproved, assertVariantApproved } from "../../packages/core/approval.js";
import { categories, getCategory } from "../../packages/core/category.js";
import { classifyIntent } from "../../packages/lead-intelligence/classifyIntent.js";
import { generateReplyDraft } from "../../packages/lead-intelligence/generateReplyDraft.js";
import { scoreLead, type LeadScoringRule } from "../../packages/lead-intelligence/scoreLead.js";
import { createMockPublisher } from "../../packages/publishers/mockPublisher.js";
import { xPublisher } from "../../packages/publishers/x/index.js";
import { clientDir, clientFile, dataRoot, ensureClientDirectories, readClientArray, readJson, writeClientArray, writeJson } from "../../packages/storage/jsonStore.js";

const port = Number(process.env.PORT ?? 4321);
const publicDir = join(process.cwd(), "apps", "web", "public");
const execFileAsync = promisify(execFile);
const platforms: Platform[] = ["instagram", "tiktok", "facebook", "x", "linkedin", "youtube"];
const publishablePlatforms: Platform[] = ["instagram", "tiktok", "facebook", "x"];
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
interface XApiUsageEntry {
  timestamp: string;
  client_id: string;
  method: "GET";
  path: string;
  url: string;
  cost_units: number;
  cache_hit: boolean;
}
const leadStages: Lead["lead_stage"][] = ["new", "qualified", "replied", "waiting_response", "booked", "converted", "not_interested", "spam"];
const leadSourceTypes: Lead["source_type"][] = ["comment", "dm", "form", "manual", "email", "whatsapp", "csv"];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Unknown server error" });
  }
});

server.listen(port, () => {
  console.log(`Social Ops Hub UI running at http://localhost:${port}`);
});

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method === "GET" && url.pathname === "/api/clients") {
    sendJson(res, 200, { clients: await listClients() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const clientId = url.searchParams.get("client_id") ?? "client_study_001";
    sendJson(res, 200, await loadState(clientId));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/client/create") {
    const body = await readBody<CreateClientRequest>(req);
    await createClient(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/create") {
    const body = await readBody<AccountRequest>(req);
    await createAccount(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/update") {
    const body = await readBody<AccountRequest & { account_id: string }>(req);
    await updateAccount(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/account/toggle") {
    const body = await readBody<{ client_id: string; account_id: string; field: "posting_enabled" | "lead_tracking_enabled"; value: boolean }>(req);
    await toggleAccount(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/content/create") {
    const body = await readBody<ContentRequest>(req);
    await createContent(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/content/update") {
    const body = await readBody<ContentRequest & { content_id: string }>(req);
    await updateContent(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/content/generate") {
    const body = await readBody<{ client_id: string; theme: ContentTheme }>(req);
    await generateContentAsset(body.client_id, body.theme);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/content/variant/generate") {
    const body = await readBody<{ client_id: string; content_id: string }>(req);
    await generateVariantsForContent(body.client_id, body.content_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/content/approve") {
    const body = await readBody<{ client_id: string; content_id: string }>(req);
    const contents = await readClientArray<ContentAsset>(body.client_id, "content-pool.json");
    const content = contents.find((item) => item.content_id === body.content_id);
    if (!content) throw new Error(`Content ${body.content_id} not found`);
    content.status = "approved";
    content.approved_by_human = true;
    content.updated_at = new Date().toISOString();
    await writeClientArray(body.client_id, "content-pool.json", contents);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/content/reject") {
    const body = await readBody<{ client_id: string; content_id: string }>(req);
    const contents = await readClientArray<ContentAsset>(body.client_id, "content-pool.json");
    const content = contents.find((item) => item.content_id === body.content_id);
    if (!content) throw new Error(`Content ${body.content_id} not found`);
    content.status = "failed";
    content.approved_by_human = false;
    content.updated_at = new Date().toISOString();
    await writeClientArray(body.client_id, "content-pool.json", contents);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/variant/update") {
    const body = await readBody<{ client_id: string; variant_id: string; caption: string; hashtags: string[]; cta: string }>(req);
    await updateVariant(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/variant/approve") {
    const body = await readBody<{ client_id: string; variant_id: string }>(req);
    const variants = await readClientArray<PlatformVariant>(body.client_id, "platform-variants.json");
    const variant = variants.find((item) => item.variant_id === body.variant_id);
    if (!variant) throw new Error(`Variant ${body.variant_id} not found`);
    variant.status = "approved";
    variant.approval_status = "approved";
    variant.rejection_reason = null;
    variant.updated_at = new Date().toISOString();
    await writeClientArray(body.client_id, "platform-variants.json", variants);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/variant/reject") {
    const body = await readBody<{ client_id: string; variant_id: string; rejection_reason?: string }>(req);
    const variants = await readClientArray<PlatformVariant>(body.client_id, "platform-variants.json");
    const variant = variants.find((item) => item.variant_id === body.variant_id);
    if (!variant) throw new Error(`Variant ${body.variant_id} not found`);
    variant.status = "failed";
    variant.approval_status = "rejected";
    variant.rejection_reason = body.rejection_reason || "Rejected by human reviewer";
    variant.updated_at = new Date().toISOString();
    await writeClientArray(body.client_id, "platform-variants.json", variants);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/run") {
    const body = await readBody<{ client_id: string }>(req);
    await runPublish(body.client_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/schedule") {
    const body = await readBody<{ client_id: string; variant_id: string; scheduled_at: string }>(req);
    await schedulePublishTask(body.client_id, body.variant_id, body.scheduled_at);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/schedule-batch") {
    const body = await readBody<{ client_id: string; date: string }>(req);
    await scheduleBatch(body.client_id, body.date);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/cancel") {
    const body = await readBody<{ client_id: string; publish_task_id: string }>(req);
    await cancelPublishTask(body.client_id, body.publish_task_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/reschedule") {
    const body = await readBody<{ client_id: string; publish_task_id: string; scheduled_at: string }>(req);
    await reschedulePublishTask(body.client_id, body.publish_task_id, body.scheduled_at);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/retry") {
    const body = await readBody<{ client_id: string; publish_task_id: string }>(req);
    await retryPublishTask(body.client_id, body.publish_task_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lead/import") {
    const body = await readBody<LeadImportRequest>(req);
    await importLead(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lead/update") {
    const body = await readBody<{ client_id: string; lead_id: string; lead_stage?: Lead["lead_stage"]; assigned_to?: string; next_follow_up_at?: string | null; last_contacted_at?: string | null; contact_method?: Lead["contact_method"]; lead_notes?: string[] }>(req);
    await updateLead(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lead/score") {
    const body = await readBody<{ client_id: string }>(req);
    await scoreLeads(body.client_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reply/generate") {
    const body = await readBody<{ client_id: string; lead_id: string }>(req);
    await generateReplyForLead(body.client_id, body.lead_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reply/approve") {
    const body = await readBody<{ client_id: string; reply_draft_id: string }>(req);
    await setReplyDraftApproval(body.client_id, body.reply_draft_id, "approved");
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reply/reject") {
    const body = await readBody<{ client_id: string; reply_draft_id: string; rejection_reason?: string }>(req);
    await setReplyDraftApproval(body.client_id, body.reply_draft_id, "rejected", body.rejection_reason);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/report/daily") {
    const body = await readBody<{ client_id: string }>(req);
    await writeDailyReport(body.client_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/report/weekly") {
    const body = await readBody<{ client_id: string }>(req);
    await writeWeeklyReport(body.client_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/action") {
    const body = await readBody<XActionRequest>(req);
    const log = await runXAction(body);
    sendJson(res, 200, { ...(await loadState(body.client_id)), x_action_log: log });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/research/update") {
    const body = await readBody<{ client_id: string; post_id: string; research_status: XResearchPost["research_status"] }>(req);
    await updateXResearchPost(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/research/save-content") {
    const body = await readBody<{ client_id: string; post_id: string }>(req);
    await saveXResearchAsContentIdea(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/kol/update") {
    const body = await readBody<{ client_id: string; prospect_id: string; collaboration_status?: XKolProspect["collaboration_status"]; prospect_status?: XKolProspect["prospect_status"]; notes?: string }>(req);
    await updateXKolProspect(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/lead/convert") {
    const body = await readBody<{ client_id: string; candidate_id: string; generate_reply?: boolean }>(req);
    await convertXLeadCandidate(body.client_id, body.candidate_id, Boolean(body.generate_reply));
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/lead/reply-draft") {
    const body = await readBody<{ client_id: string; candidate_id: string }>(req);
    await convertXLeadCandidate(body.client_id, body.candidate_id, true);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/lead/update") {
    const body = await readBody<{ client_id: string; candidate_id: string; candidate_status: XLeadCandidate["candidate_status"] }>(req);
    await updateXLeadCandidate(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/engagement/update") {
    const body = await readBody<{ client_id: string; engagement_id: string; classification?: XEngagementItem["classification"]; action_status?: XEngagementItem["action_status"] }>(req);
    await updateXEngagementItem(body);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/engagement/convert-lead") {
    const body = await readBody<{ client_id: string; engagement_id: string }>(req);
    await convertXEngagementToLead(body.client_id, body.engagement_id, false);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/engagement/reply-draft") {
    const body = await readBody<{ client_id: string; engagement_id: string }>(req);
    await convertXEngagementToLead(body.client_id, body.engagement_id, true);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function loadState(clientId: string) {
  const client = await readJson<Client | null>(clientFile(clientId, "client.json"), null);
  if (!client) throw new Error(`Client ${clientId} not found. Run npm run demo:seed first.`);

  const xJsonErrors: Array<{ file: string; message: string }> = [];
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const xResearchPosts = await readSafeClientArray<XResearchPost>(clientId, "x-research-posts.json", xJsonErrors);
  const xKolProspects = await readSafeClientArray<XKolProspect>(clientId, "kol-prospects.json", xJsonErrors);
  const xLeadCandidates = await readSafeClientArray<XLeadCandidate>(clientId, "lead-candidates.json", xJsonErrors);
  const xEngagementInbox = await readSafeClientArray<XEngagementItem>(clientId, "x-engagement-inbox.json", xJsonErrors);
  const xQueryHistory = await readSafeClientArray<XQueryHistoryEntry>(clientId, "x-query-history.json", xJsonErrors);
  const xApiUsage = await readSafeClientArray<XApiUsageEntry>(clientId, "x-api-usage.json", xJsonErrors);
  const xReports = await readXReports(clientId, xJsonErrors);
  const xBudget = buildXBudgetSummary(client, xApiUsage);

  return {
    clients: await listClients(),
    categories,
    platform_options: platforms,
    account_role_options: accountRoles,
    content_focus_options: contentFocuses,
    content_theme_options: contentThemes,
    content_angle_options: contentAngles,
    platform_style_rules: await readStyleRules(),
    publish_rules: await readPublishRules(),
    platform_capabilities: await readPlatformCapabilities(),
    lead_scoring_rules: await readLeadScoringRules(),
    lead_stage_options: leadStages,
    lead_source_type_options: leadSourceTypes,
    client,
    accounts,
    contents,
    variants,
    queue,
    records,
    leads,
    drafts,
    x: {
      research_posts: xResearchPosts,
      kol_prospects: xKolProspects,
      lead_candidates: xLeadCandidates,
      engagement_inbox: xEngagementInbox,
      reports: xReports,
      query_history: xQueryHistory,
      api_usage: xApiUsage,
      budget: xBudget,
      json_errors: xJsonErrors
    },
    account_stats: buildAccountStats(accounts, queue, records, leads),
    summary: {
      active_accounts: accounts.filter((item) => item.status === "active").length,
      content_assets: contents.length,
      ready_variants: variants.filter((item) => item.status === "ready_for_review" || item.status === "approved").length,
      scheduled_tasks: queue.filter((item) => item.status === "scheduled").length,
      published_tasks: queue.filter((item) => item.status === "published").length,
      high_score_leads: leads.filter((item) => item.lead_score >= 70).length
    }
  };
}

interface AccountRequest {
  client_id: string;
  account_id?: string;
  platform: Platform;
  account_name: string;
  display_name: string;
  account_url: string | null;
  language: string;
  region: string;
  account_role: AccountRole;
  content_focus: ContentFocus;
  posting_enabled: boolean;
  lead_tracking_enabled: boolean;
  auth_status?: PlatformAccount["auth_status"];
  status?: PlatformAccount["status"];
  capability_override?: Partial<PlatformCapabilities>;
  notes: string;
}

interface LeadImportRequest {
  client_id: string;
  platform?: Platform;
  account_id?: string;
  source_type?: Lead["source_type"];
  source_post_id?: string | null;
  source_url?: string | null;
  user_handle?: string;
  user_display_name?: string;
  message_text: string;
  assigned_to?: string;
  next_follow_up_at?: string | null;
  contact_method?: Lead["contact_method"];
  lead_notes?: string[];
}

interface XActionRequest {
  client_id: string;
  action: "research" | "kol" | "competitor" | "lead" | "engagement" | "dm" | "report";
  mode?: "mock" | "api";
  keywords?: string;
  username?: string;
}

async function createAccount(body: AccountRequest): Promise<void> {
  if (!body.client_id) throw new Error("client_id is required.");
  await readJson<Client>(clientFile(body.client_id, "client.json"), null as unknown as Client);
  validateAccountRequest(body);
  const accounts = await readClientArray<PlatformAccount>(body.client_id, "accounts.json");
  const now = new Date().toISOString();
  const accountId = body.account_id || `${body.platform}_${makeId("account")}`;
  if (accounts.some((account) => account.account_id === accountId)) {
    throw new Error(`Account ${accountId} already exists under ${body.client_id}.`);
  }
  const account: PlatformAccount = {
    account_id: accountId,
    client_id: body.client_id,
    platform: body.platform,
    account_name: body.account_name,
    display_name: body.display_name || body.account_name,
    account_url: body.account_url || null,
    language: body.language || "en",
    region: body.region || "Canada",
    account_role: body.account_role,
    content_focus: body.content_focus,
    posting_enabled: body.posting_enabled,
    lead_tracking_enabled: body.lead_tracking_enabled,
    auth_status: body.auth_status ?? "mock",
    status: body.status ?? "active",
    capability_override: body.capability_override ?? {},
    notes: body.notes || "",
    created_at: now,
    updated_at: now
  };
  accounts.push(account);
  await writeClientArray(body.client_id, "accounts.json", accounts);
}

async function updateAccount(body: AccountRequest & { account_id: string }): Promise<void> {
  validateAccountRequest(body);
  const accounts = await readClientArray<PlatformAccount>(body.client_id, "accounts.json");
  const account = accounts.find((item) => item.account_id === body.account_id);
  if (!account) throw new Error(`Account ${body.account_id} not found.`);
  Object.assign(account, {
    platform: body.platform,
    account_name: body.account_name,
    display_name: body.display_name || body.account_name,
    account_url: body.account_url || null,
    language: body.language || "en",
    region: body.region || "Canada",
    account_role: body.account_role,
    content_focus: body.content_focus,
    posting_enabled: body.posting_enabled,
    lead_tracking_enabled: body.lead_tracking_enabled,
    auth_status: body.auth_status ?? account.auth_status,
    status: body.status ?? account.status,
    capability_override: body.capability_override ?? account.capability_override ?? {},
    notes: body.notes || "",
    updated_at: new Date().toISOString()
  });
  await writeClientArray(body.client_id, "accounts.json", accounts);
}

async function toggleAccount(body: { client_id: string; account_id: string; field: "posting_enabled" | "lead_tracking_enabled"; value: boolean }): Promise<void> {
  const accounts = await readClientArray<PlatformAccount>(body.client_id, "accounts.json");
  const account = accounts.find((item) => item.account_id === body.account_id);
  if (!account) throw new Error(`Account ${body.account_id} not found.`);
  account[body.field] = body.value;
  account.updated_at = new Date().toISOString();
  await writeClientArray(body.client_id, "accounts.json", accounts);
}

function validateAccountRequest(body: AccountRequest): void {
  if (!platforms.includes(body.platform)) throw new Error(`Invalid platform: ${body.platform}`);
  if (!accountRoles.includes(body.account_role)) throw new Error(`Invalid account_role: ${body.account_role}`);
  if (!contentFocuses.includes(body.content_focus)) throw new Error(`Invalid content_focus: ${body.content_focus}`);
  if (!body.account_name) throw new Error("account_name is required.");
}

function buildAccountStats(accounts: PlatformAccount[], queue: PublishTask[], records: PublishRecord[], leads: Lead[]) {
  return accounts.reduce<Record<string, { queued: number; published: number; leads: number }>>((acc, account) => {
    acc[account.account_id] = {
      queued: account.status === "active" ? queue.filter((task) => task.account_id === account.account_id).length : 0,
      published: account.status === "active" ? records.filter((record) => record.account_id === account.account_id).length : 0,
      leads: account.status === "active" && account.lead_tracking_enabled ? leads.filter((lead) => lead.account_id === account.account_id).length : 0
    };
    return acc;
  }, {});
}

interface ContentRequest {
  client_id: string;
  content_id?: string;
  category_id?: string;
  content_theme: ContentTheme;
  content_type: ContentAsset["content_type"];
  content_angle: ContentAngle;
  title: string;
  hook: string;
  main_points: string[];
  cta: string;
  language: string;
  target_audience: string[];
  funnel_stage: ContentAsset["funnel_stage"];
  media_assets?: ContentAsset["media_assets"];
  status?: ContentAsset["status"];
}

type PlatformStyleRules = Record<string, { formats: string[]; tone: string; caption_style: string; hashtag_count: number; cta_style: string }>;

async function createContent(body: ContentRequest): Promise<void> {
  const client = await readJson<Client>(clientFile(body.client_id, "client.json"), null as unknown as Client);
  validateContentRequest(body);
  const now = new Date().toISOString();
  const contents = await readClientArray<ContentAsset>(body.client_id, "content-pool.json");
  const contentId = body.content_id || makeId("content");
  if (contents.some((content) => content.content_id === contentId)) {
    throw new Error(`Content ${contentId} already exists under ${body.client_id}.`);
  }
  contents.push({
    content_id: contentId,
    client_id: body.client_id,
    category_id: body.category_id || client.industry,
    content_theme: body.content_theme,
    content_type: body.content_type,
    content_angle: body.content_angle,
    title: body.title,
    hook: body.hook,
    main_points: body.main_points,
    cta: body.cta,
    language: body.language || client.language[0] || "en",
    target_audience: body.target_audience.length > 0 ? body.target_audience : client.target_audience,
    funnel_stage: body.funnel_stage,
    media_assets: body.media_assets ?? [],
    status: body.status === "approved" ? "ready_for_review" : body.status ?? "draft",
    created_by: "web_ui",
    approved_by_human: false,
    created_at: now,
    updated_at: now
  });
  await writeClientArray(body.client_id, "content-pool.json", contents);
}

async function updateContent(body: ContentRequest & { content_id: string }): Promise<void> {
  validateContentRequest(body);
  const contents = await readClientArray<ContentAsset>(body.client_id, "content-pool.json");
  const content = contents.find((item) => item.content_id === body.content_id);
  if (!content) throw new Error(`Content ${body.content_id} not found.`);
  Object.assign(content, {
    category_id: body.category_id || content.category_id,
    content_theme: body.content_theme,
    content_type: body.content_type,
    content_angle: body.content_angle,
    title: body.title,
    hook: body.hook,
    main_points: body.main_points,
    cta: body.cta,
    language: body.language,
    target_audience: body.target_audience,
    funnel_stage: body.funnel_stage,
    media_assets: body.media_assets ?? content.media_assets,
    status: body.status === "approved" && !content.approved_by_human ? content.status : body.status ?? content.status,
    updated_at: new Date().toISOString()
  });
  await writeClientArray(body.client_id, "content-pool.json", contents);
}

function validateContentRequest(body: ContentRequest): void {
  if (!body.client_id) throw new Error("client_id is required.");
  if (!contentThemes.includes(body.content_theme)) throw new Error(`Invalid content_theme: ${body.content_theme}`);
  if (!contentAngles.includes(body.content_angle)) throw new Error(`Invalid content_angle: ${body.content_angle}`);
  if (!body.title) throw new Error("title is required.");
  if (!body.hook) throw new Error("hook is required.");
  if (!body.cta) throw new Error("cta is required.");
  if (!body.main_points || body.main_points.length === 0) throw new Error("main_points is required.");
}

async function generateContentAsset(clientId: string, theme: ContentTheme): Promise<void> {
  if (!contentThemes.includes(theme)) throw new Error(`Invalid theme: ${theme}`);
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const category = getCategory(client.industry);
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const now = new Date().toISOString();
  const asset: ContentAsset = {
    content_id: makeId("content"),
    client_id: clientId,
    category_id: client.industry,
    content_theme: theme,
    content_type: "short_video",
    content_angle: defaultAngleForTheme(theme),
    title: buildContentTitle(client, theme),
    hook: buildContentHook(client, theme, category.content_angles),
    main_points: buildMainPoints(client, theme, accounts),
    cta: buildContentCta(client, theme),
    language: client.language[0] ?? "en",
    target_audience: client.target_audience.slice(0, 3),
    funnel_stage: defaultFunnelForTheme(theme),
    media_assets: [],
    status: "ready_for_review",
    created_by: "web_mock_generator",
    approved_by_human: false,
    created_at: now,
    updated_at: now
  };
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  contents.push(asset);
  await writeClientArray(clientId, "content-pool.json", contents);
}

async function generateVariantsForContent(clientId: string, contentId: string): Promise<void> {
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const content = contents.find((item) => item.content_id === contentId);
  if (!content) throw new Error(`Content ${contentId} not found.`);
  const accounts = (await readClientArray<PlatformAccount>(clientId, "accounts.json")).filter((account) => account.status === "active" && account.posting_enabled);
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const rules = await readStyleRules();
  const created: PlatformVariant[] = [];
  for (const account of accounts) {
    if (variants.some((variant) => variant.content_id === content.content_id && variant.account_id === account.account_id)) continue;
    const variant = buildVariantForAccount(content, account, rules);
    variants.push(variant);
    created.push(variant);
  }
  ensureDistinctCaptions(created);
  await writeClientArray(clientId, "platform-variants.json", variants);
}

async function updateVariant(body: { client_id: string; variant_id: string; caption: string; hashtags: string[]; cta: string }): Promise<void> {
  const variants = await readClientArray<PlatformVariant>(body.client_id, "platform-variants.json");
  const variant = variants.find((item) => item.variant_id === body.variant_id);
  if (!variant) throw new Error(`Variant ${body.variant_id} not found.`);
  variant.caption = body.caption;
  variant.hashtags = body.hashtags;
  variant.cta = body.cta;
  if (variant.approval_status === "approved") {
    variant.status = "ready_for_review";
    variant.approval_status = "ready_for_review";
  }
  variant.updated_at = new Date().toISOString();
  await writeClientArray(body.client_id, "platform-variants.json", variants);
}

async function readStyleRules(): Promise<PlatformStyleRules> {
  return JSON.parse(await readFile(join(process.cwd(), "data", "platform-style-rules.json"), "utf8")) as PlatformStyleRules;
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
  return `${client.client_name}: ${theme.replaceAll("_", " ")}`;
}

function buildContentHook(client: Client, theme: ContentTheme, categoryAngles: string[]): string {
  const audience = client.target_audience[0] ?? "your audience";
  const service = client.service_keywords[0] ?? client.business_type;
  if (theme === "pain_point") return `${audience} often struggle with ${service}, but the real issue usually appears earlier in the decision process.`;
  if (theme === "brand_intro") return `${client.client_name} helps ${audience} make better decisions around ${service}.`;
  if (theme === "faq") return `One question we hear often: how should ${audience} think about ${service}?`;
  return `${categoryAngles[0] ?? "A practical insight"} for ${audience}: ${service} becomes clearer with the right framework.`;
}

function buildMainPoints(client: Client, _theme: ContentTheme, accounts: PlatformAccount[]): string[] {
  const service = client.service_keywords[0] ?? client.business_type;
  const platformNote = accounts.length > 0 ? `Adapt the message across ${accounts.map((account) => account.platform).join(", ")}` : "Use this as a base content asset before platform adaptation";
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

function buildVariantForAccount(content: ContentAsset, account: PlatformAccount, rules: PlatformStyleRules): PlatformVariant {
  const now = new Date().toISOString();
  const rule = rules[account.platform] ?? rules.instagram;
  return {
    variant_id: makeId(`variant_${account.platform}`),
    content_id: content.content_id,
    client_id: content.client_id,
    platform: account.platform,
    account_id: account.account_id,
    format: rule.formats[0] ?? defaultFormat(account.platform),
    caption: buildVariantCaption(content, account, rule),
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

function buildVariantCaption(content: ContentAsset, account: PlatformAccount, rule: { tone: string }): string {
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

interface CreateClientRequest {
  client_id: string;
  client_name: string;
  category_id: string;
  business_type: string;
  region: string;
  language: string[];
  target_audience: string[];
  service_keywords: string[];
  brand_tone: string;
  lead_goal: string[];
  openclaw_brief?: string;
}

async function listClients(): Promise<Array<{ client_id: string; client_name: string; industry: string; status: Client["status"] }>> {
  let entries: string[] = [];
  try {
    entries = await readdir(dataRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const clients = await Promise.all(
    entries.map(async (entry) => {
      const client = await readJson<Client | null>(clientFile(entry, "client.json"), null);
      if (!client) return null;
      return {
        client_id: client.client_id,
        client_name: client.client_name,
        industry: client.industry,
        status: client.status
      };
    })
  );

  return clients.filter((client): client is NonNullable<typeof client> => client !== null).sort((a, b) => a.client_id.localeCompare(b.client_id));
}

async function createClient(body: CreateClientRequest): Promise<void> {
  if (!body.client_id || !/^[a-z0-9_]+$/.test(body.client_id)) {
    throw new Error("client_id can only contain lowercase letters, numbers, and underscores.");
  }
  if (!body.client_name) {
    throw new Error("client_name is required.");
  }

  const category = getCategory(body.category_id);
  const existing = await readJson<Client | null>(clientFile(body.client_id, "client.json"), null);
  if (existing) {
    throw new Error(`Client ${body.client_id} already exists.`);
  }

  await ensureClientDirectories(body.client_id);

  const client: Client = {
    client_id: body.client_id,
    client_name: body.client_name,
    industry: category.category_id,
    business_type: body.business_type || `${category.category_id}_consulting`,
    region: body.region || "Canada",
    language: body.language.length > 0 ? body.language : ["zh", "en"],
    target_audience: body.target_audience.length > 0 ? body.target_audience : ["prospects"],
    service_keywords: body.service_keywords.length > 0 ? body.service_keywords : category.lead_keywords,
    brand_tone: body.brand_tone || "professional, trustworthy, friendly",
    lead_goal: body.lead_goal.length > 0 ? body.lead_goal : ["DM inquiry", "book consultation"],
    status: "active"
  };

  await writeJson(clientFile(body.client_id, "client.json"), client);
  await writeJson(clientFile(body.client_id, "categories.json"), categories);
  await writeClientArray<PlatformAccount>(body.client_id, "accounts.json", []);
  await writeClientArray<ContentAsset>(body.client_id, "content-pool.json", []);
  await writeClientArray<PlatformVariant>(body.client_id, "platform-variants.json", []);
  await writeClientArray<PublishTask>(body.client_id, "publish-queue.json", []);
  await writeClientArray<PublishRecord>(body.client_id, "publish-records.json", []);
  await writeClientArray<Lead>(body.client_id, "leads.json", []);
  await writeClientArray<ReplyDraft>(body.client_id, "reply-drafts.json", []);

  if (body.openclaw_brief?.trim()) {
    await writeJson(clientFile(body.client_id, "openclaw-client-brief.json"), {
      client_id: body.client_id,
      brief: body.openclaw_brief.trim(),
      next_step: "Use this brief to generate content angles, account personas, service keywords, lead keywords, and initial content assets.",
      created_at: new Date().toISOString()
    });
  }
}

async function schedulePublishTask(clientId: string, variantId: string, scheduledAt: string): Promise<void> {
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) throw new Error(`Variant ${variantId} not found`);
  const now = new Date().toISOString();
  const task: PublishTask = {
    publish_task_id: makeId("pub"),
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
  const readiness = await checkPublishReadiness({
    content: contents.find((item) => item.content_id === task.content_id),
    variant,
    account: accounts.find((item) => item.account_id === task.account_id),
    queue,
    task,
    rules,
    capabilities
  });
  if (!readiness.ready) blockTask(task, readiness.reason, readiness.needsManualReview);
  queue.push(task);
  await writeClientArray(clientId, "publish-queue.json", queue);
}

async function scheduleBatch(clientId: string, date: string): Promise<void> {
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const existingVariantIds = new Set(queue.filter((task) => task.status !== "cancelled").map((task) => task.variant_id));
  for (const variant of variants.filter((item) => item.status === "approved" && item.approval_status === "approved")) {
    if (existingVariantIds.has(variant.variant_id)) continue;
    const now = new Date().toISOString();
    const task: PublishTask = {
      publish_task_id: makeId("pub"),
      client_id: clientId,
      content_id: variant.content_id,
      variant_id: variant.variant_id,
      platform: variant.platform,
      account_id: variant.account_id,
      scheduled_at: findNextSlot(date, variant.platform, variant.account_id, queue, rules),
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
    const readiness = await checkPublishReadiness({
      content: contents.find((item) => item.content_id === task.content_id),
      variant,
      account: accounts.find((item) => item.account_id === task.account_id),
      queue,
      task,
      rules,
      capabilities
    });
    if (!readiness.ready) blockTask(task, readiness.reason, readiness.needsManualReview);
    queue.push(task);
  }
  await writeClientArray(clientId, "publish-queue.json", queue);
}

async function cancelPublishTask(clientId: string, taskId: string): Promise<void> {
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const task = findPublishTask(queue, taskId);
  if (task.status === "published") throw new Error("Published task cannot be cancelled.");
  task.status = "cancelled";
  task.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "publish-queue.json", queue);
}

async function reschedulePublishTask(clientId: string, taskId: string, scheduledAt: string): Promise<void> {
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const task = findPublishTask(queue, taskId);
  if (task.status === "published") throw new Error("Published task cannot be rescheduled.");
  task.scheduled_at = scheduledAt;
  task.status = "scheduled";
  task.blocked_reason = null;
  task.error_message = null;
  task.updated_at = new Date().toISOString();
  const readiness = await checkPublishReadiness({
    content: contents.find((item) => item.content_id === task.content_id),
    variant: variants.find((item) => item.variant_id === task.variant_id),
    account: accounts.find((item) => item.account_id === task.account_id),
    queue,
    task,
    rules,
    capabilities,
    currentTaskId: task.publish_task_id
  });
  if (!readiness.ready) blockTask(task, readiness.reason, readiness.needsManualReview);
  await writeClientArray(clientId, "publish-queue.json", queue);
}

async function retryPublishTask(clientId: string, taskId: string): Promise<void> {
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const task = findPublishTask(queue, taskId);
  if (task.status === "published") throw new Error("Published task cannot be retried.");
  if (task.status === "cancelled") throw new Error("Cancelled task cannot be retried.");
  await reschedulePublishTask(clientId, taskId, task.scheduled_at);
}

async function runPublish(clientId: string): Promise<void> {
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const now = new Date();

  for (const task of queue) {
    if (task.status !== "scheduled" || new Date(task.scheduled_at) > now) continue;
    if (task.next_retry_at && new Date(task.next_retry_at) > now) continue;
    if (task.platform_post_id || task.published_at) {
      task.status = "published";
      continue;
    }
    if (task.approval_status !== "approved") {
      blockTask(task, "approval_status must be approved before publishing");
      continue;
    }
    if (!publishablePlatforms.includes(task.platform)) {
      blockTask(task, `${task.platform} is reserved and cannot publish in Phase 1`);
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
    if (!variant) continue;
    const publisher = task.platform === "x" ? xPublisher : createMockPublisher(task.platform);
    const result = await publisher.publish(task, variant);
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
        publish_record_id: makeId("record"),
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
    } else {
      registerPublishFailure(task, result.error_message ?? "Unknown publish error");
    }
  }

  await writeClientArray(clientId, "publish-queue.json", queue);
  await writeClientArray(clientId, "publish-records.json", records);
}

async function importLead(body: LeadImportRequest): Promise<void> {
  const client = await readJson<Client>(clientFile(body.client_id, "client.json"), null as unknown as Client);
  const category = getCategory(client.industry);
  const rule = (await readLeadScoringRules())[client.industry];
  const capabilities = await readPlatformCapabilities();
  const accounts = await readClientArray<PlatformAccount>(body.client_id, "accounts.json");
  const platform = body.platform ?? "instagram";
  const fallbackAccount = accounts.find((account) => account.platform === platform && account.status === "active" && account.lead_tracking_enabled);
  const account = accounts.find((item) => item.account_id === (body.account_id ?? fallbackAccount?.account_id));
  if (!account) throw new Error(`Account ${body.account_id ?? `${platform}_unknown`} was not found.`);
  if (account.client_id !== body.client_id) throw new Error(`Account ${account.account_id} does not belong to ${body.client_id}.`);
  if (account.status !== "active") throw new Error(`Account ${account.account_id} is inactive and cannot import valid leads.`);
  if (!account.lead_tracking_enabled) throw new Error(`Account ${account.account_id} has lead tracking disabled.`);
  const sourceType = body.source_type ?? "comment";
  const sourceMode = leadSourceMode(sourceType, account, capabilities);
  const score = scoreLead(body.message_text, category, rule);
  const now = new Date().toISOString();
  const lead: Lead = {
    lead_id: makeId("lead"),
    client_id: body.client_id,
    platform,
    account_id: account.account_id,
    source_type: sourceType,
    source_mode: sourceMode,
    source_post_id: body.source_post_id ?? null,
    source_url: body.source_url ?? null,
    user_handle: body.user_handle || "web_demo_lead",
    user_display_name: body.user_display_name || "Web Demo Lead",
    message_text: body.message_text,
    detected_intent: classifyIntent(body.message_text, rule),
    lead_score: score,
    lead_stage: leadStageFromScore(score, rule),
    recommended_reply: "",
    human_review_required: score >= (rule?.score_rules.qualified_threshold ?? 60),
    assigned_to: body.assigned_to || "jason",
    next_follow_up_at: body.next_follow_up_at ?? null,
    last_contacted_at: null,
    contact_method: body.contact_method ?? "unknown",
    lead_notes: body.lead_notes ?? [],
    created_at: now,
    updated_at: now
  };
  lead.recommended_reply = generateReplyDraft(client, lead);
  const leads = await readClientArray<Lead>(body.client_id, "leads.json");
  leads.push(lead);
  await writeClientArray(body.client_id, "leads.json", leads);
}

async function scoreLeads(clientId: string): Promise<void> {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
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
}

async function upsertDraft(clientId: string, lead: Lead): Promise<void> {
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
      reply_draft_id: makeId("reply"),
      lead_id: lead.lead_id,
      client_id: clientId,
      platform: lead.platform,
      account_id: lead.account_id,
      draft_text: lead.recommended_reply,
      tone: "professional, helpful",
      approval_status: "draft",
      rejection_reason: null,
      sent_status: "not_sent",
      created_at: now,
      updated_at: now
    });
  }
  await writeClientArray(clientId, "reply-drafts.json", drafts);
}

async function generateReplyForLead(clientId: string, leadId: string): Promise<void> {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const lead = findLead(leads, leadId);
  lead.recommended_reply = generateReplyDraft(client, lead);
  lead.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "leads.json", leads);
  await upsertDraft(clientId, lead);
}

async function setReplyDraftApproval(clientId: string, draftId: string, status: "approved" | "rejected", rejectionReason?: string): Promise<void> {
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const draft = drafts.find((item) => item.reply_draft_id === draftId);
  if (!draft) throw new Error(`Reply draft ${draftId} not found.`);
  draft.approval_status = status;
  draft.rejection_reason = status === "rejected" ? rejectionReason || "Rejected by human reviewer" : null;
  draft.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "reply-drafts.json", drafts);
}

async function updateLead(body: { client_id: string; lead_id: string; lead_stage?: Lead["lead_stage"]; assigned_to?: string; next_follow_up_at?: string | null; last_contacted_at?: string | null; contact_method?: Lead["contact_method"]; lead_notes?: string[] }): Promise<void> {
  const leads = await readClientArray<Lead>(body.client_id, "leads.json");
  const lead = findLead(leads, body.lead_id);
  if (body.lead_stage) lead.lead_stage = body.lead_stage;
  if (body.assigned_to !== undefined) lead.assigned_to = body.assigned_to;
  if (body.next_follow_up_at !== undefined) lead.next_follow_up_at = body.next_follow_up_at;
  if (body.last_contacted_at !== undefined) lead.last_contacted_at = body.last_contacted_at;
  if (body.contact_method) lead.contact_method = body.contact_method;
  if (body.lead_notes) lead.lead_notes = body.lead_notes;
  lead.updated_at = new Date().toISOString();
  await writeClientArray(body.client_id, "leads.json", leads);
}

function findLead(leads: Lead[], leadId: string): Lead {
  const lead = leads.find((item) => item.lead_id === leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  return lead;
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

function blockTask(task: PublishTask, reason: string, needsManualReview = false): void {
  task.status = needsManualReview ? "needs_manual_review" : "blocked";
  task.blocked_reason = reason;
  task.error_message = reason;
  task.last_error = reason;
  task.updated_at = new Date().toISOString();
}

function findPublishTask(queue: PublishTask[], taskId: string): PublishTask {
  const task = queue.find((item) => item.publish_task_id === taskId);
  if (!task) throw new Error(`Publish task ${taskId} not found.`);
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
  if (!account) return { ready: false, reason: `Account ${task.account_id} was not found` };
  if (account.status !== "active") return { ready: false, reason: `Account ${task.account_id} is not active` };
  if (!account.posting_enabled) return { ready: false, reason: `Account ${task.account_id} has posting disabled` };
  if (!publishablePlatforms.includes(task.platform)) return { ready: false, reason: `${task.platform} is reserved and cannot publish in Phase 1` };
  if (task.publish_method === "official_api" && account.auth_status !== "connected") {
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
  if (Number.isNaN(new Date(task.scheduled_at).getTime())) return { ready: false, reason: `Invalid scheduled_at: ${task.scheduled_at}` };
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
      return { ready: false, reason: `${variant.platform} ${label} is limited and needs manual workflow`, needsManualReview: true };
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
  if (relevant.length >= rule.max_posts_per_account_per_day) return `${task.account_id} exceeds ${rule.max_posts_per_account_per_day} posts per day`;
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
    return minutes >= startHour * 60 + startMinute && minutes <= endHour * 60 + endMinute;
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
    const tempTask = { publish_task_id: "__candidate__", account_id: accountId, platform, scheduled_at: candidate, status: "scheduled" } as PublishTask;
    if (!checkFrequencyLimit(tempTask, queue, rule, "__candidate__") && isWithinAllowedWindow(candidate, rule)) return candidate;
    slot.setMinutes(slot.getMinutes() + rule.min_minutes_between_posts);
  }
  return new Date(`${date}T23:59:00`).toISOString();
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

async function writeDailyReport(clientId: string): Promise<void> {
  const state = await loadState(clientId);
  const date = new Date().toISOString().slice(0, 10);
  const activeAccountIds = new Set(state.accounts.filter((account) => account.status === "active").map((account) => account.account_id));
  const leadTrackingAccountIds = new Set(state.accounts.filter((account) => account.status === "active" && account.lead_tracking_enabled).map((account) => account.account_id));
  const reportQueue = state.queue.filter((task) => activeAccountIds.has(task.account_id));
  const reportRecords = state.records.filter((record) => activeAccountIds.has(record.account_id));
  const reportLeads = state.leads.filter((lead) => leadTrackingAccountIds.has(lead.account_id));
  const reportDrafts = state.drafts.filter((draft) => leadTrackingAccountIds.has(draft.account_id));
  const report = {
    client_id: clientId,
    date,
    publish_count: reportRecords.filter((record) => record.published_at?.startsWith(date)).length,
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
    top_content_themes: state.contents.reduce<Record<string, number>>((acc, content) => {
      acc[content.content_theme] = (acc[content.content_theme] ?? 0) + 1;
      return acc;
    }, {})
  };
  await writeJson(join(clientDir(clientId), "reports", "daily", `${date}.json`), report);
}

async function writeWeeklyReport(clientId: string): Promise<void> {
  const state = await loadState(clientId);
  const weekStart = startOfWeek(new Date()).toISOString().slice(0, 10);
  const weekEnd = endOfWeek(new Date()).toISOString().slice(0, 10);
  const activeAccountIds = new Set(state.accounts.filter((account) => account.status === "active").map((account) => account.account_id));
  const leadTrackingAccountIds = new Set(state.accounts.filter((account) => account.status === "active" && account.lead_tracking_enabled).map((account) => account.account_id));
  const reportQueue = state.queue.filter((task) => activeAccountIds.has(task.account_id));
  const reportRecords = state.records.filter((record) => activeAccountIds.has(record.account_id));
  const reportLeads = state.leads.filter((lead) => leadTrackingAccountIds.has(lead.account_id));
  const reportDrafts = state.drafts.filter((draft) => leadTrackingAccountIds.has(draft.account_id));
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
    top_content_themes: state.contents.reduce<Record<string, number>>((acc, content) => {
      acc[content.content_theme] = (acc[content.content_theme] ?? 0) + 1;
      return acc;
    }, {}),
    next_week_recommendations: [
      "复用高意图线索对应的内容主题。",
      "优先跟进高分线索并记录联系结果。",
      "继续保持每个平台差异化版本发布。"
    ]
  };
  await writeJson(join(clientDir(clientId), "reports", "weekly", `${weekStart}_${weekEnd}.json`), report);
}

async function runXAction(body: XActionRequest): Promise<string> {
  const commandMap: Record<XActionRequest["action"], string> = {
    research: "x:research:search",
    kol: "x:kol:discover",
    competitor: "x:competitor:mine",
    lead: "x:lead:discover",
    engagement: "x:engagement:sync",
    dm: "x:dm:sync",
    report: "x:report"
  };
  const command = commandMap[body.action];
  const cliArgs = ["apps/worker/cli.ts", command, "--client_id", body.client_id];
  if (body.action !== "report") {
    cliArgs.push("--mode", body.mode ?? "mock");
  }
  if (body.keywords?.trim() && ["research", "kol", "lead"].includes(body.action)) {
    cliArgs.push("--keywords", body.keywords.trim());
  }
  if (body.action === "competitor") {
    cliArgs.push("--username", body.username?.trim() || "competitor_demo");
  }
  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  const { stdout, stderr } = await execFileAsync(tsxBin, cliArgs, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

async function updateXResearchPost(body: { client_id: string; post_id: string; research_status: XResearchPost["research_status"] }): Promise<void> {
  const posts = await readClientArray<XResearchPost>(body.client_id, "x-research-posts.json");
  const post = posts.find((item) => item.post_id === body.post_id);
  if (!post) throw new Error(`X research post ${body.post_id} not found`);
  post.research_status = body.research_status;
  post.saved_at = new Date().toISOString();
  await writeClientArray(body.client_id, "x-research-posts.json", posts);
}

async function saveXResearchAsContentIdea(body: { client_id: string; post_id: string }): Promise<void> {
  const client = await readJson<Client>(clientFile(body.client_id, "client.json"), null as unknown as Client);
  const posts = await readClientArray<XResearchPost>(body.client_id, "x-research-posts.json");
  const post = posts.find((item) => item.post_id === body.post_id);
  if (!post) throw new Error(`X research post ${body.post_id} not found`);
  const contents = await readClientArray<ContentAsset>(body.client_id, "content-pool.json");
  const now = new Date().toISOString();
  contents.push({
    content_id: makeId("content_x_idea"),
    client_id: body.client_id,
    category_id: client.industry,
    content_theme: "pain_point",
    content_type: "text_post",
    content_angle: "problem_solution",
    title: `X idea from @${post.username}`,
    hook: post.text.slice(0, 180),
    main_points: [
      `Source post: ${post.post_url}`,
      `Matched keywords: ${(post.matched_keywords ?? []).join(", ") || "none"}`,
      "Turn this into an approved content asset before publishing."
    ],
    cta: "Review this idea and write a platform-specific CTA.",
    language: client.language[0] ?? "en",
    target_audience: client.target_audience,
    funnel_stage: "awareness",
    media_assets: [],
    status: "draft",
    created_by: "x-research",
    approved_by_human: false,
    created_at: now,
    updated_at: now
  });
  post.research_status = "manually_completed";
  post.saved_at = now;
  await writeClientArray(body.client_id, "content-pool.json", contents);
  await writeClientArray(body.client_id, "x-research-posts.json", posts);
}

async function updateXKolProspect(body: { client_id: string; prospect_id: string; collaboration_status?: XKolProspect["collaboration_status"]; prospect_status?: XKolProspect["prospect_status"]; notes?: string }): Promise<void> {
  const prospects = await readClientArray<XKolProspect>(body.client_id, "kol-prospects.json");
  const prospect = prospects.find((item) => item.prospect_id === body.prospect_id);
  if (!prospect) throw new Error(`KOL prospect ${body.prospect_id} not found`);
  if (body.collaboration_status) prospect.collaboration_status = body.collaboration_status;
  if (body.prospect_status) prospect.prospect_status = body.prospect_status;
  if (body.notes !== undefined) prospect.notes = body.notes;
  prospect.updated_at = new Date().toISOString();
  await writeClientArray(body.client_id, "kol-prospects.json", prospects);
}

async function convertXLeadCandidate(clientId: string, candidateId: string, shouldGenerateReply: boolean): Promise<void> {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const category = getCategory(client.industry);
  const rule = (await readLeadScoringRules())[client.industry];
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = accounts.find((item) => item.platform === "x" && item.status === "active");
  if (!account) throw new Error(`No active X account found for ${clientId}`);
  const candidates = await readClientArray<XLeadCandidate>(clientId, "lead-candidates.json");
  const candidate = candidates.find((item) => item.candidate_id === candidateId);
  if (!candidate) throw new Error(`X lead candidate ${candidateId} not found`);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  let lead = leads.find((item) => item.source_post_id === candidate.source_post_id && item.user_handle === candidate.username);
  const now = new Date().toISOString();
  if (!lead) {
    const score = scoreLead(candidate.message_text, category, rule);
    lead = {
      lead_id: makeId("lead"),
      client_id: clientId,
      platform: "x",
      account_id: account.account_id,
      source_type: "manual",
      source_mode: "manual",
      source_post_id: candidate.source_post_id,
      source_url: candidate.source_url,
      user_handle: candidate.username,
      user_display_name: candidate.display_name || candidate.username,
      message_text: candidate.message_text,
      detected_intent: classifyIntent(candidate.message_text, rule),
      lead_score: Math.max(score, candidate.intent_score ?? 0),
      lead_stage: Math.max(score, candidate.intent_score ?? 0) >= 60 ? "qualified" : "new",
      recommended_reply: candidate.recommended_reply,
      human_review_required: true,
      assigned_to: "",
      next_follow_up_at: null,
      last_contacted_at: null,
      contact_method: "unknown",
      lead_notes: ["Converted from X lead candidate. Manual follow-up required."],
      created_at: now,
      updated_at: now
    };
    leads.push(lead);
  }
  candidate.candidate_status = "manually_completed";
  candidate.updated_at = now;
  await writeClientArray(clientId, "leads.json", leads);
  await writeClientArray(clientId, "lead-candidates.json", candidates);
  if (shouldGenerateReply) {
    await createReplyDraftForLead(client, lead, account.account_id);
  }
}

async function updateXEngagementItem(body: { client_id: string; engagement_id: string; classification?: XEngagementItem["classification"]; action_status?: XEngagementItem["action_status"] }): Promise<void> {
  const inbox = await readClientArray<XEngagementItem>(body.client_id, "x-engagement-inbox.json");
  const item = inbox.find((entry) => entry.engagement_id === body.engagement_id);
  if (!item) throw new Error(`X engagement item ${body.engagement_id} not found`);
  if (body.classification) item.classification = body.classification;
  if (body.action_status) item.action_status = body.action_status;
  item.updated_at = new Date().toISOString();
  await writeClientArray(body.client_id, "x-engagement-inbox.json", inbox);
}

async function updateXLeadCandidate(body: { client_id: string; candidate_id: string; candidate_status: XLeadCandidate["candidate_status"] }): Promise<void> {
  const candidates = await readClientArray<XLeadCandidate>(body.client_id, "lead-candidates.json");
  const candidate = candidates.find((item) => item.candidate_id === body.candidate_id);
  if (!candidate) throw new Error(`X lead candidate ${body.candidate_id} not found`);
  candidate.candidate_status = body.candidate_status;
  candidate.updated_at = new Date().toISOString();
  await writeClientArray(body.client_id, "lead-candidates.json", candidates);
}

async function convertXEngagementToLead(clientId: string, engagementId: string, shouldGenerateReply: boolean): Promise<void> {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const category = getCategory(client.industry);
  const rule = (await readLeadScoringRules())[client.industry];
  const inbox = await readClientArray<XEngagementItem>(clientId, "x-engagement-inbox.json");
  const item = inbox.find((entry) => entry.engagement_id === engagementId);
  if (!item) throw new Error(`X engagement item ${engagementId} not found`);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const now = new Date().toISOString();
  let lead = leads.find((entry) => entry.source_post_id === item.source_id && entry.user_handle === item.username);
  if (!lead) {
    const score = scoreLead(item.text, category, rule);
    lead = {
      lead_id: makeId("lead"),
      client_id: clientId,
      platform: "x",
      account_id: item.account_id,
      source_type: item.source_type === "dm" ? "dm" : "comment",
      source_mode: "manual",
      source_post_id: item.source_id,
      source_url: item.source_url,
      user_handle: item.username,
      user_display_name: item.username,
      message_text: item.text,
      detected_intent: classifyIntent(item.text, rule),
      lead_score: Math.max(score, item.lead_score ?? 0),
      lead_stage: Math.max(score, item.lead_score ?? 0) >= 60 ? "qualified" : "new",
      recommended_reply: "Review this X interaction and reply manually if appropriate.",
      human_review_required: true,
      assigned_to: "",
      next_follow_up_at: null,
      last_contacted_at: null,
      contact_method: item.source_type === "dm" ? "dm" : "comment",
      lead_notes: ["Created from X engagement inbox. Manual reply only."],
      created_at: now,
      updated_at: now
    };
    leads.push(lead);
    await writeClientArray(clientId, "leads.json", leads);
  }
  if (shouldGenerateReply) {
    await createReplyDraftForLead(client, lead, item.account_id);
  }
  item.action_status = "manually_completed";
  item.updated_at = now;
  await writeClientArray(clientId, "x-engagement-inbox.json", inbox);
}

async function createReplyDraftForLead(client: Client, lead: Lead, accountId: string): Promise<void> {
  const drafts = await readClientArray<ReplyDraft>(client.client_id, "reply-drafts.json");
  if (drafts.some((draft) => draft.lead_id === lead.lead_id && draft.platform === "x")) return;
  const now = new Date().toISOString();
  drafts.push({
    reply_draft_id: makeId("reply"),
    lead_id: lead.lead_id,
    client_id: client.client_id,
    platform: "x",
    account_id: accountId,
    draft_text: generateReplyDraft(client, lead),
    tone: client.brand_tone,
    approval_status: "draft",
    rejection_reason: null,
    sent_status: "not_sent",
    created_at: now,
    updated_at: now
  });
  await writeClientArray(client.client_id, "reply-drafts.json", drafts);
}

async function readSafeClientArray<T>(clientId: string, fileName: string, errors: Array<{ file: string; message: string }>): Promise<T[]> {
  try {
    return await readClientArray<T>(clientId, fileName);
  } catch (error) {
    errors.push({ file: fileName, message: error instanceof Error ? error.message : "Malformed JSON" });
    return [];
  }
}

function buildXBudgetSummary(client: Client, usage: XApiUsageEntry[]) {
  const month = new Date().toISOString().slice(0, 7);
  const budget = Number(client.monthly_api_budget ?? 0);
  const used = usage
    .filter((entry) => entry.timestamp?.startsWith(month))
    .reduce((total, entry) => total + Number(entry.cost_units || 0), 0);
  return {
    month,
    monthly_api_budget: budget,
    budget_warn_at: Number(client.budget_warn_at ?? 0),
    budget_block_at: Number(client.budget_block_at ?? 0),
    max_cost_per_command: Number(client.max_cost_per_command ?? 0),
    default_x_search_limit: Number(client.default_x_search_limit ?? 0),
    default_kol_discovery_limit: Number(client.default_kol_discovery_limit ?? 0),
    budget_used: used,
    budget_remaining: budget > 0 ? Math.max(0, budget - used) : null
  };
}

async function readXReports(clientId: string, errors: Array<{ file: string; message: string }>): Promise<Array<Record<string, unknown>>> {
  const dir = join(clientDir(clientId), "reports", "x");
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort().reverse();
    const reports = [];
    for (const file of files.slice(0, 10)) {
      try {
        reports.push(await readJson<Record<string, unknown>>(join(dir, file), {}));
      } catch (error) {
        errors.push({ file: `reports/x/${file}`, message: error instanceof Error ? error.message : "Malformed JSON" });
      }
    }
    return reports;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
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

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const safePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]/, "");
  const filePath = join(publicDir, safePath);
  const content = await readFile(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  res.end(content);
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function makeId(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
}

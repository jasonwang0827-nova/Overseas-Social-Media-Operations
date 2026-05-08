import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Client, ContentAsset, Lead, PlatformAccount, PlatformVariant, PublishRecord, PublishTask, ReplyDraft } from "../../packages/core/types.js";
import { assertVariantApproved } from "../../packages/core/approval.js";
import { categories, getCategory } from "../../packages/core/category.js";
import { classifyIntent } from "../../packages/lead-intelligence/classifyIntent.js";
import { generateReplyDraft } from "../../packages/lead-intelligence/generateReplyDraft.js";
import { scoreLead } from "../../packages/lead-intelligence/scoreLead.js";
import { createMockPublisher } from "../../packages/publishers/mockPublisher.js";
import { clientDir, clientFile, dataRoot, ensureClientDirectories, readClientArray, readJson, writeClientArray, writeJson } from "../../packages/storage/jsonStore.js";

const port = Number(process.env.PORT ?? 4321);
const publicDir = join(process.cwd(), "apps", "web", "public");

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

  if (req.method === "POST" && url.pathname === "/api/content/approve") {
    const body = await readBody<{ client_id: string; content_id: string }>(req);
    const contents = await readClientArray<ContentAsset>(body.client_id, "content-pool.json");
    const content = contents.find((item) => item.content_id === body.content_id);
    if (!content) throw new Error(`Content ${body.content_id} not found`);
    content.status = "approved";
    content.approved_by_human = true;
    await writeClientArray(body.client_id, "content-pool.json", contents);
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

  if (req.method === "POST" && url.pathname === "/api/lead/import") {
    const body = await readBody<{ client_id: string; message_text: string; platform?: string; account_id?: string }>(req);
    await importLead(body.client_id, body.message_text, body.platform, body.account_id);
    sendJson(res, 200, await loadState(body.client_id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lead/score") {
    const body = await readBody<{ client_id: string }>(req);
    await scoreLeads(body.client_id);
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

  sendJson(res, 404, { error: "API route not found" });
}

async function loadState(clientId: string) {
  const client = await readJson<Client | null>(clientFile(clientId, "client.json"), null);
  if (!client) throw new Error(`Client ${clientId} not found. Run npm run demo:seed first.`);

  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");

  return {
    clients: await listClients(),
    categories,
    client,
    accounts,
    contents,
    variants,
    queue,
    records,
    leads,
    drafts,
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

async function runPublish(clientId: string): Promise<void> {
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const now = new Date();

  for (const task of queue) {
    if (task.status !== "scheduled" || new Date(task.scheduled_at) > now) continue;
    if (task.next_retry_at && new Date(task.next_retry_at) > now) continue;
    if (task.approval_status !== "approved") {
      task.status = "failed";
      task.error_message = "approval_status must be approved before publishing";
      task.last_error = task.error_message;
      continue;
    }
    if (task.platform === "youtube") {
      task.status = "failed";
      task.error_message = "YouTube is reserved for Phase 2";
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
    const result = await createMockPublisher(task.platform).publish(task, variant);
    if (result.ok) {
      task.status = "published";
      task.platform_post_id = result.platform_post_id;
      task.published_at = new Date().toISOString();
      task.error_message = null;
      task.last_error = null;
      task.next_retry_at = null;
      records.push({ ...task, record_id: makeId("record") });
    } else {
      registerPublishFailure(task, result.error_message ?? "Unknown publish error");
    }
  }

  await writeClientArray(clientId, "publish-queue.json", queue);
  await writeClientArray(clientId, "publish-records.json", records);
}

async function importLead(clientId: string, messageText: string, platform = "instagram", accountId?: string): Promise<void> {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const category = getCategory(client.industry);
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const fallbackAccount = accounts.find((account) => account.platform === platform);
  const score = scoreLead(messageText, category);
  const lead: Lead = {
    lead_id: makeId("lead"),
    client_id: clientId,
    platform: platform as Lead["platform"],
    account_id: accountId ?? fallbackAccount?.account_id ?? `${platform}_unknown`,
    source_type: "comment",
    source_post_id: "platform_post_mock",
    user_handle: "web_demo_lead",
    user_display_name: "Web Demo Lead",
    message_text: messageText,
    detected_intent: classifyIntent(messageText),
    lead_score: score,
    lead_stage: score === 0 ? "spam" : score >= 60 ? "qualified" : "new",
    recommended_reply: "",
    human_review_required: true,
    assigned_to: "jason",
    next_follow_up_at: null,
    last_contacted_at: null,
    contact_method: "unknown",
    lead_notes: [],
    created_at: new Date().toISOString()
  };
  lead.recommended_reply = generateReplyDraft(client, lead);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  leads.push(lead);
  await writeClientArray(clientId, "leads.json", leads);
  await upsertDraft(clientId, lead);
}

async function scoreLeads(clientId: string): Promise<void> {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const category = getCategory(client.industry);
  const leads = await readClientArray<Lead>(clientId, "leads.json");
  for (const lead of leads) {
    lead.detected_intent = classifyIntent(lead.message_text);
    lead.lead_score = scoreLead(lead.message_text, category);
    lead.lead_stage = lead.lead_score === 0 ? "spam" : lead.lead_score >= 60 ? "qualified" : lead.lead_stage;
    lead.recommended_reply = generateReplyDraft(client, lead);
    await upsertDraft(clientId, lead);
  }
  await writeClientArray(clientId, "leads.json", leads);
}

async function upsertDraft(clientId: string, lead: Lead): Promise<void> {
  const drafts = await readClientArray<ReplyDraft>(clientId, "reply-drafts.json");
  const existing = drafts.find((draft) => draft.lead_id === lead.lead_id);
  if (existing) {
    existing.draft_text = lead.recommended_reply;
  } else {
    drafts.push({
      reply_draft_id: makeId("reply"),
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

async function writeDailyReport(clientId: string): Promise<void> {
  const state = await loadState(clientId);
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    client_id: clientId,
    date,
    publish_count: state.records.filter((record) => record.published_at?.startsWith(date)).length,
    failed_tasks: state.queue.filter((task) => task.status === "failed"),
    interaction_count: state.leads.filter((lead) => lead.created_at.startsWith(date)).length,
    new_leads: state.leads.filter((lead) => lead.created_at.startsWith(date) && lead.lead_stage === "new").length,
    high_score_leads: state.leads.filter((lead) => lead.lead_score >= 70),
    human_follow_up_required: state.leads.filter((lead) => lead.human_review_required && lead.lead_stage !== "spam"),
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
  const inRange = (value: string | null): boolean => Boolean(value && value >= `${weekStart}T00:00:00` && value <= `${weekEnd}T23:59:59`);
  const weeklyLeads = state.leads.filter((lead) => inRange(lead.created_at));
  const weeklyRecords = state.records.filter((record) => inRange(record.published_at));
  const report = {
    client_id: clientId,
    week_start: weekStart,
    week_end: weekEnd,
    published_count: weeklyRecords.length,
    platform_publish_status: state.queue.reduce<Record<string, Record<string, number>>>((acc, task) => {
      acc[task.platform] ??= {};
      acc[task.platform][task.status] = (acc[task.platform][task.status] ?? 0) + 1;
      return acc;
    }, {}),
    failed_tasks: state.queue.filter((task) => task.status === "failed"),
    retry_pending_tasks: state.queue.filter((task) => task.next_retry_at),
    new_leads: weeklyLeads.length,
    high_value_leads: weeklyLeads.filter((lead) => lead.lead_score >= 70),
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

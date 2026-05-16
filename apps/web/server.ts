import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import type { AccountRole, Client, ContentAngle, ContentAsset, ContentFocus, ContentTheme, Lead, Platform, PlatformAccount, PlatformCapabilities, PlatformVariant, PublishAuditEntry, PublishRecord, PublishTask, ReplyDraft, XEngagementItem, XKolProspect, XLeadCandidate, XQueryHistoryEntry, XResearchPost } from "../../packages/core/types.js";
import { assertContentApproved, assertVariantApproved } from "../../packages/core/approval.js";
import { categories, getCategory } from "../../packages/core/category.js";
import { classifyIntent } from "../../packages/lead-intelligence/classifyIntent.js";
import { generateReplyDraft } from "../../packages/lead-intelligence/generateReplyDraft.js";
import { scoreLead, type LeadScoringRule } from "../../packages/lead-intelligence/scoreLead.js";
import {
  buildMetaDryRunPreview,
  checkMetaAccount,
  facebookGraphGet,
  facebookGraphPost,
  instagramGraphGet,
  instagramGraphPost,
  loadFacebookGraphConfig,
  loadInstagramGraphConfig,
  loadMetaEnv,
  publishInstagramMedia,
  readMetaFoundationConfig,
  sendFacebookPageMessage,
  sendInstagramDm
} from "../../packages/publishers/meta/index.js";
import { createMockPublisher } from "../../packages/publishers/mockPublisher.js";
import { checkXAccountAuth } from "../../packages/publishers/x/accountAuth.js";
import { xPublisher } from "../../packages/publishers/x/index.js";
import { buildXOAuthAuthorizeUrl, completeXOAuthCallback } from "../../packages/publishers/x/oauth.js";
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
interface MetaLiveActionRequest {
  client_id: string;
  account_id: string;
  action:
    | "ig_account_check"
    | "ig_publish_image"
    | "ig_publish_video"
    | "ig_comments_list"
    | "ig_comment_reply"
    | "ig_private_reply"
    | "ig_dm_send"
    | "ig_like"
    | "fb_account_check"
    | "fb_publish_post"
    | "fb_publish_photo"
    | "fb_publish_video"
    | "fb_comments_list"
    | "fb_comment_reply"
    | "fb_private_reply"
    | "fb_dm_send"
    | "fb_like";
  confirm?: string;
  caption?: string;
  message?: string;
  image_url?: string;
  video_url?: string;
  media_type?: "VIDEO" | "REELS" | "STORIES";
  media_id?: string;
  comment_id?: string;
  object_id?: string;
  recipient_id?: string;
  link?: string;
  limit?: string;
}
interface R2Config {
  accountId: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}
const leadStages: Lead["lead_stage"][] = ["new", "qualified", "replied", "waiting_response", "booked", "converted", "not_interested", "spam"];
const leadSourceTypes: Lead["source_type"][] = ["comment", "dm", "form", "manual", "email", "whatsapp", "csv"];
const metaOAuthScopes = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish"
];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
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
  if (req.method === "GET" && url.pathname === "/auth/x/start") {
    const clientId = url.searchParams.get("client_id");
    const accountId = url.searchParams.get("account_id");
    if (!clientId || !accountId) throw new Error("client_id and account_id are required.");
    const authorizeUrl = await buildXOAuthAuthorizeUrl({ clientId, accountId });
    res.writeHead(302, { location: authorizeUrl });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/x/callback") {
    const error = url.searchParams.get("error");
    if (error) {
      sendHtml(res, 400, renderOAuthResultHtml("X OAuth failed", `X returned error: ${escapeHtml(error)}`));
      return;
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code) throw new Error("X OAuth callback requires state and code.");
    const result = await completeXOAuthCallback({ state, code }).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown X OAuth callback error.";
      sendHtml(res, 400, renderOAuthResultHtml("X OAuth account mismatch", escapeHtml(message)));
      return null;
    });
    if (!result) return;
    sendHtml(res, 200, renderOAuthResultHtml(
      "X account connected",
      `Connected @${escapeHtml(result.x_username)} to ${escapeHtml(result.account_id)}. You can close this page or return to Social Ops Hub.`,
      result.client_id
    ));
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/meta/start") {
    const clientId = url.searchParams.get("client_id");
    const accountId = url.searchParams.get("account_id");
    if (!clientId || !accountId) throw new Error("client_id and account_id are required.");
    const authorizeUrl = await buildMetaOAuthAuthorizeUrl(clientId, accountId);
    res.writeHead(302, { location: authorizeUrl });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/meta/callback") {
    const error = url.searchParams.get("error") || url.searchParams.get("error_message");
    if (error) {
      sendHtml(res, 400, renderOAuthResultHtml("Meta OAuth failed", `Meta returned error: ${escapeHtml(error)}`));
      return;
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code) throw new Error("Meta OAuth callback requires state and code.");
    const result = await completeMetaOAuthCallback(state, code).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown Meta OAuth callback error.";
      sendHtml(res, 400, renderOAuthResultHtml("Meta account binding failed", escapeHtml(message)));
      return null;
    });
    if (!result) return;
    sendHtml(res, 200, renderOAuthResultHtml(
      "Meta account connected",
      `Bound ${escapeHtml(result.account_id)} to Page ${escapeHtml(result.page_name)}${result.instagram_username ? ` / IG @${escapeHtml(result.instagram_username)}` : ""}. You can return to Social Ops Hub.`,
      result.client_id
    ));
    return;
  }

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

  if (req.method === "POST" && url.pathname === "/api/x/account/check") {
    const body = await readBody<{ client_id: string; account_id: string }>(req);
    await checkAndUpdateXAccount(body.client_id, body.account_id);
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

  if (req.method === "POST" && url.pathname === "/api/publish/manual-export") {
    const body = await readBody<{ client_id: string; variant_id: string; publish_task_id?: string }>(req);
    const result = await exportManualPublishPackage(body.client_id, body.variant_id, body.publish_task_id);
    sendJson(res, 200, { ...(await loadState(body.client_id)), publish_action_log: JSON.stringify(result, null, 2) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/publish/manual-complete") {
    const body = await readBody<{ client_id: string; publish_task_id: string; post_url: string }>(req);
    await markPublishTaskManualComplete(body.client_id, body.publish_task_id, body.post_url);
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

  if (req.method === "POST" && url.pathname === "/api/x/publish/dry-run-preview") {
    const body = await readBody<{ client_id: string; publish_task_id: string }>(req);
    const log = await buildXPublishDryRunPreview(body.client_id, body.publish_task_id);
    sendJson(res, 200, { ...(await loadState(body.client_id)), x_action_log: log });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/x/publish/manual-complete") {
    const body = await readBody<{ client_id: string; publish_task_id: string }>(req);
    await markXPublishTaskManualComplete(body.client_id, body.publish_task_id);
    sendJson(res, 200, await loadState(body.client_id));
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

  if (req.method === "POST" && url.pathname === "/api/meta/account/check") {
    const body = await readBody<{ client_id: string; account_id: string }>(req);
    const result = await checkAndUpdateMetaAccount(body.client_id, body.account_id);
    sendJson(res, 200, { ...(await loadState(body.client_id)), meta_action_log: JSON.stringify(result, null, 2) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/meta/publish/dry-run") {
    const body = await readBody<{ client_id: string; variant_id: string; publish_task_id?: string }>(req);
    const preview = await buildMetaPreviewForClient(body.client_id, body.variant_id, body.publish_task_id);
    sendJson(res, 200, { ...(await loadState(body.client_id)), meta_action_log: JSON.stringify(preview, null, 2) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/meta/live-action") {
    const body = await readBody<MetaLiveActionRequest>(req);
    const result = await runMetaLiveAction(body);
    sendJson(res, 200, { ...(await loadState(body.client_id)), meta_action_log: JSON.stringify(result, null, 2) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/media/r2-upload") {
    const upload = await uploadMultipartMediaToR2(req);
    sendJson(res, 200, upload);
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
  const audit = await readClientArray<PublishAuditEntry>(clientId, "publish-audit-log.json");
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
  const metaFoundation = await readMetaFoundationConfig();
  const metaEnv = await loadMetaEnv();

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
    x_account_auth: await buildXAccountAuthSummary(accounts),
    contents,
    variants,
    queue,
    records,
    leads,
    drafts,
    meta: {
      foundation: metaFoundation,
      env_status: buildMetaEnvStatus(metaFoundation, metaEnv),
      manual_exports: await readMetaManualExports(clientId)
    },
    operations: {
      manual_exports: await readManualExports(clientId),
      report_status: await readReportStatus(clientId)
    },
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
  x_binding?: PlatformAccount["x_binding"];
  meta_binding?: PlatformAccount["meta_binding"];
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
    x_binding: body.platform === "x" ? body.x_binding : undefined,
    meta_binding: ["facebook", "instagram"].includes(body.platform) ? body.meta_binding : undefined,
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
    x_binding: body.platform === "x" ? body.x_binding ?? account.x_binding : undefined,
    meta_binding: ["facebook", "instagram"].includes(body.platform) ? body.meta_binding ?? account.meta_binding : undefined,
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

async function checkAndUpdateXAccount(clientId: string, accountId: string): Promise<void> {
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = accounts.find((item) => item.account_id === accountId);
  if (!account) throw new Error(`Account ${accountId} not found.`);
  if (account.platform !== "x") throw new Error(`Account ${accountId} is not an X account.`);
  const auth = await checkXAccountAuth(account);
  account.x_binding = {
    ...(account.x_binding ?? {}),
    x_username: auth.x_username ?? account.x_binding?.x_username ?? account.account_name,
    token_ref: auth.token_ref,
    token_status: auth.token_status,
    scopes: auth.scopes,
    oauth_version: account.x_binding?.oauth_version ?? "2.0",
    last_checked_at: new Date().toISOString(),
    setup_status: auth.setup_status,
    setup_notes: auth.notes
  };
  account.auth_status = auth.token_status === "configured" ? "connected" : auth.token_status === "expired" ? "expired" : "disconnected";
  account.updated_at = new Date().toISOString();
  await writeClientArray(clientId, "accounts.json", accounts);
}

async function buildXAccountAuthSummary(accounts: PlatformAccount[]) {
  const result: Record<string, Awaited<ReturnType<typeof checkXAccountAuth>>> = {};
  for (const account of accounts.filter((item) => item.platform === "x")) {
    result[account.account_id] = await checkXAccountAuth(account);
  }
  return result;
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
    const dirents = await readdir(dataRoot, { withFileTypes: true });
    entries = dirents.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
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
  const audit = await readClientArray<PublishAuditEntry>(clientId, "publish-audit-log.json");
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
      audit.push(makePublishAuditEntry({
        event_type: "publish_blocked",
        task,
        variant,
        message: "Publish task blocked by readiness check.",
        reason: readiness.reason,
        status_before: "scheduled",
        source: "web"
      }));
      continue;
    }
    if (!variant) continue;
    const publisher = task.platform === "x" ? xPublisher : createMockPublisher(task.platform);
    audit.push(makePublishAuditEntry({
      event_type: "publish_attempt",
      task,
      variant,
      message: "Publish attempt started.",
      status_before: task.status,
      source: "web"
    }));
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
      audit.push(makePublishAuditEntry({
        event_type: "publish_success",
        task,
        variant,
        message: "Publish task completed and publish record appended.",
        status_before: "scheduled",
        status_after: task.status,
        platform_post_id: task.platform_post_id,
        post_url: recordUrl,
        publish_mode: result.publish_mode ?? (task.publish_method === "official_api" ? "api" : "mock"),
        source: "web"
      }));
    } else {
      registerPublishFailure(task, result.error_message ?? "Unknown publish error");
      audit.push(makePublishAuditEntry({
        event_type: "publish_failed",
        task,
        variant,
        message: "Publish task failed.",
        reason: task.last_error,
        status_before: "scheduled",
        status_after: task.status,
        source: "web"
      }));
    }
  }

  await writeClientArray(clientId, "publish-queue.json", queue);
  await writeClientArray(clientId, "publish-records.json", records);
  await writeClientArray(clientId, "publish-audit-log.json", audit);
}

async function buildXPublishDryRunPreview(clientId: string, taskId: string): Promise<string> {
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const rules = await readPublishRules();
  const capabilities = await readPlatformCapabilities();
  const task = findPublishTask(queue, taskId);
  if (task.platform !== "x") throw new Error("Dry-run preview is only available for X publish tasks.");
  const variant = variants.find((item) => item.variant_id === task.variant_id);
  const content = contents.find((item) => item.content_id === task.content_id);
  const account = accounts.find((item) => item.account_id === task.account_id);
  const readiness = await checkPublishReadiness({ content, variant, account, queue, task, rules, capabilities, currentTaskId: task.publish_task_id });
  await appendPublishAudit(clientId, makePublishAuditEntry({
    event_type: "dry_run_preview",
    task,
    variant,
    message: "X dry-run preview generated. No live API call was made.",
    reason: readiness.ready ? null : readiness.reason,
    publish_mode: "dry_run",
    source: "web"
  }));
  const lines = [
    "X publish dry-run preview only. No live API call was made.",
    `task: ${task.publish_task_id}`,
    `account: ${task.account_id}`,
    `scheduled_at: ${task.scheduled_at}`,
    `publish_method: ${task.publish_method}`,
    `readiness: ${readiness.ready ? "ready" : "blocked"}`,
    readiness.ready ? "" : `blocked_reason: ${readiness.reason}`,
    "",
    "caption:",
    variant?.caption ?? "(variant not found)",
    "",
    "cta:",
    variant?.cta ?? "",
    "",
    "hashtags:",
    (variant?.hashtags ?? []).join(" ")
  ];
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
}

async function checkAndUpdateMetaAccount(clientId: string, accountId: string) {
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = accounts.find((item) => item.account_id === accountId);
  if (!account) throw new Error(`Account ${accountId} not found.`);
  const result = await checkMetaAccount(account, "dry_run");
  account.meta_binding = {
    ...(account.meta_binding ?? {}),
    setup_status: result.ok ? "ready_for_dry_run" : "needs_meta_setup",
    last_checked_at: new Date().toISOString(),
    setup_notes: [...result.warnings, ...result.next_steps]
  };
  await writeClientArray(clientId, "accounts.json", accounts);
  return result;
}

async function buildMetaPreviewForClient(clientId: string, variantId: string, taskId?: string) {
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) throw new Error(`Variant ${variantId} not found.`);
  const account = accounts.find((item) => item.account_id === variant.account_id);
  if (!account) throw new Error(`Account ${variant.account_id} not found.`);
  const task = taskId
    ? queue.find((item) => item.publish_task_id === taskId)
    : queue.find((item) => item.variant_id === variant.variant_id);
  const preview = await buildMetaDryRunPreview({ account, variant, task });
  await appendPublishAudit(clientId, makePublishAuditEntry({
    event_type: "meta_dry_run_preview",
    task,
    variant,
    message: "Meta dry-run preview generated. No Meta Graph API request was made.",
    reason: preview.warnings.join(" | ") || null,
    publish_method: "dry_run",
    publish_mode: "dry_run",
    source: "web",
    metadata: {
      endpoint_preview: preview.endpoint_preview,
      payload_preview: preview.payload_preview
    }
  }));
  return preview;
}

async function runMetaLiveAction(body: MetaLiveActionRequest): Promise<Record<string, unknown>> {
  if (!body.client_id || !body.account_id) throw new Error("client_id and account_id are required.");
  const accounts = await readClientArray<PlatformAccount>(body.client_id, "accounts.json");
  const account = findAccount(accounts, body.account_id);
  const isWrite = !body.action.endsWith("_account_check") && !body.action.endsWith("_comments_list");
  if (isWrite && body.confirm !== "LIVE") throw new Error("Live Meta write action requires typing LIVE in the confirm field.");
  if (account.status !== "active") throw new Error(`Account ${account.account_id} is not active.`);
  if (isWrite && !account.posting_enabled) throw new Error(`Account ${account.account_id} has posting disabled.`);

  if (body.action.startsWith("ig_")) {
    if (account.platform !== "instagram") throw new Error(`Account ${account.account_id} is ${account.platform}, not instagram.`);
    const config = await loadInstagramGraphConfig(account);
    if (!config.accessToken) throw new Error("Meta access token missing. Configure MetaAPI.env first.");
    let result: Record<string, unknown>;
    let platformPostId: string | null = null;
    switch (body.action) {
      case "ig_account_check":
        if (!config.igUserId) throw new Error("Instagram business account id missing.");
        result = await instagramGraphGet(`/${config.igUserId}`, { fields: "id,username,name,profile_picture_url" }, config.accessToken);
        break;
      case "ig_publish_image": {
        if (!config.igUserId) throw new Error("Instagram business account id missing.");
        const published = await publishInstagramMedia({ igUserId: config.igUserId, imageUrl: required(body.image_url, "image_url"), caption: body.caption ?? "" }, config.accessToken);
        platformPostId = published.media_id;
        result = published;
        break;
      }
      case "ig_publish_video": {
        if (!config.igUserId) throw new Error("Instagram business account id missing.");
        const mediaType = body.media_type ?? "REELS";
        const published = await publishInstagramMedia({ igUserId: config.igUserId, videoUrl: required(body.video_url, "video_url"), caption: body.caption ?? "", mediaType }, config.accessToken);
        platformPostId = published.media_id;
        result = published;
        break;
      }
      case "ig_comments_list":
        result = await instagramGraphGet(`/${required(body.media_id, "media_id")}/comments`, {
          fields: "id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}",
          limit: body.limit || "50"
        }, config.accessToken);
        break;
      case "ig_comment_reply":
        result = await instagramGraphPost(`/${required(body.comment_id, "comment_id")}/replies`, { message: required(body.message, "message") }, config.accessToken);
        break;
      case "ig_private_reply":
        result = await instagramGraphPost(`/${required(body.comment_id, "comment_id")}/private_replies`, { message: required(body.message, "message") }, config.accessToken);
        break;
      case "ig_dm_send":
        if (!config.pageId) throw new Error("Connected Facebook Page id missing.");
        result = await sendInstagramDm(config.pageId, required(body.recipient_id, "recipient_id"), required(body.message, "message"), config.pageAccessToken);
        break;
      case "ig_like":
        result = await instagramGraphPost(`/${required(body.object_id, "object_id")}/likes`, {}, config.accessToken);
        break;
      default:
        throw new Error(`Unsupported Instagram action: ${body.action}`);
    }
    if (isWrite) await appendMetaLiveAudit(body.client_id, account, body.action, result, platformPostId);
    return { ok: true, action: body.action, account_id: account.account_id, result };
  }

  if (body.action.startsWith("fb_")) {
    if (account.platform !== "facebook") throw new Error(`Account ${account.account_id} is ${account.platform}, not facebook.`);
    const config = await loadFacebookGraphConfig(account);
    if (!config.pageAccessToken) throw new Error("Meta Page access token missing. Configure MetaAPI.env first.");
    if (!config.pageId) throw new Error("Facebook Page id missing.");
    let result: Record<string, unknown>;
    let platformPostId: string | null = null;
    switch (body.action) {
      case "fb_account_check":
        result = await facebookGraphGet(`/${config.pageId}`, { fields: "id,name,link,fan_count,followers_count" }, config.pageAccessToken);
        break;
      case "fb_publish_post":
        result = await facebookGraphPost(`/${config.pageId}/feed`, { message: required(body.message, "message"), link: body.link || undefined }, config.pageAccessToken);
        platformPostId = typeof result.id === "string" ? result.id : null;
        break;
      case "fb_publish_photo":
        result = await facebookGraphPost(`/${config.pageId}/photos`, { url: required(body.image_url, "image_url"), caption: body.caption ?? "" }, config.pageAccessToken);
        platformPostId = typeof result.post_id === "string" ? result.post_id : typeof result.id === "string" ? result.id : null;
        break;
      case "fb_publish_video":
        result = await facebookGraphPost(`/${config.pageId}/videos`, { file_url: required(body.video_url, "video_url"), description: body.message ?? body.caption ?? "" }, config.pageAccessToken);
        platformPostId = typeof result.id === "string" ? result.id : null;
        break;
      case "fb_comments_list":
        result = await facebookGraphGet(`/${required(body.object_id, "object_id")}/comments`, {
          fields: "id,message,from,created_time,like_count,comment_count,attachment,comments{id,message,from,created_time,like_count}",
          limit: body.limit || "50"
        }, config.pageAccessToken);
        break;
      case "fb_comment_reply":
        result = await facebookGraphPost(`/${required(body.comment_id, "comment_id")}/comments`, { message: required(body.message, "message") }, config.pageAccessToken);
        break;
      case "fb_private_reply":
        result = await facebookGraphPost(`/${required(body.comment_id, "comment_id")}/private_replies`, { message: required(body.message, "message") }, config.pageAccessToken);
        break;
      case "fb_dm_send":
        result = await sendFacebookPageMessage(config.pageId, required(body.recipient_id, "recipient_id"), required(body.message, "message"), config.pageAccessToken);
        break;
      case "fb_like":
        result = await facebookGraphPost(`/${required(body.object_id, "object_id")}/likes`, {}, config.pageAccessToken);
        break;
      default:
        throw new Error(`Unsupported Facebook action: ${body.action}`);
    }
    if (isWrite) await appendMetaLiveAudit(body.client_id, account, body.action, result, platformPostId);
    return { ok: true, action: body.action, account_id: account.account_id, result };
  }

  throw new Error(`Unsupported Meta action: ${body.action}`);
}

async function buildMetaOAuthAuthorizeUrl(clientId: string, accountId: string): Promise<string> {
  const env = await loadMetaEnv();
  if (!env.META_APP_ID) throw new Error("META_APP_ID is missing in MetaAPI.env.");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const account = findAccount(accounts, accountId);
  if (account.platform !== "facebook" && account.platform !== "instagram") {
    throw new Error(`Account ${accountId} is ${account.platform}, not a Meta account.`);
  }
  const redirectUri = env.META_REDIRECT_URI || "http://localhost:4321/auth/meta/callback";
  const state = randomBytes(32).toString("base64url");
  await writeMetaOAuthState({
    state,
    client_id: clientId,
    account_id: accountId,
    redirect_uri: redirectUri,
    scopes: metaOAuthScopes,
    created_at: new Date().toISOString()
  });
  const version = env.META_GRAPH_API_VERSION || "v25.0";
  const authUrl = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  authUrl.searchParams.set("client_id", env.META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", metaOAuthScopes.join(","));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("auth_type", "rerequest");
  return authUrl.toString();
}

async function completeMetaOAuthCallback(stateValue: string, code: string): Promise<{ client_id: string; account_id: string; page_name: string; instagram_username: string | null }> {
  const env = await loadMetaEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) throw new Error("META_APP_ID and META_APP_SECRET are required in MetaAPI.env.");
  const oauthState = await readMetaOAuthState(stateValue);
  assertFreshMetaState(oauthState);
  const version = env.META_GRAPH_API_VERSION || "v25.0";
  const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", env.META_APP_ID);
  tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", oauthState.redirect_uri);
  tokenUrl.searchParams.set("code", code);
  const tokenResponse = await fetch(tokenUrl);
  const tokenJson = await parseMetaJson(tokenResponse, "Meta OAuth token exchange");
  const userAccessToken = stringField(tokenJson, "access_token");
  if (!userAccessToken) throw new Error("Meta OAuth token response did not include access_token.");

  const pagesUrl = new URL(`https://graph.facebook.com/${version}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account{id,username,name}");
  pagesUrl.searchParams.set("access_token", userAccessToken);
  const pagesResponse = await fetch(pagesUrl);
  const pagesJson = await parseMetaJson(pagesResponse, "Meta /me/accounts");
  const pages = Array.isArray(pagesJson.data) ? pagesJson.data as Array<Record<string, unknown>> : [];
  if (!pages.length) throw new Error("Meta returned no Pages. Confirm the Facebook user has access to the Page and granted pages_show_list.");

  const accounts = await readClientArray<PlatformAccount>(oauthState.client_id, "accounts.json");
  const account = findAccount(accounts, oauthState.account_id);
  const selected = selectMetaPageForAccount(account, pages);
  const pageId = required(stringField(selected, "id") ?? undefined, "page_id");
  const pageName = stringField(selected, "name") || pageId;
  const pageAccessToken = stringField(selected, "access_token") || userAccessToken;
  const ig = selected.instagram_business_account as Record<string, unknown> | undefined;
  const igId = ig ? stringField(ig, "id") : null;
  const igUsername = ig ? stringField(ig, "username") || stringField(ig, "name") : null;
  if (account.platform === "instagram" && !igId) throw new Error(`Selected Page ${pageName} does not expose instagram_business_account. Confirm the IG professional account is linked to this Page.`);

  const tokenRef = `meta_${oauthState.client_id}_${oauthState.account_id}`;
  await mkdir(join(process.cwd(), "data", "token-vault", "meta"), { recursive: true });
  await writeFile(join(process.cwd(), "data", "token-vault", "meta", `${tokenRef}.json`), `${JSON.stringify({
    token_ref: tokenRef,
    client_id: oauthState.client_id,
    account_id: oauthState.account_id,
    platform: account.platform,
    access_token: userAccessToken,
    page_access_token: pageAccessToken,
    page_id: pageId,
    page_name: pageName,
    instagram_business_account_id: igId,
    instagram_username: igUsername,
    scopes: oauthState.scopes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, null, 2)}\n`, "utf8");

  account.auth_status = "connected";
  account.account_name = account.platform === "instagram" && igUsername ? igUsername : pageName;
  account.display_name = account.platform === "instagram" && igUsername ? igUsername : pageName;
  account.account_url = account.platform === "instagram" && igUsername ? `https://instagram.com/${igUsername}` : `https://www.facebook.com/${pageId}`;
  account.meta_binding = {
    ...(account.meta_binding ?? {}),
    meta_app_id: env.META_APP_ID,
    page_id: account.platform === "facebook" ? pageId : account.meta_binding?.page_id ?? pageId,
    page_name: account.platform === "facebook" ? pageName : account.meta_binding?.page_name ?? pageName,
    instagram_business_account_id: account.platform === "instagram" ? igId ?? undefined : account.meta_binding?.instagram_business_account_id,
    instagram_username: account.platform === "instagram" ? igUsername ?? undefined : account.meta_binding?.instagram_username,
    connected_facebook_page_id: account.platform === "instagram" ? pageId : account.meta_binding?.connected_facebook_page_id ?? undefined,
    connected_facebook_page_name: account.platform === "instagram" ? pageName : account.meta_binding?.connected_facebook_page_name ?? undefined,
    token_ref: tokenRef,
    token_status: "configured",
    permissions: oauthState.scopes,
    setup_status: "ready_for_api",
    last_checked_at: new Date().toISOString(),
    setup_notes: [`Connected through Meta OAuth. Page: ${pageName}${igUsername ? `, IG: @${igUsername}` : ""}.`]
  };
  account.updated_at = new Date().toISOString();
  await writeClientArray(oauthState.client_id, "accounts.json", accounts);
  return { client_id: oauthState.client_id, account_id: oauthState.account_id, page_name: pageName, instagram_username: igUsername };
}

function selectMetaPageForAccount(account: PlatformAccount, pages: Array<Record<string, unknown>>): Record<string, unknown> {
  const binding = account.meta_binding ?? {};
  if (account.platform === "facebook") {
    return pages.find((page) => stringField(page, "id") === binding.page_id)
      || pages.find((page) => normalizeName(stringField(page, "name")) === normalizeName(account.account_name))
      || pages[0];
  }
  return pages.find((page) => {
    const ig = page.instagram_business_account as Record<string, unknown> | undefined;
    return ig && stringField(ig, "id") === binding.instagram_business_account_id;
  }) || pages.find((page) => {
    const ig = page.instagram_business_account as Record<string, unknown> | undefined;
    return ig && normalizeName(stringField(ig, "username")) === normalizeName(account.account_name);
  }) || pages.find((page) => Boolean(page.instagram_business_account)) || pages[0];
}

async function writeMetaOAuthState(state: { state: string; client_id: string; account_id: string; redirect_uri: string; scopes: string[]; created_at: string }): Promise<void> {
  await mkdir(join(process.cwd(), "data", "token-vault", "meta", "oauth-states"), { recursive: true });
  await writeFile(metaStatePath(state.state), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readMetaOAuthState(state: string): Promise<{ state: string; client_id: string; account_id: string; redirect_uri: string; scopes: string[]; created_at: string }> {
  return JSON.parse(await readFile(metaStatePath(state), "utf8")) as { state: string; client_id: string; account_id: string; redirect_uri: string; scopes: string[]; created_at: string };
}

function metaStatePath(state: string): string {
  return join(process.cwd(), "data", "token-vault", "meta", "oauth-states", `${state.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`);
}

function assertFreshMetaState(state: { created_at: string }): void {
  const ageMs = Date.now() - Date.parse(state.created_at);
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) throw new Error("Meta OAuth state expired. Start the connect flow again.");
}

async function parseMetaJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) json = parsed as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${JSON.stringify(json).slice(0, 800) || text.slice(0, 800)}`);
  return json;
}

function stringField(obj: Record<string, unknown>, field: string): string | null {
  const value = obj[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().replace(/^@/, "").toLowerCase();
}

async function appendMetaLiveAudit(clientId: string, account: PlatformAccount, action: string, result: Record<string, unknown>, platformPostId: string | null): Promise<void> {
  await appendPublishAudit(clientId, {
    audit_id: makeId("audit"),
    timestamp: new Date().toISOString(),
    event_type: "automation_success",
    client_id: clientId,
    publish_task_id: null,
    content_id: null,
    variant_id: null,
    platform: account.platform,
    account_id: account.account_id,
    publish_method: "official_api",
    publish_mode: "api",
    status_before: null,
    status_after: "published",
    platform_post_id: platformPostId,
    post_url: null,
    message: `Meta live action completed: ${action}`,
    reason: null,
    actor: "operator",
    source: "web",
    metadata: {
      automation_action: action,
      account_id: account.account_id,
      platform: account.platform,
      result
    }
  });
}

function required(value: string | undefined, field: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

async function uploadMultipartMediaToR2(req: IncomingMessage): Promise<{ ok: true; url: string; key: string; content_type: string; size: number }> {
  const parsed = await readMultipartForm(req);
  const clientId = sanitizeKeyPart(parsed.fields.client_id || "client");
  const platform = sanitizeKeyPart(parsed.fields.platform || "meta");
  const file = parsed.files.file;
  if (!file) throw new Error("Upload requires a file field.");
  if (!file.content.length) throw new Error("Uploaded file is empty.");
  if (file.content.length > 100 * 1024 * 1024) throw new Error("Uploaded file is too large. Limit is 100MB.");
  const config = await loadR2Config();
  const ext = inferFileExtension(file.filename, file.contentType);
  const key = `uploads/${clientId}/${platform}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
  await putR2Object(config, key, file.content, file.contentType);
  return {
    ok: true,
    url: `${config.publicBaseUrl.replace(/\/+$/, "")}/${key}`,
    key,
    content_type: file.contentType,
    size: file.content.length
  };
}

async function loadR2Config(): Promise<R2Config> {
  const values = {
    ...(await readLocalEnvPath(join(dirname(process.cwd()), "R2API.env"))),
    ...(await readLocalEnvFile("R2API.env")),
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  };
  const config = {
    accountId: required(values.R2_ACCOUNT_ID, "R2_ACCOUNT_ID"),
    endpoint: required(values.R2_S3_ENDPOINT, "R2_S3_ENDPOINT").replace(/\/+$/, ""),
    bucket: required(values.R2_BUCKET, "R2_BUCKET"),
    accessKeyId: required(values.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(values.R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY"),
    publicBaseUrl: required(values.R2_PUBLIC_BASE_URL, "R2_PUBLIC_BASE_URL")
  };
  return config;
}

async function putR2Object(config: R2Config, key: string, body: Buffer, contentType: string): Promise<void> {
  const endpoint = new URL(config.endpoint);
  const host = endpoint.host;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const path = `/${encodeURIComponent(config.bucket)}/${encodedKey}`;
  const url = `${endpoint.protocol}//${host}${path}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = ["PUT", path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = getAwsSigningKey(config.secretAccessKey, dateStamp, "auto", "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      authorization
    },
    body: new Uint8Array(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`R2 upload failed (${response.status}): ${text.slice(0, 800)}`);
  }
}

function getAwsSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readLocalEnvFile(fileName: string): Promise<Record<string, string>> {
  return readLocalEnvPath(join(process.cwd(), fileName));
}

async function readLocalEnvPath(filePath: string): Promise<Record<string, string>> {
  try {
    return parseLocalEnv(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function parseLocalEnv(raw: string): Record<string, string> {
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

async function readMultipartForm(req: IncomingMessage): Promise<{ fields: Record<string, string>; files: Record<string, { filename: string; contentType: string; content: Buffer }> }> {
  const contentType = req.headers["content-type"] || "";
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("Expected multipart/form-data upload.");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const fields: Record<string, string> = {};
  const files: Record<string, { filename: string; contentType: string; content: Buffer }> = {};
  let start = body.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (body[start] === 45 && body[start + 1] === 45) break;
    if (body[start] === 13 && body[start + 1] === 10) start += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;
    const headerText = body.slice(start, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    let content = body.slice(headerEnd + 4, nextBoundary);
    if (content.length >= 2 && content[content.length - 2] === 13 && content[content.length - 1] === 10) content = content.slice(0, -2);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const partContentType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "application/octet-stream";
    if (name && filename !== undefined) files[name] = { filename, contentType: partContentType, content };
    else if (name) fields[name] = content.toString("utf8");
    start = nextBoundary;
  }
  return { fields, files };
}

function sanitizeKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function inferFileExtension(filename: string, contentType: string): string {
  const existing = extname(filename).toLowerCase();
  if (existing && existing.length <= 8) return existing;
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "video/mp4") return ".mp4";
  if (contentType === "video/quicktime") return ".mov";
  return "";
}

function findAccount(accounts: PlatformAccount[], accountId: string): PlatformAccount {
  const account = accounts.find((item) => item.account_id === accountId);
  if (!account) throw new Error(`Account ${accountId} not found.`);
  return account;
}

async function exportManualPublishPackage(clientId: string, variantId: string, taskId?: string) {
  const client = await readJson<Client>(clientFile(clientId, "client.json"), null as unknown as Client);
  const contents = await readClientArray<ContentAsset>(clientId, "content-pool.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const accounts = await readClientArray<PlatformAccount>(clientId, "accounts.json");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const variant = variants.find((item) => item.variant_id === variantId);
  if (!variant) throw new Error(`Variant ${variantId} not found.`);
  const content = contents.find((item) => item.content_id === variant.content_id);
  if (!content) throw new Error(`Content ${variant.content_id} not found.`);
  const account = accounts.find((item) => item.account_id === variant.account_id);
  if (!account) throw new Error(`Account ${variant.account_id} not found.`);
  assertContentApproved(content);
  assertVariantApproved(variant);
  if (account.status !== "active") throw new Error(`Account ${account.account_id} is not active.`);
  if (!account.posting_enabled) throw new Error(`Account ${account.account_id} has posting_enabled=false.`);
  const task = taskId
    ? queue.find((item) => item.publish_task_id === taskId)
    : queue.find((item) => item.variant_id === variant.variant_id && item.status !== "cancelled");
  const now = new Date().toISOString();
  const exportDir = join(clientDir(clientId), "exports", variant.platform);
  await mkdir(exportDir, { recursive: true });
  const baseName = `manual-publish-${variant.platform}-${variant.variant_id}`;
  const jsonPath = join(exportDir, `${baseName}.json`);
  const mdPath = join(exportDir, `${baseName}.md`);
  const relativeJsonPath = `data/clients/${clientId}/exports/${variant.platform}/${baseName}.json`;
  const relativeMdPath = `data/clients/${clientId}/exports/${variant.platform}/${baseName}.md`;
  const packageData = {
    export_id: makeId("manual_export"),
    generated_at: now,
    mode: "manual_publish_export",
    safety_notice: "Manual package only. No platform API request was made.",
    client: {
      client_id: client.client_id,
      client_name: client.client_name,
      industry: client.industry,
      region: client.region
    },
    account: {
      account_id: account.account_id,
      platform: account.platform,
      account_name: account.account_name,
      display_name: account.display_name,
      account_url: account.account_url,
      language: account.language,
      region: account.region,
      account_role: account.account_role,
      content_focus: account.content_focus,
      auth_status: account.auth_status,
      posting_enabled: account.posting_enabled
    },
    content: {
      content_id: content.content_id,
      title: content.title,
      content_theme: content.content_theme,
      content_angle: content.content_angle,
      funnel_stage: content.funnel_stage,
      approved_by_human: content.approved_by_human
    },
    variant: {
      variant_id: variant.variant_id,
      platform: variant.platform,
      format: variant.format,
      caption: variant.caption,
      hashtags: variant.hashtags,
      cta: variant.cta,
      media_path: variant.media_path,
      language: variant.language,
      approval_status: variant.approval_status,
      status: variant.status
    },
    publish_task: task ? {
      publish_task_id: task.publish_task_id,
      scheduled_at: task.scheduled_at,
      status: task.status,
      approval_status: task.approval_status
    } : null,
    manual_posting_checklist: [
      "Confirm client_id and client name.",
      "Confirm platform account and account URL.",
      "Copy caption exactly or adjust only with human approval.",
      "Copy hashtags and CTA.",
      "Upload media asset if media_path is provided.",
      "Publish manually on the native platform.",
      "Copy the final platform post URL.",
      "Paste post_url back into Social Ops Hub and mark manual complete."
    ],
    post_url_backfill_required: true
  };
  const markdown = [
    `# Manual Publish Package`,
    ``,
    `Generated: ${now}`,
    ``,
    `> Manual workflow only. No API request was made.`,
    ``,
    `## Client`,
    ``,
    `- Client: ${client.client_name} (${client.client_id})`,
    `- Industry: ${client.industry}`,
    `- Region: ${client.region}`,
    ``,
    `## Account`,
    ``,
    `- Platform: ${account.platform}`,
    `- Account: ${account.display_name || account.account_name} (${account.account_id})`,
    `- URL: ${account.account_url || "-"}`,
    `- Role: ${account.account_role}`,
    `- Focus: ${account.content_focus}`,
    ``,
    `## Content`,
    ``,
    `- Title: ${content.title}`,
    `- Theme: ${content.content_theme}`,
    `- Funnel stage: ${content.funnel_stage}`,
    `- Variant: ${variant.variant_id}`,
    `- Format: ${variant.format}`,
    ``,
    `## Caption`,
    ``,
    variant.caption,
    ``,
    `## Hashtags`,
    ``,
    variant.hashtags.join(" "),
    ``,
    `## CTA`,
    ``,
    variant.cta,
    ``,
    `## Media`,
    ``,
    variant.media_path || "Text-only / no media path provided.",
    ``,
    `## Manual Posting Checklist`,
    ``,
    `- [ ] Confirm client.`,
    `- [ ] Confirm platform account.`,
    `- [ ] Copy caption.`,
    `- [ ] Copy hashtags and CTA.`,
    `- [ ] Upload media asset if available.`,
    `- [ ] Publish manually on platform.`,
    `- [ ] Copy final post URL.`,
    `- [ ] Paste post URL back into Social Ops Hub.`,
    ``
  ].join("\n");
  await writeFile(jsonPath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown, "utf8");
  await appendPublishAudit(clientId, makePublishAuditEntry({
    event_type: "manual_export_created",
    task,
    variant,
    message: "Manual publish package exported. No platform API request was made.",
    publish_method: "manual",
    publish_mode: "manual",
    source: "web",
    metadata: {
      json_path: relativeJsonPath,
      markdown_path: relativeMdPath
    }
  }));
  return {
    ok: true,
    message: "Manual publish package exported. No API request was made.",
    json_path: relativeJsonPath,
    markdown_path: relativeMdPath,
    platform: variant.platform,
    account_id: account.account_id,
    variant_id: variant.variant_id,
    publish_task_id: task?.publish_task_id ?? null
  };
}

async function markPublishTaskManualComplete(clientId: string, taskId: string, postUrl: string): Promise<void> {
  if (!postUrl || !/^https?:\/\//i.test(postUrl)) throw new Error("A valid post_url starting with http:// or https:// is required.");
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const variants = await readClientArray<PlatformVariant>(clientId, "platform-variants.json");
  const task = findPublishTask(queue, taskId);
  if (task.status === "cancelled") throw new Error("Cancelled task cannot be marked completed.");
  const variant = variants.find((item) => item.variant_id === task.variant_id);
  if (!variant) throw new Error(`Variant ${task.variant_id} not found.`);
  assertVariantApproved(variant);
  const previousStatus = task.status;
  const now = new Date().toISOString();
  const manualPostId = `manual_${task.platform}_${task.publish_task_id}`;
  task.status = "published";
  task.platform_post_id = task.platform_post_id || manualPostId;
  task.published_at = task.published_at || now;
  task.error_message = null;
  task.blocked_reason = null;
  task.last_error = null;
  task.next_retry_at = null;
  task.updated_at = now;
  const existingRecord = records.find((record) => record.publish_task_id === task.publish_task_id);
  if (existingRecord) {
    existingRecord.post_url = postUrl;
    existingRecord.mock_url = existingRecord.mock_url || postUrl;
    existingRecord.publish_mode = "manual";
  } else {
    records.push({
      publish_record_id: makeId("record"),
      publish_task_id: task.publish_task_id,
      client_id: task.client_id,
      content_id: task.content_id,
      variant_id: task.variant_id,
      platform: task.platform,
      account_id: task.account_id,
      platform_post_id: task.platform_post_id,
      published_at: task.published_at,
      status: "published",
      publish_mode: "manual",
      mock_url: postUrl,
      post_url: postUrl
    });
  }
  await writeClientArray(clientId, "publish-queue.json", queue);
  await writeClientArray(clientId, "publish-records.json", records);
  await appendPublishAudit(clientId, makePublishAuditEntry({
    event_type: "manual_completed",
    task,
    variant,
    message: "Operator backfilled a manually published post URL. No API call was made.",
    status_before: previousStatus,
    status_after: task.status,
    platform_post_id: task.platform_post_id,
    post_url: postUrl,
    publish_method: "manual",
    publish_mode: "manual",
    source: "web"
  }));
}

async function markXPublishTaskManualComplete(clientId: string, taskId: string): Promise<void> {
  const queue = await readClientArray<PublishTask>(clientId, "publish-queue.json");
  const records = await readClientArray<PublishRecord>(clientId, "publish-records.json");
  const audit = await readClientArray<PublishAuditEntry>(clientId, "publish-audit-log.json");
  const task = findPublishTask(queue, taskId);
  if (task.platform !== "x") throw new Error("Manual completion is only available for X publish tasks in this workspace.");
  if (task.status === "cancelled") throw new Error("Cancelled task cannot be marked completed.");
  if (task.status === "published" || records.some((record) => record.publish_task_id === task.publish_task_id)) {
    task.status = "published";
    task.updated_at = new Date().toISOString();
    await writeClientArray(clientId, "publish-queue.json", queue);
    return;
  }
  const now = new Date().toISOString();
  const manualPostId = `manual_${task.publish_task_id}`;
  task.status = "published";
  task.platform_post_id = manualPostId;
  task.published_at = now;
  task.error_message = null;
  task.blocked_reason = null;
  task.last_error = null;
  task.next_retry_at = null;
  task.updated_at = now;
  records.push({
    publish_record_id: makeId("record"),
    publish_task_id: task.publish_task_id,
    client_id: task.client_id,
    content_id: task.content_id,
    variant_id: task.variant_id,
    platform: "x",
    account_id: task.account_id,
    platform_post_id: manualPostId,
    published_at: now,
    status: "published",
    publish_mode: "manual",
    mock_url: `manual://x/${task.publish_task_id}`,
    post_url: null
  });
  audit.push(makePublishAuditEntry({
    event_type: "manual_completed",
    task,
    variant_id: task.variant_id,
    message: "Operator marked X task as manually published. No API call was made.",
    status_before: "scheduled",
    status_after: task.status,
    platform_post_id: manualPostId,
    publish_method: "manual",
    publish_mode: "manual",
    source: "web"
  }));
  await writeClientArray(clientId, "publish-queue.json", queue);
  await writeClientArray(clientId, "publish-records.json", records);
  await writeClientArray(clientId, "publish-audit-log.json", audit);
}

function makePublishAuditEntry(input: {
  event_type: PublishAuditEntry["event_type"];
  task?: PublishTask;
  variant?: PlatformVariant;
  variant_id?: string | null;
  message: string;
  reason?: string | null;
  publish_method?: PublishAuditEntry["publish_method"];
  publish_mode?: PublishAuditEntry["publish_mode"];
  status_before?: PublishAuditEntry["status_before"];
  status_after?: PublishAuditEntry["status_after"];
  platform_post_id?: string | null;
  post_url?: string | null;
  source: PublishAuditEntry["source"];
  actor?: PublishAuditEntry["actor"];
  metadata?: Record<string, unknown>;
}): PublishAuditEntry {
  const task = input.task;
  const variant = input.variant;
  return {
    audit_id: makeId("audit"),
    timestamp: new Date().toISOString(),
    event_type: input.event_type,
    client_id: task?.client_id ?? variant?.client_id ?? "",
    publish_task_id: task?.publish_task_id ?? null,
    content_id: task?.content_id ?? variant?.content_id ?? null,
    variant_id: task?.variant_id ?? variant?.variant_id ?? input.variant_id ?? null,
    platform: task?.platform ?? variant?.platform ?? "meta",
    account_id: task?.account_id ?? variant?.account_id ?? null,
    publish_method: input.publish_method ?? task?.publish_method ?? null,
    publish_mode: input.publish_mode ?? null,
    status_before: input.status_before ?? null,
    status_after: input.status_after ?? task?.status ?? null,
    platform_post_id: input.platform_post_id ?? task?.platform_post_id ?? null,
    post_url: input.post_url ?? null,
    message: input.message,
    reason: input.reason ?? null,
    actor: input.actor ?? "operator",
    source: input.source,
    metadata: input.metadata
  };
}

async function appendPublishAudit(clientId: string, entry: PublishAuditEntry): Promise<void> {
  const audit = await readClientArray<PublishAuditEntry>(clientId, "publish-audit-log.json");
  audit.push({ ...entry, client_id: entry.client_id || clientId });
  await writeClientArray(clientId, "publish-audit-log.json", audit);
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

function buildMetaEnvStatus(config: Awaited<ReturnType<typeof readMetaFoundationConfig>>, env: Record<string, string>) {
  return {
    env_file: config.shared_meta_auth.env_file,
    required_present: config.shared_meta_auth.required_env_vars.filter((name) => Boolean(env[name])),
    required_missing: config.shared_meta_auth.required_env_vars.filter((name) => !env[name]),
    optional_present: config.shared_meta_auth.optional_env_vars.filter((name) => Boolean(env[name])),
    token_storage_policy: config.shared_meta_auth.token_storage_policy
  };
}

async function readMetaManualExports(clientId: string) {
  const platforms: Array<"facebook" | "instagram"> = ["facebook", "instagram"];
  const result: Record<string, { path: string; exists: boolean; latest_files: string[] }> = {};
  for (const platform of platforms) {
    const relativePath = `data/clients/${clientId}/exports/${platform}/`;
    const dir = join(clientDir(clientId), "exports", platform);
    try {
      const files = (await readdir(dir))
        .filter((file) => !file.startsWith("."))
        .sort()
        .reverse()
        .slice(0, 10);
      result[platform] = { path: relativePath, exists: true, latest_files: files };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        result[platform] = { path: relativePath, exists: false, latest_files: [] };
      } else {
        throw error;
      }
    }
  }
  return result;
}

async function readManualExports(clientId: string) {
  const result: Record<string, { path: string; exists: boolean; latest_files: string[] }> = {};
  for (const platform of platforms) {
    const relativePath = `data/clients/${clientId}/exports/${platform}/`;
    const dir = join(clientDir(clientId), "exports", platform);
    try {
      const files = (await readdir(dir))
        .filter((file) => !file.startsWith("."))
        .sort()
        .reverse()
        .slice(0, 20);
      result[platform] = { path: relativePath, exists: true, latest_files: files };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        result[platform] = { path: relativePath, exists: false, latest_files: [] };
      } else {
        throw error;
      }
    }
  }
  return result;
}

async function readReportStatus(clientId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeek(new Date()).toISOString().slice(0, 10);
  const weekEnd = endOfWeek(new Date()).toISOString().slice(0, 10);
  const dailyPath = join(clientDir(clientId), "reports", "daily", `${today}.json`);
  const weeklyPath = join(clientDir(clientId), "reports", "weekly", `${weekStart}_${weekEnd}.json`);
  const firstWeekPath = join(clientDir(clientId), "reports", "weekly", "first-week-operation-plan.md");
  return {
    today,
    week_start: weekStart,
    week_end: weekEnd,
    daily: {
      path: `data/clients/${clientId}/reports/daily/${today}.json`,
      exists: await pathExists(dailyPath)
    },
    weekly: {
      path: `data/clients/${clientId}/reports/weekly/${weekStart}_${weekEnd}.json`,
      exists: await pathExists(weeklyPath)
    },
    first_week_plan: {
      path: `data/clients/${clientId}/reports/weekly/first-week-operation-plan.md`,
      exists: await pathExists(firstWeekPath)
    }
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderOAuthResultHtml(title: string, message: string, clientId?: string): string {
  const href = clientId ? `/?client_id=${encodeURIComponent(clientId)}` : "/";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; padding: 48px; }
      main { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; }
      a { display: inline-block; margin-top: 16px; color: #0f766e; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${message}</p>
      <a href="${href}">返回 Social Ops Hub</a>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeId(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
}

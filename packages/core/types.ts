export type Platform = "facebook" | "instagram" | "tiktok" | "x" | "linkedin" | "youtube";
export type Status = "draft" | "ready_for_review" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "blocked" | "needs_manual_review" | "cancelled";
export type ApprovalStatus = "draft" | "ready_for_review" | "approved" | "rejected";
export type AutomationActionStatus = "draft" | "suggested" | "approved" | "rejected" | "manually_completed" | "automated_allowed";
export type LeadStage = "new" | "qualified" | "replied" | "waiting_response" | "booked" | "converted" | "not_interested" | "spam";
export type LeadSourceType = "comment" | "dm" | "form" | "manual" | "email" | "whatsapp" | "csv";
export type CapabilityValue = boolean | "limited";
export type AccountStatus = "active" | "inactive" | "archived";
export type AuthStatus = "connected" | "mock" | "disconnected" | "expired" | "error";
export type AccountRole =
  | "official_brand"
  | "founder_voice"
  | "expert_advisor"
  | "case_study"
  | "education_content"
  | "community_account"
  | "sales_conversion"
  | "local_market";
export type ContentFocus =
  | "brand_awareness"
  | "lead_generation"
  | "trust_building"
  | "product_education"
  | "case_study"
  | "community_engagement"
  | "sales_conversion"
  | "customer_support";
export type ContentTheme =
  | "brand_intro"
  | "product_intro"
  | "pain_point"
  | "case_study"
  | "faq"
  | "comparison"
  | "myth_busting"
  | "how_to"
  | "checklist"
  | "offer"
  | "lead_magnet"
  | "testimonial";
export type ContentAngle =
  | "education"
  | "problem_solution"
  | "trust_building"
  | "conversion"
  | "authority"
  | "urgency"
  | "story"
  | "objection_handling";

export interface Client {
  client_id: string;
  client_name: string;
  industry: string;
  business_type: string;
  region: string;
  language: string[];
  target_audience: string[];
  service_keywords: string[];
  brand_tone: string;
  lead_goal: string[];
  monthly_api_budget?: number;
  budget_warn_at?: number;
  budget_block_at?: number;
  max_cost_per_command?: number;
  default_x_search_limit?: number;
  default_kol_discovery_limit?: number;
  status: "active" | "paused" | "archived";
}

export interface ClientCategory {
  category_id: string;
  category_name: string;
  content_angles: string[];
  lead_keywords: string[];
  negative_keywords: string[];
  recommended_platforms: Platform[];
  default_funnel_stages: ContentAsset["funnel_stage"][];
}

export interface PlatformAccount {
  account_id: string;
  client_id: string;
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
  auth_status: AuthStatus;
  status: AccountStatus;
  capability_override?: Partial<PlatformCapabilities>;
  automation_settings?: PlatformAutomationSettings;
  meta_binding?: MetaAccountBinding;
  x_binding?: XAccountBinding;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface XAccountBinding {
  x_user_id?: string;
  x_username?: string;
  token_ref?: string;
  token_status?: "not_configured" | "configured" | "expired" | "revoked" | "unknown";
  scopes?: string[];
  oauth_version?: "1.0a" | "2.0";
  last_checked_at?: string;
  setup_status?: "not_started" | "needs_x_oauth" | "ready_for_read" | "ready_for_write" | "ready_for_manual";
  setup_notes?: string[];
}

export interface MetaAccountBinding {
  meta_app_id?: string;
  business_id?: string;
  page_id?: string;
  page_name?: string;
  instagram_business_account_id?: string;
  instagram_username?: string;
  connected_facebook_page_id?: string;
  connected_facebook_page_name?: string;
  token_ref?: string;
  token_env_var?: string;
  permissions?: string[];
  token_status?: "not_configured" | "configured" | "expired" | "needs_review" | "unknown";
  setup_status?: "not_started" | "needs_meta_setup" | "ready_for_mock" | "ready_for_dry_run" | "ready_for_manual" | "ready_for_api_later" | "ready_for_api";
  last_checked_at?: string;
  setup_notes?: string[];
}

export interface PlatformAutomationSettings {
  auto_publish_enabled: boolean;
  auto_reply_enabled: boolean;
  auto_dm_enabled: boolean;
  auto_follow_enabled: boolean;
  auto_kol_discovery_enabled: boolean;
  auto_lead_discovery_enabled: boolean;
}

export interface PlatformCapabilities {
  can_publish_text: CapabilityValue;
  can_publish_image: CapabilityValue;
  can_publish_video: CapabilityValue;
  can_publish_carousel: CapabilityValue;
  can_publish_story: CapabilityValue;
  can_publish_reel: CapabilityValue;
  can_publish_draft: CapabilityValue;
  can_read_comments: CapabilityValue;
  can_read_dm: CapabilityValue;
  can_fetch_analytics: CapabilityValue;
  can_auto_reply: CapabilityValue;
  supports_mock: CapabilityValue;
  supports_real_api: CapabilityValue;
  requires_oauth: CapabilityValue;
  requires_app_review: CapabilityValue;
  requires_business_account: CapabilityValue;
  requires_human_review: CapabilityValue;
  notes: string;
}

export interface MediaAsset {
  type: "video" | "image" | "audio" | "document";
  path: string;
}

export interface ContentAsset {
  content_id: string;
  client_id: string;
  category_id: string;
  content_theme: ContentTheme;
  content_type: "short_video" | "image_post" | "text_post" | "carousel";
  content_angle: ContentAngle;
  title: string;
  hook: string;
  main_points: string[];
  cta: string;
  language: string;
  target_audience: string[];
  funnel_stage: "awareness" | "trust_building" | "lead_generation" | "conversion";
  media_assets: MediaAsset[];
  status: Status;
  created_by: string;
  approved_by_human: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformVariant {
  variant_id: string;
  content_id: string;
  client_id: string;
  platform: Platform;
  account_id: string;
  format: string;
  caption: string;
  hashtags: string[];
  media_path: string | null;
  cta: string;
  language: string;
  account_role: AccountRole;
  content_focus: ContentFocus;
  status: Status;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishTask {
  publish_task_id: string;
  client_id: string;
  content_id: string;
  variant_id: string;
  platform: Platform;
  account_id: string;
  scheduled_at: string;
  status: Status;
  approval_status: ApprovalStatus;
  publish_method: "mock" | "official_api";
  platform_post_id: string | null;
  published_at: string | null;
  error_message: string | null;
  blocked_reason: string | null;
  retry_count: number;
  max_retry: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishRecord {
  publish_record_id: string;
  publish_task_id: string;
  client_id: string;
  content_id: string;
  variant_id: string;
  platform: Platform;
  account_id: string;
  platform_post_id: string;
  published_at: string;
  status: "published";
  publish_mode: "mock" | "api" | "manual";
  mock_url: string;
  post_url?: string | null;
}

export interface PublishAuditEntry {
  audit_id: string;
  timestamp: string;
  event_type:
    | "dry_run_preview"
    | "meta_dry_run_preview"
    | "manual_export_created"
    | "manual_completed"
    | "publish_attempt"
    | "publish_success"
    | "publish_failed"
    | "publish_blocked"
    | "automation_attempt"
    | "automation_success"
    | "automation_failed"
    | "automation_blocked";
  client_id: string;
  publish_task_id: string | null;
  content_id: string | null;
  variant_id: string | null;
  platform: Platform | "meta";
  account_id: string | null;
  publish_method: PublishTask["publish_method"] | "dry_run" | "manual" | null;
  publish_mode: PublishRecord["publish_mode"] | "dry_run" | "manual" | null;
  status_before?: Status | null;
  status_after?: Status | null;
  platform_post_id?: string | null;
  post_url?: string | null;
  message: string;
  reason?: string | null;
  actor: "system" | "operator" | "openclaw" | "cli";
  source: "web" | "cli" | "worker";
  metadata?: Record<string, unknown>;
}

export interface Lead {
  lead_id: string;
  client_id: string;
  platform: Platform;
  account_id: string;
  source_type: LeadSourceType;
  source_mode: "manual" | "mock" | "api" | "csv";
  source_post_id: string | null;
  source_url: string | null;
  user_handle: string;
  user_display_name: string;
  message_text: string;
  detected_intent: string;
  lead_score: number;
  lead_stage: LeadStage;
  recommended_reply: string;
  human_review_required: boolean;
  assigned_to: string;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  contact_method: "comment" | "dm" | "email" | "phone" | "whatsapp" | "wechat" | "unknown";
  lead_notes: string[];
  created_at: string;
  updated_at: string;
}

export interface ReplyDraft {
  reply_draft_id: string;
  lead_id: string;
  client_id: string;
  platform: Platform;
  account_id: string;
  draft_text: string;
  tone: string;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  sent_status: "not_sent" | "sent" | "failed";
  created_at: string;
  updated_at: string;
}

export interface XPublicMetrics {
  retweet_count?: number;
  reply_count?: number;
  like_count?: number;
  quote_count?: number;
  impression_count?: number;
  followers_count?: number;
  following_count?: number;
  tweet_count?: number;
  listed_count?: number;
}

export interface XResearchPost {
  post_id: string;
  text: string;
  author_id: string;
  username: string;
  post_url: string;
  public_metrics: XPublicMetrics;
  matched_keywords: string[];
  created_at?: string;
  saved_at: string;
  research_status: AutomationActionStatus;
}

export interface XMediaAttachment {
  media_key: string;
  type: "photo" | "video" | "animated_gif" | string;
  url?: string;
  preview_image_url?: string;
  duration_ms?: number;
  public_metrics?: XPublicMetrics;
}

export interface XMediaPost {
  media_post_id: string;
  client_id: string;
  source_username: string;
  source_user_id: string;
  post_id: string;
  text: string;
  post_url: string;
  created_at?: string;
  public_metrics: XPublicMetrics;
  possibly_sensitive?: boolean;
  media: XMediaAttachment[];
  has_photo: boolean;
  has_video: boolean;
  has_video_under_limit: boolean;
  max_video_seconds: number;
  selected_for_client: boolean;
  review_status: AutomationActionStatus;
  saved_at: string;
  updated_at: string;
}

export interface XQueryHistoryEntry {
  query_id: string;
  client_id: string;
  command: string;
  mode: "mock" | "api";
  keywords: string[];
  username?: string;
  requested_limit?: number;
  returned_count: number;
  saved_count: number;
  result_ids?: string[];
  estimated_cost: number;
  api_calls: number;
  cache_hits: number;
  result_file: string;
  created_at: string;
}

export interface XKolProspect {
  prospect_id: string;
  client_id: string;
  source: "keyword_search" | "competitor_mining" | "manual" | "mock";
  user_id: string;
  username: string;
  display_name: string;
  profile_url: string;
  bio: string;
  public_metrics: XPublicMetrics;
  recent_posts: XResearchPost[];
  matched_keywords: string[];
  kol_score: number;
  engagement_score?: number;
  content_match_score?: number;
  follower_score?: number;
  audience_fit_score?: number;
  collaboration_score?: number;
  kol_priority?: "high_priority" | "medium_priority" | "watchlist" | "ignored";
  collaboration_status?: "new" | "priority" | "contacted" | "rejected" | "watchlist";
  prospect_status: AutomationActionStatus;
  notes: string;
  saved_at: string;
  updated_at: string;
}

export interface XLeadCandidate {
  candidate_id: string;
  client_id: string;
  platform: "x";
  source_post_id: string;
  source_url: string;
  user_id: string;
  username: string;
  display_name: string;
  message_text: string;
  matched_keywords: string[];
  intent_score: number;
  buyer_intent_score?: number;
  industry_match_score?: number;
  urgency_score?: number;
  negative_score?: number;
  reply_value_score?: number;
  lead_priority?: "high" | "medium" | "low" | "ignore";
  candidate_status: AutomationActionStatus;
  recommended_reply: string;
  saved_at: string;
  updated_at: string;
}


export interface XFollowAction {
  follow_action_id: string;
  client_id: string;
  platform: "x";
  account_id: string;
  source_type: "kol_prospect" | "lead_candidate" | "manual";
  source_id: string | null;
  target_user_id: string;
  target_username: string;
  target_display_name: string | null;
  target_profile_url: string;
  approval_status: AutomationActionStatus;
  status: "suggested" | "blocked" | "completed" | "failed" | "mock_completed";
  mode: "mock" | "api";
  confirmed_live: boolean;
  blocked_reason: string | null;
  error_message: string | null;
  x_following: boolean | null;
  requested_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface XEngagementItem {
  engagement_id: string;
  client_id: string;
  platform: "x";
  account_id: string;
  source_type: "mention" | "reply" | "quote" | "dm" | "manual" | "mock";
  source_id: string;
  source_url: string | null;
  user_id: string;
  username: string;
  text: string;
  classification: "lead" | "complaint" | "question" | "partnership" | "spam" | "general_engagement";
  lead_score: number;
  action_status: AutomationActionStatus;
  saved_at: string;
  updated_at: string;
}

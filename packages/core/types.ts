export type Platform = "facebook" | "instagram" | "tiktok" | "x" | "linkedin" | "youtube";
export type Status = "draft" | "ready_for_review" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "blocked" | "needs_manual_review" | "cancelled";
export type ApprovalStatus = "draft" | "ready_for_review" | "approved" | "rejected";
export type LeadStage = "new" | "qualified" | "replied" | "waiting_response" | "booked" | "converted" | "not_interested" | "spam";
export type LeadSourceType = "comment" | "dm" | "form" | "manual" | "email" | "whatsapp";
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
  notes: string;
  created_at: string;
  updated_at: string;
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

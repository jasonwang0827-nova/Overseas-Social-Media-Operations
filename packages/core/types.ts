export type Platform = "facebook" | "instagram" | "tiktok" | "x" | "youtube";
export type Status = "draft" | "ready_for_review" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type LeadStage = "new" | "qualified" | "replied" | "booked" | "converted" | "not_interested" | "spam";

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
}

export interface PlatformAccount {
  account_id: string;
  client_id: string;
  platform: Platform;
  account_name: string;
  account_type: "business" | "creator" | "page";
  persona: string;
  language: string;
  region: string;
  content_role: string;
  status: "active" | "paused" | "archived";
  auth_status: "connected" | "mock" | "disconnected";
  posting_enabled: boolean;
}

export interface MediaAsset {
  type: "video" | "image" | "audio" | "document";
  path: string;
}

export interface ContentAsset {
  content_id: string;
  client_id: string;
  category_id: string;
  content_theme: string;
  content_type: "short_video" | "image_post" | "text_post" | "carousel";
  content_angle: string;
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
  status: Status;
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
}

export interface PublishRecord extends PublishTask {
  record_id: string;
}

export interface Lead {
  lead_id: string;
  client_id: string;
  platform: Platform;
  account_id: string;
  source_type: "comment" | "dm" | "mention" | "reaction";
  source_post_id: string | null;
  user_handle: string;
  user_display_name: string;
  message_text: string;
  detected_intent: string;
  lead_score: number;
  lead_stage: LeadStage;
  recommended_reply: string;
  human_review_required: boolean;
  assigned_to: string;
  created_at: string;
}

export interface ReplyDraft {
  reply_draft_id: string;
  lead_id: string;
  client_id: string;
  draft_text: string;
  approval_status: ApprovalStatus;
  sent_status: "not_sent" | "sent" | "failed";
  created_at: string;
}

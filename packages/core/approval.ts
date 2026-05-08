import type { ContentAsset, PlatformVariant, PublishTask } from "./types.js";

export function assertContentApproved(content: ContentAsset): void {
  if (!content.approved_by_human || content.status !== "approved") {
    throw new Error(`Content ${content.content_id} is not approved.`);
  }
}

export function assertPublishApproved(task: PublishTask): void {
  if (task.approval_status !== "approved") {
    throw new Error(`Publish task ${task.publish_task_id} is not approved.`);
  }
}

export function assertVariantIsDifferentFromContent(variant: PlatformVariant, content: ContentAsset): void {
  if (variant.caption.trim() === `${content.hook}\n\n${content.cta}`.trim()) {
    throw new Error(`Variant ${variant.variant_id} is too close to the raw content asset.`);
  }
}

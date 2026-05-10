import type { PlatformVariant, PublishRecord, PublishTask } from "../core/types.js";

export interface PublishResult {
  ok: boolean;
  platform_post_id: string | null;
  error_message: string | null;
  publish_mode?: PublishRecord["publish_mode"];
  mock_url?: string | null;
  post_url?: string | null;
}

export interface Publisher {
  publish(task: PublishTask, variant: PlatformVariant): Promise<PublishResult>;
}

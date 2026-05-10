import type { PlatformVariant, PublishTask } from "../core/types.js";

export interface PublishResult {
  ok: boolean;
  platform_post_id: string | null;
  error_message: string | null;
  mock_url?: string | null;
}

export interface Publisher {
  publish(task: PublishTask, variant: PlatformVariant): Promise<PublishResult>;
}

import type { Platform } from "../core/types.js";
import type { Publisher } from "./types.js";

export function createMockPublisher(platform: Platform): Publisher {
  return {
    async publish(task) {
      const platformPostId = `${platform}_mock_${task.publish_task_id}`;
      return {
        ok: true,
        platform_post_id: platformPostId,
        error_message: null,
        publish_mode: "mock",
        mock_url: `https://mock.social/${platform}/${platformPostId}`,
        post_url: `https://mock.social/${platform}/${platformPostId}`
      };
    }
  };
}

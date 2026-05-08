import type { Platform } from "../core/types.js";
import type { Publisher } from "./types.js";

export function createMockPublisher(platform: Platform): Publisher {
  return {
    async publish(task) {
      return {
        ok: true,
        platform_post_id: `${platform}_mock_${task.publish_task_id}`,
        error_message: null
      };
    }
  };
}

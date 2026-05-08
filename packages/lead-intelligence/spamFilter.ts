import type { ClientCategory } from "../core/types.js";

export function isSpamOrNegative(messageText: string, category: ClientCategory): boolean {
  return category.negative_keywords.some((keyword) => messageText.includes(keyword));
}

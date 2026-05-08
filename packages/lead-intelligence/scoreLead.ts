import type { ClientCategory } from "../core/types.js";
import { isSpamOrNegative } from "./spamFilter.js";

export function scoreLead(messageText: string, category: ClientCategory): number {
  if (isSpamOrNegative(messageText, category)) {
    return 0;
  }

  let score = 20;
  for (const keyword of category.lead_keywords) {
    if (messageText.includes(keyword)) {
      score += 15;
    }
  }

  if (messageText.includes("我孩子") || messageText.includes("孩子现在") || messageText.includes("家长")) {
    score += 25;
  }

  if (messageText.includes("转学") || messageText.includes("转到") || messageText.includes("签证被拒")) {
    score += 20;
  }

  if (messageText.includes("怎么联系") || messageText.includes("可以咨询吗") || messageText.includes("预约")) {
    score += 20;
  }

  return Math.min(score, 100);
}

import type { LeadScoringRule } from "./scoreLead.js";

export function classifyIntent(messageText: string, rule?: LeadScoringRule): string {
  const text = messageText.toLowerCase();
  if (rule?.negative_keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "negative_or_spam";
  }
  if (rule?.high_intent_keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "high_intent";
  }
  if (rule?.medium_intent_keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "medium_intent";
  }
  if (text.includes("签证") || text.includes("visa")) {
    return "visa_inquiry";
  }
  if (text.includes("转学分") || text.includes("转学") || text.includes("转到") || text.includes("transfer")) {
    return "transfer_credit";
  }
  if (text.includes("多少钱") || text.includes("费用") || text.includes("price") || text.includes("cost")) {
    return "pricing";
  }
  if (text.includes("怎么申请") || text.includes("可以咨询") || text.includes("想了解") || text.includes("how")) {
    return "consultation";
  }
  return "general_interest";
}

export function classifyIntent(messageText: string): string {
  const text = messageText.toLowerCase();
  if (text.includes("多少钱") || text.includes("费用") || text.includes("price") || text.includes("cost")) {
    return "pricing";
  }
  if (text.includes("怎么申请") || text.includes("可以咨询") || text.includes("想了解") || text.includes("how")) {
    return "consultation";
  }
  if (text.includes("签证") || text.includes("visa")) {
    return "visa_inquiry";
  }
  if (text.includes("转学分") || text.includes("转学") || text.includes("转到") || text.includes("transfer")) {
    return "transfer_credit";
  }
  return "general_interest";
}

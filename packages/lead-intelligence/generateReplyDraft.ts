import type { Client, Lead } from "../core/types.js";

export function generateReplyDraft(client: Client, lead: Lead): string {
  if (lead.detected_intent === "negative_or_spam" || lead.lead_stage === "spam") {
    return "这条互动可能不是有效线索，建议先标记为 spam 或人工确认后再回复。";
  }
  if (lead.detected_intent === "high_intent") {
    return `谢谢你留言。可以的，你可以先补充一下具体需求，${client.client_name} 会帮你判断下一步是否适合预约咨询。`;
  }
  if (lead.detected_intent === "transfer_credit") {
    return `可以的，要看你现在读的学校、专业和已修课程。你可以私信我们，${client.client_name} 可以先帮你做一个初步判断。`;
  }

  if (lead.detected_intent === "pricing") {
    return `费用会根据具体情况不同。你可以私信我们说明一下需求，${client.client_name} 会先帮你判断适合的方案。`;
  }

  return `谢谢你的留言。你可以私信我们补充一下具体情况，${client.client_name} 会先帮你做初步判断。`;
}

import type { ClientCategory } from "../core/types.js";
import { isSpamOrNegative } from "./spamFilter.js";

export interface LeadScoringRule {
  high_intent_keywords: string[];
  medium_intent_keywords: string[];
  negative_keywords: string[];
  question_patterns: string[];
  score_rules: {
    base_score: number;
    high_intent_points: number;
    medium_intent_points: number;
    question_points: number;
    negative_points: number;
    spam_threshold: number;
    qualified_threshold: number;
    high_score_threshold: number;
  };
  default_recommended_actions: string[];
}

export function scoreLead(messageText: string, category: ClientCategory, rule?: LeadScoringRule): number {
  if (rule) return scoreWithRule(messageText, rule);
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

function scoreWithRule(messageText: string, rule: LeadScoringRule): number {
  const text = messageText.toLowerCase();
  let score = rule.score_rules.base_score;
  for (const keyword of rule.high_intent_keywords) {
    if (text.includes(keyword.toLowerCase())) score += rule.score_rules.high_intent_points;
  }
  for (const keyword of rule.medium_intent_keywords) {
    if (text.includes(keyword.toLowerCase())) score += rule.score_rules.medium_intent_points;
  }
  if (rule.question_patterns.some((pattern) => text.includes(pattern.toLowerCase()))) {
    score += rule.score_rules.question_points;
  }
  if (rule.negative_keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
    score += rule.score_rules.negative_points;
  }
  return Math.max(0, Math.min(score, 100));
}

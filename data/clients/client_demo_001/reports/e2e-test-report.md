# E2E Demo Test Report

Client: `client_demo_001`

Run date: `2026-05-10`

## Summary

| Checkpoint | Result |
| --- | ---: |
| Platform accounts created | 4 |
| Content assets created | 2 |
| Platform variants generated | 8 |
| Distinct variant captions | 8 |
| Publish tasks scheduled | 8 |
| Mock published records | 8 |
| Blocked tasks | 0 |
| Leads imported | 5 |
| High-score leads | 3 |
| Reply drafts generated | 3 |
| Daily report generated | Yes |
| Weekly report generated | Yes |

## Accounts

- `instagram`: `ig_demo_001` / `expert_advisor` / `lead_generation`
- `tiktok`: `tiktok_demo_001` / `education_content` / `brand_awareness`
- `facebook`: `facebook_demo_001` / `official_brand` / `trust_building`
- `x`: `x_demo_001` / `founder_voice` / `community_engagement`

Each demo account includes posting, lead tracking, mock auth, and account-level `capability_override` examples.

## Content And Variants

- `content_demo_brand_intro_001`: `brand_intro` / `approved`
- `content_demo_lead_generation_001`: `lead_magnet` / `approved`

Each content asset has one approved variant per Phase 1 platform. Captions are account-aware and platform-specific.

## Publish Queue

Queue status:

- `published`: 8

Blocked tasks:

- None

Publish modes observed:

- `mock`

## Leads

Lead stages:

- `qualified`: 3
- `new`: 1
- `spam`: 1

Source modes observed:

- `manual`
- `csv`

## Reply Drafts

Reply drafts were generated for all leads with `lead_score >= 70`. No auto-reply or auto-DM sending was performed.

## Reports

- Daily report: `/Users/jason/Nova/Overseas-Social-Media-Operations/data/clients/client_demo_001/reports/daily/2026-05-10.json` created
- Weekly report: `/Users/jason/Nova/Overseas-Social-Media-Operations/data/clients/client_demo_001/reports/weekly/2026-05-04_2026-05-10.json` created

## Current Findings

- The complete demo flow works from seed through approved content, approved variants, batch scheduling, mock publishing, lead import, lead scoring, reply draft generation, daily report, and weekly report.
- `publish:run` correctly respects scheduled times; `demo:e2e` uses a test timezone so the fixed `2026-05-10` schedule can be processed immediately.
- Platform capabilities keep lead import in manual/csv mode while real API reading is not enabled.

## Next Suggestions

- Use `npm run demo:e2e` as the regression check before and after adding the X adapter.
- Start the X adapter behind capability checks and keep mock/manual fallback intact.

# OpenClaw Client Intake SOP

Purpose: let OpenClaw receive client information in the background and write a complete client profile into Social Ops Hub without using the UI.

This SOP is for internal automation. The UI is for Jason to inspect and operate the system after data is written.

## 1. System Paths

Project root:

```text
/Users/jason/Nova/Overseas-Social-Media-Operations
```

Global category template:

```text
data/categories.json
```

Client data root:

```text
data/clients/
```

Each client must have its own folder:

```text
data/clients/<client_id>/
```

Example:

```text
data/clients/client_study_001/
data/clients/client_realestate_001/
```

## 2. Core Rule

The system is organized by client.

All accounts, content, variants, publish tasks, leads, reply drafts, reports, assets, and exports must belong to one `client_id`.

Never create platform accounts, content, publish tasks, or leads outside a client folder.

## 3. Input Expected From Jason

OpenClaw should collect or receive these fields:

```json
{
  "client_name": "",
  "business_description": "",
  "category_id": "",
  "region": "",
  "languages": [],
  "target_audience": [],
  "services": [],
  "service_keywords": [],
  "brand_tone": "",
  "lead_goal": [],
  "preferred_platforms": [],
  "compliance_notes": "",
  "notes": ""
}
```

Valid `category_id` values must come from:

```text
data/categories.json
```

Current valid categories:

```text
study_abroad
real_estate
brand_global
local_service
finance_insurance
```

If the client does not clearly match one category, choose the closest category and add the uncertainty to `openclaw-client-brief.json`.

## 4. client_id Rules

`client_id` must use lowercase letters, numbers, and underscores only.

Use this pattern:

```text
client_<category_short_name>_<3 digit number>
```

Examples:

```text
client_study_001
client_realestate_001
client_brand_001
client_localservice_001
client_finance_001
```

Do not use:

```text
spaces
Chinese characters
capital letters
hyphens
special symbols
```

Before creating a client, check whether the folder already exists:

```text
data/clients/<client_id>/
```

If it exists, choose the next number.

## 5. Directory Structure To Create

For every new client, create:

```text
data/clients/<client_id>/
  client.json
  categories.json
  accounts.json
  content-pool.json
  platform-variants.json
  publish-queue.json
  publish-records.json
  leads.json
  reply-drafts.json
  openclaw-client-brief.json
  assets/
    raw/
    videos/
    images/
    audio/
  exports/
    instagram/
    tiktok/
    facebook/
    x/
  reports/
    daily/
    weekly/
```

## 6. Files To Write

### 6.1 client.json

Write:

```json
{
  "client_id": "client_study_001",
  "client_name": "ABC Study Abroad",
  "industry": "study_abroad",
  "business_type": "education_consulting",
  "region": "Canada",
  "language": ["zh", "en"],
  "target_audience": [
    "Chinese students",
    "Chinese parents",
    "international students",
    "new immigrants"
  ],
  "service_keywords": [
    "study abroad",
    "visa",
    "college transfer",
    "university application",
    "加拿大留学",
    "转学分",
    "签证"
  ],
  "brand_tone": "professional, trustworthy, friendly",
  "lead_goal": [
    "book consultation",
    "DM inquiry",
    "WhatsApp contact",
    "website visit"
  ],
  "status": "active"
}
```

Rules:

- `industry` must equal `category_id`.
- `language` must be an array.
- `target_audience`, `service_keywords`, and `lead_goal` must be arrays.
- `status` should be `active` unless Jason says otherwise.

### 6.2 categories.json

Copy the full contents of:

```text
data/categories.json
```

into:

```text
data/clients/<client_id>/categories.json
```

Do not create a custom category file unless Jason explicitly asks.

### 6.3 Empty Operational Files

Initialize these files as empty arrays:

```json
[]
```

Files:

```text
accounts.json
content-pool.json
platform-variants.json
publish-queue.json
publish-records.json
leads.json
reply-drafts.json
```

### 6.4 openclaw-client-brief.json

Write a structured brief for future OpenClaw tasks:

```json
{
  "client_id": "client_study_001",
  "source": "openclaw_background_intake",
  "business_summary": "",
  "category_id": "study_abroad",
  "target_audience": [],
  "services": [],
  "preferred_platforms": [],
  "content_direction": [],
  "lead_goal": [],
  "brand_tone": "",
  "compliance_notes": "",
  "open_questions": [],
  "next_step": "Generate platform accounts, account personas, content roles, service keywords, lead keywords, and initial content assets.",
  "created_at": "ISO timestamp"
}
```

Use `open_questions` for missing or uncertain information instead of inventing important facts.

## 7. Optional Initial Account Suggestions

Do not create platform accounts automatically unless Jason asks.

If Jason asks OpenClaw to prepare account suggestions, write them to:

```text
data/clients/<client_id>/openclaw-account-suggestions.json
```

Suggested schema:

```json
[
  {
    "platform": "instagram",
    "account_name": "",
    "persona": "study_consultant",
    "content_role": "case_explainer",
    "language": "zh",
    "region": "Canada",
    "posting_enabled": false,
    "reason": ""
  }
]
```

Important: account suggestions are not real accounts. Real connected accounts must go into `accounts.json`.

## 8. Optional Initial Content Strategy

Do not create publishable content automatically unless Jason asks.

If Jason asks for strategy only, write:

```text
data/clients/<client_id>/openclaw-content-strategy.json
```

Suggested schema:

```json
{
  "client_id": "",
  "category_id": "",
  "content_pillars": [],
  "content_angles": [],
  "lead_magnets": [],
  "platform_notes": {
    "instagram": [],
    "tiktok": [],
    "facebook": [],
    "x": []
  },
  "avoid": []
}
```

## 9. Validation Checklist

After writing files, OpenClaw must verify:

```text
client folder exists
client.json exists
client_id in client.json matches folder name
industry matches category_id
categories.json exists
all operational JSON files exist
operational files are valid JSON arrays
reports/daily and reports/weekly folders exist
assets and exports folders exist
openclaw-client-brief.json exists
```

Then run:

```bash
npm run typecheck
```

If typecheck fails, do not continue to account/content generation. Report the failure.

## 10. What OpenClaw Must Not Do During Intake

During client intake, do not:

```text
create publish tasks
mock publish content
write platform tokens
create fake connected accounts
auto-send replies
auto-DM users
skip variant approval
write content directly into publish-queue
```

Client intake only creates the client foundation.

## 11. Next Workflow After Intake

After the client is created, the next steps are:

```text
1. Generate or confirm platform account plan
2. Create real platform accounts in accounts.json
3. Generate content strategy
4. Generate content-pool items
5. Generate platform variants
6. Human approves content and variants
7. Schedule publish tasks
8. Run mock publish
9. Import and score leads
10. Generate weekly report
```

## 12. Short Prompt For OpenClaw

Use this prompt when asking OpenClaw to perform background client intake:

```text
You are creating a new Social Ops Hub client in the background.

Read:
/Users/jason/Nova/Overseas-Social-Media-Operations/docs/openclaw/client-intake-sop.md

Use the project root:
/Users/jason/Nova/Overseas-Social-Media-Operations

Do not use the UI.
Do not create publish tasks.
Do not create fake connected platform accounts.

Take the client information I provide, choose a valid category_id from data/categories.json, generate a valid client_id, create the client folder under data/clients/<client_id>/, write client.json, copy categories.json, initialize all operational JSON files as empty arrays, write openclaw-client-brief.json, and run npm run typecheck.

After completion, report the client_id, created files, any missing information, and the next recommended step.
```

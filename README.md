# Social Ops Hub

Overseas Social Media Operations & Lead Management Hub.

This MVP is organized around:

```text
Client -> Business Category -> Target Audience -> Content Strategy -> Platform Accounts -> Content Pool -> Publish Queue -> Lead Management
```

The first version uses local JSON files under `data/clients/<client_id>/` and mock publishers for Facebook, Instagram, TikTok, and X. YouTube is reserved as an adapter folder only.

Global client category templates live in `data/categories.json` and are copied into each client directory as `categories.json`.

## Quick Start

```bash
npm install
npm run demo:seed
npm run web:dev
```

Open:

```text
http://localhost:4321
```

CLI flow:

```bash
npm run publish:run -- --client_id client_study_001
npm run lead:score -- --client_id client_study_001
npm run report:daily -- --client_id client_study_001
npm run report:weekly -- --client_id client_study_001
```

## Web UI

The MVP includes a local dashboard for checking:

- Client profile
- Client creation with industry, audience, keywords, lead goals, and OpenClaw client brief
- Platform accounts
- Platform account creation, editing, posting toggle, and lead tracking toggle
- Content assets
- Platform variants
- Publish queue and publish records
- Lead pool, lead scoring, and reply drafts
- Daily report preview
- Weekly report generation

The web server reads and writes the same JSON files under `data/clients/<client_id>/`.

## CLI Commands

```bash
npm run client:create -- --client_id client_study_001 --client_name "ABC Study Abroad" --category_id study_abroad
npm run account:add -- --client_id client_study_001 --platform instagram --account_name abc_study_canada
npm run account:list -- --client_id client_study_001
npm run account:update -- --client_id client_study_001 --account_id ig_xxx --content_focus lead_generation
npm run account:disable -- --client_id client_study_001 --account_id ig_xxx
npm run account:enable -- --client_id client_study_001 --account_id ig_xxx
npm run account:status -- --client_id client_study_001
npm run content:add -- --client_id client_study_001 --category_id study_abroad
npm run content:variant -- --client_id client_study_001 --content_id content_xxx --platform instagram --account_id ig_xxx
npm run content:approve -- --client_id client_study_001 --content_id content_xxx
npm run variant:approve -- --client_id client_study_001 --variant_id variant_xxx
npm run publish:schedule -- --client_id client_study_001 --variant_id variant_xxx
npm run publish:run -- --client_id client_study_001
npm run publish:status -- --client_id client_study_001
npm run lead:import -- --client_id client_study_001 --message_text "我孩子现在大一，可以转到加拿大吗？"
npm run lead:score -- --client_id client_study_001
npm run report:daily -- --client_id client_study_001
npm run report:weekly -- --client_id client_study_001
```

## Business Rules

- Content assets cannot be published directly.
- A publish task must reference `variant_id`.
- Content must be approved before scheduling.
- Platform variants must be approved before scheduling or publishing.
- `publish:run` blocks unapproved tasks and unapproved variants.
- Publish tasks include retry metadata: `retry_count`, `max_retry`, `last_error`, and `next_retry_at`.
- Leads include follow-up metadata: `lead_stage`, `assigned_to`, `next_follow_up_at`, `last_contacted_at`, `contact_method`, and `lead_notes`.
- Every platform account must belong to a `client_id`.
- `posting_enabled = false` accounts cannot enter the publish queue.
- `lead_tracking_enabled = false` accounts are excluded from account-level lead stats.
- `status = inactive` accounts are excluded from publishing and account-level reporting.

## Platform Account Schema

`accounts.json` stores platform accounts with:

```json
{
  "account_id": "ig_brand_001",
  "client_id": "client_brand_001",
  "platform": "instagram",
  "account_name": "brand_instagram",
  "display_name": "Brand Official",
  "account_url": "https://instagram.com/brand",
  "language": "en",
  "region": "Canada",
  "account_role": "official_brand",
  "content_focus": "lead_generation",
  "posting_enabled": true,
  "lead_tracking_enabled": true,
  "auth_status": "mock",
  "status": "active",
  "notes": "",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

Supported platforms:

```text
instagram, tiktok, facebook, x, linkedin, youtube
```

Phase 1 publishable platforms:

```text
instagram, tiktok, facebook, x
```

Reserved platforms:

```text
linkedin, youtube
```

Account roles:

```text
official_brand
founder_voice
expert_advisor
case_study
education_content
community_account
sales_conversion
local_market
```

Content focus:

```text
brand_awareness
lead_generation
trust_building
product_education
case_study
community_engagement
sales_conversion
customer_support
```

## Data Layout

```text
data/categories.json
data/clients/<client_id>/
  client.json
  accounts.json
  content-pool.json
  platform-variants.json
  publish-queue.json
  publish-records.json
  leads.json
  reply-drafts.json
  reports/daily/
  reports/weekly/
  assets/raw/
  assets/videos/
  assets/images/
  assets/audio/
  exports/instagram/
  exports/tiktok/
  exports/facebook/
  exports/x/
```

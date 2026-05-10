# Social Ops Hub

Overseas Social Media Operations & Lead Management Hub.

This MVP is organized around:

```text
Client -> Business Category -> Target Audience -> Content Strategy -> Platform Accounts -> Content Pool -> Publish Queue -> Lead Management
```

The first version uses local JSON files under `data/clients/<client_id>/` and mock publishers for Facebook, Instagram, TikTok, and X. YouTube is reserved as an adapter folder only.

Global client category templates live in `data/categories.json` and are copied into each client directory as `categories.json`.
Platform writing rules live in `data/platform-style-rules.json` so one content asset can become different account-specific variants.
Platform capability rules live in `data/platform-capabilities.json` so the system can decide whether an action should use API, mock, or manual workflow before publishing or importing leads.

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
- Platform capability overview for publish, lead reading, analytics, OAuth, app review, and manual workflow requirements
- Account-level capability status with optional `capability_override` JSON
- Content Workspace for creating, generating, filtering, approving, and rejecting content assets
- Platform variant generation, caption/hashtag/CTA editing, approval, and rejection
- Publish Queue Workspace for scheduling, rescheduling, cancelling, retrying, and running mock publish
- Publish records with mock URLs
- Lead pool, lead scoring, and reply drafts
- Lead Management Workspace with filters, follow-up fields, quick stage updates, and reply draft review
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
npm run content:list -- --client_id client_study_001
npm run content:generate -- --client_id client_study_001 --theme brand_intro
npm run content:update -- --client_id client_study_001 --content_id content_xxx --title "New title"
npm run content:variant -- --client_id client_study_001 --content_id content_xxx --platform instagram --account_id ig_xxx
npm run content:variant:generate -- --client_id client_study_001 --content_id content_xxx
npm run content:approve -- --client_id client_study_001 --content_id content_xxx
npm run content:reject -- --client_id client_study_001 --content_id content_xxx
npm run content:status -- --client_id client_study_001
npm run variant:approve -- --client_id client_study_001 --variant_id variant_xxx
npm run variant:reject -- --client_id client_study_001 --variant_id variant_xxx
npm run publish:schedule -- --client_id client_study_001 --variant_id variant_xxx
npm run publish:schedule:batch -- --client_id client_study_001 --date 2026-05-10
npm run publish:list -- --client_id client_study_001
npm run publish:run -- --client_id client_study_001
npm run publish:status -- --client_id client_study_001
npm run publish:cancel -- --client_id client_study_001 --publish_task_id pub_xxx
npm run publish:reschedule -- --client_id client_study_001 --publish_task_id pub_xxx --scheduled_at 2026-05-10T14:00:00-04:00
npm run publish:retry -- --client_id client_study_001 --publish_task_id pub_xxx
npm run publish:calendar -- --client_id client_study_001 --from 2026-05-10 --to 2026-05-17
npm run lead:import -- --client_id client_study_001 --message_text "我孩子现在大一，可以转到加拿大吗？"
npm run lead:score -- --client_id client_study_001
npm run lead:update -- --client_id client_study_001 --lead_id lead_xxx --lead_stage qualified
npm run reply:generate -- --client_id client_study_001 --lead_id lead_xxx
npm run reply:list -- --client_id client_study_001
npm run reply:approve -- --client_id client_study_001 --reply_draft_id reply_xxx
npm run reply:reject -- --client_id client_study_001 --reply_draft_id reply_xxx
npm run report:daily -- --client_id client_study_001
npm run report:weekly -- --client_id client_study_001
```

## Business Rules

- Content assets cannot be published directly.
- A publish task must reference `variant_id`.
- Content must be approved before scheduling.
- Platform variants must be approved before scheduling or publishing.
- `publish:run` blocks unapproved tasks and unapproved variants.
- Variant generation only uses accounts where `status = active` and `posting_enabled = true`.
- Generated content and generated variants are never auto-approved.
- The same content can fan out to multiple accounts, but each account gets its own `variant_id` and account-aware caption.
- Publish scheduling uses `data/publish-rules.json` for daily caps, minimum spacing, allowed windows, and text-only support.
- Future publishing frequency changes should be collected by OpenClaw from Jason first, then written into `data/publish-rules.json`.
- Publish readiness checks `data/platform-capabilities.json` before scheduling and running tasks.
- Platform capability values can be `true`, `false`, or `limited`.
- `limited` publishing capabilities are marked `needs_manual_review` or blocked with a clear reason instead of being forced through.
- `supports_real_api = false` means the action must use mock or manual workflow.
- Tasks that fail readiness checks are marked `blocked` with `blocked_reason`.
- Cancelled, blocked, and already-published tasks are not published by `publish:run`.
- Publish tasks include retry metadata: `retry_count`, `max_retry`, `last_error`, and `next_retry_at`.
- Leads include follow-up metadata: `lead_stage`, `assigned_to`, `next_follow_up_at`, `last_contacted_at`, `contact_method`, and `lead_notes`.
- Lead scoring uses `data/lead-scoring-rules.json` by client category.
- Lead import checks account ownership, `lead_tracking_enabled`, account status, and platform comment/DM read capability.
- Leads include `source_mode: api | manual | mock | csv`; unsupported API reads can still be imported manually.
- Publish records include `publish_mode: mock | api | manual`.
- Reply drafts are generated for human review only. `approved` means ready for manual copy/use, not sent by the system.
- The system does not auto-reply or auto-send DMs in this stage.
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
  "capability_override": {},
  "notes": "",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

`capability_override` lets a single account override the platform default capability. Example:

```json
{
  "can_read_comments": false,
  "can_publish_draft": true
}
```

## Platform Capability Layer

`data/platform-capabilities.json` defines the default capabilities for:

```text
instagram, tiktok, facebook, x, linkedin, youtube
```

Each platform defines:

```json
{
  "can_publish_text": true,
  "can_publish_image": "limited",
  "can_publish_video": "limited",
  "can_publish_carousel": false,
  "can_publish_story": false,
  "can_publish_reel": "limited",
  "can_publish_draft": true,
  "can_read_comments": "limited",
  "can_read_dm": false,
  "can_fetch_analytics": "limited",
  "can_auto_reply": false,
  "supports_mock": true,
  "supports_real_api": "limited",
  "requires_oauth": true,
  "requires_app_review": true,
  "requires_business_account": true,
  "requires_human_review": true,
  "notes": "Permission-gated platform capability notes."
}
```

The capability layer is used by:

- `publish:schedule`
- `publish:schedule:batch`
- `publish:run`
- `lead:import`
- Web UI Platform Capabilities page
- Web UI account capability status

This keeps the core workflow stable before real API adapters are added.

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
data/platform-capabilities.json
data/platform-style-rules.json
data/publish-rules.json
data/lead-scoring-rules.json
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

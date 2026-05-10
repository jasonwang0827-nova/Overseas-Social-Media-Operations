# Social Ops Hub

Overseas Social Media Operations & Lead Management Hub.

This MVP is organized around:

```text
Client -> Business Category -> Target Audience -> Content Strategy -> Platform Accounts -> Content Pool -> Publish Queue -> Lead Management
```

The first version uses local JSON files under `data/clients/<client_id>/` and mock publishers for Facebook, Instagram, TikTok, and X. X also has a controlled official API adapter for text-only publishing. YouTube is reserved as an adapter folder only.

Global client category templates live in `data/categories.json` and are copied into each client directory as `categories.json`.
Platform writing rules live in `data/platform-style-rules.json` so one content asset can become different account-specific variants.
Platform capability rules live in `data/platform-capabilities.json` so the system can decide whether an action should use API, mock, or manual workflow before publishing or importing leads.
X API credentials can be stored locally in `XAPI.env`; this file is ignored by Git and should never be committed.

## Quick Start

```bash
npm install
npm run demo:seed
npm run demo:e2e
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
npm run demo:e2e
```

## X API Adapter

The X adapter supports credential checks, dry-run publishing, and controlled live text publishing through `POST /2/tweets`.

Safe mode is the default:

Create a local `XAPI.env` file:

```bash
X_API_KEY=your_consumer_key
X_API_KEY_SECRET=your_consumer_secret
X_ACCESS_TOKEN=your_access_token
X_ACCESS_TOKEN_SECRET=your_access_token_secret
X_API_DRY_RUN=true
```

Dry-run test:

```bash
npm run x:publish:dry-run
```

Live test, after setting `X_API_DRY_RUN=false` or allowing the script to override it for this command:

```bash
npm run x:publish:live -- --confirm LIVE
```

The live command prepares one short, safe, approved X text variant under `client_demo_001`, then publishes only that task. It refuses live publishing unless the command includes `--confirm LIVE`.

Official API publishing is blocked unless all of these are true:

- Content asset is approved.
- Platform variant is approved and has `status = approved`.
- Publish task is scheduled.
- Account platform is `x`.
- Account `auth_status = connected`.
- Platform/account capability allows real API text publishing.
- `requires_human_review = false`.

Successful live X records store the returned X post ID plus `post_url` in `publish-records.json`. Failed attempts update `last_error`, `retry_count`, and `next_retry_at`; readiness failures are marked `blocked` with `blocked_reason`.

This phase does not implement auto-reply, auto-DM, or real API publishing for Instagram, TikTok, Facebook, LinkedIn, or YouTube.

## X Platform Module

Phase 1 is feature-complete but manual-gated. The system can collect, classify, score, and draft, but it must not automatically publish, reply, DM, comment, follow, or unfollow.

Phase roadmap:

- Phase 1: full features, manual actions. Search, KOL discovery, lead discovery, mentions, DM reading when permissions allow, dry-run publishing, and manual-approved publishing.
- Phase 2: semi-automation. Scheduled KOL search, scheduled lead search, automatic scoring, automatic draft generation, human confirmation.
- Phase 3: low-risk automation. Auto-publish already-approved content, auto-generate reports, auto-remind follow-ups, auto-archive low-value leads.
- Phase 4: high-risk automation. Auto-reply, auto-DM, auto-comment, and auto-follow only after explicit enablement and review.

X module commands:

```bash
npm run x:research:search -- --client_id client_demo_001 --mode mock
npm run x:kol:discover -- --client_id client_demo_001 --mode mock
npm run x:competitor:mine -- --client_id client_demo_001 --username competitor_demo --mode mock
npm run x:lead:discover -- --client_id client_demo_001 --mode mock
npm run x:engagement:sync -- --client_id client_demo_001 --mode mock
npm run x:dm:sync -- --client_id client_demo_001 --mode mock
npm run x:report -- --client_id client_demo_001
```

Use `--mode api` on read-only X commands to attempt real X API reads when the account and credentials allow it. API reads use official X endpoints such as recent post search, user lookup, user mentions, and DM events. If permissions are missing, stay in `--mode mock` or manual workflow.

X API cost controls:

- `X_API_DRY_RUN=true` remains the default safe setting for publishing.
- X research/KOL/lead/engagement commands cap post reads at 100 results; KOL discovery defaults to 50.
- X KOL discovery supports `--depth light` and `--depth deep`; light is the default and reads search posts plus candidate profiles only, while deep also scores recent posts.
- X KOL deep scoring fetches each candidate profile plus recent posts, defaults to 25 recent posts per author, and saves only prospects above the threshold.
- X lead discovery scores buyer intent, industry match, urgency, negative/spam risk, and reply value before saving candidates and draft replies.
- Competitor mining only reads the competitor profile and recent posts by default. Followers/following mining is reserved for a later manual-trigger workflow.
- Each client can define `monthly_api_budget`, `budget_warn_at`, `budget_block_at`, `max_cost_per_command`, `default_x_search_limit`, and `default_kol_discovery_limit` in `client.json`.
- Read commands support `--estimate-only` to print and save the projected cost without calling X.
- GET responses are cached for 24 hours under `data/cache/x-api/` to avoid repeat API charges.
- Every X command prints `estimated_cost`, `api_calls`, and `cache_hits`.
- Every X query appends a non-overwriting record to `x-query-history.json` so historical searches can be analyzed later.
- The X Workspace UI includes Budget & Query History so operators can review budget usage, estimate-only runs, and blocked attempts without triggering API calls.
- Detailed operator SOP: `docs/x-platform-sop.md`.

X module data files:

- `x-research-posts.json`: keyword research posts.
- `kol-prospects.json`: KOL prospects from keyword or competitor discovery.
- `lead-candidates.json`: buying-intent or help-intent candidates.
- `x-engagement-inbox.json`: mentions, replies, quote-style interactions, and DM inbox items.
- `x-query-history.json`: append-only query history for research, KOL discovery, competitor mining, leads, engagement, and DM reads.
- `x-api-usage.json`: monthly API usage ledger for budget checks.
- `reports/x/<date>.json`: X-specific daily operating report.

All X outbound automation account settings default to `false`:

```json
{
  "auto_publish_enabled": false,
  "auto_reply_enabled": false,
  "auto_dm_enabled": false,
  "auto_follow_enabled": false,
  "auto_kol_discovery_enabled": false,
  "auto_lead_discovery_enabled": false
}
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
- Publish records include `publish_mode: mock | api | manual` and may include `post_url` for live API posts.
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

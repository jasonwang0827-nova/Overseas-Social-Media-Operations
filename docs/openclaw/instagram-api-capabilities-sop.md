# OpenClaw SOP: Instagram API Capabilities

Use this document to understand what the current Social Ops Hub Instagram integration can do, what it cannot do through the official API, and which additional Instagram Graph API features can support business workflows.

## Current Account

```text
client_id: client_brand_001
account_id: ig_brand_001
Instagram username: zevaro.f4f
IG Business Account ID: 17841422772389367
Connected Facebook Page: OverseasSocial
Page ID: 1106487942548106
```

Instagram Business Account authorization is done through Meta/Facebook OAuth because Instagram Graph API is managed through Meta Pages.

## Implemented In Social Ops Hub

### 1. Account Binding

Purpose:

```text
Connect a customer IG Business account to Social Ops Hub.
```

Implemented flow:

```text
Connect Meta -> Facebook/Meta OAuth -> /me/accounts -> Page -> instagram_business_account -> write account binding
```

Stores:

```text
page_id
page_name
instagram_business_account_id
instagram_username
permissions
token_ref
token_status
setup_status
```

Token storage:

```text
data/token-vault/meta/
```

Do not print or share token vault files.

### 2. Account Check

Command:

```bash
npm run ig:account:check -- --client_id client_brand_001 --account_id ig_brand_001 --live_probe
```

What it verifies:

```text
token exists
IG user ID exists
connected Page ID exists
live profile can be read
username matches expected account
```

Business use:

```text
Daily account health check
Pre-publish readiness check
Confirm customer account is still connected
```

### 3. R2 Media Upload For IG Publishing

Endpoint:

```text
POST /api/media/r2-upload
```

What it does:

```text
local media file -> Cloudflare R2 -> public media URL
```

Business use:

```text
Turn local images/videos into Meta-fetchable URLs
Prepare media assets for IG publishing
Standardize media storage by client/platform/date
```

### 4. Image Publish

Command:

```bash
npm run ig:publish:image -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --image_url "<PUBLIC_IMAGE_URL>" \
  --caption "<CAPTION>" \
  --confirm LIVE
```

Graph API flow:

```text
POST /{ig_user_id}/media
POST /{ig_user_id}/media_publish
```

Business use:

```text
Product image posts
Brand education posts
Creator/KOL announcement posts
Campaign posts with approved captions
```

### 5. Carousel / Multi-Image Publish

Command:

```bash
npm run ig:publish:carousel -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --image_urls "<PUBLIC_IMAGE_URL_1>,<PUBLIC_IMAGE_URL_2>" \
  --caption "<CAPTION>" \
  --confirm LIVE
```

Graph API flow:

```text
POST /{ig_user_id}/media with is_carousel_item=true for each image
POST /{ig_user_id}/media with media_type=CAROUSEL and children
POST /{ig_user_id}/media_publish
```

Business use:

```text
Product carousels
Before/after sets
Multi-angle product posts
Education posts split across slides
Campaign posts with 2-10 approved images
```

### 6. Video / Reels Publish

Command:

```bash
npm run ig:publish:video -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --video_url "<PUBLIC_VIDEO_URL>" \
  --media_type REELS \
  --caption "<CAPTION>" \
  --confirm LIVE
```

Graph API flow:

```text
POST /{ig_user_id}/media
POST /{ig_user_id}/media_publish
```

Business use:

```text
Reels publishing
Short product demo videos
Creator-style education clips
Campaign videos
```

Important:

```text
Meta may reject media during content review. Do not bypass platform review.
```

### 7. Comment List

Command:

```bash
npm run ig:comments:list -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --media_id "<IG_MEDIA_ID>"
```

Reads:

```text
comment id
comment text
username
timestamp
like_count
replies
```

Business use:

```text
Lead detection from comments
Customer support triage
FAQ discovery
Identify high-intent comments
Build reply drafts
```

### 8. Public Comment Reply

Command:

```bash
npm run ig:comment:reply -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --comment_id "<COMMENT_ID>" \
  --message "<REPLY>" \
  --confirm LIVE
```

Business use:

```text
Publicly answer product questions
Move users to DM where policy allows
Acknowledge customer feedback
Maintain engagement on posts
```

Recommended guardrail:

```text
Generate reply draft -> Jason/operator approval -> live reply
```

### 8. Private Reply To Comment

Command:

```bash
npm run ig:private-reply -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --comment_id "<COMMENT_ID>" \
  --message "<PRIVATE_REPLY>" \
  --confirm LIVE
```

Business use:

```text
Move qualified commenters into private conversation
Send product details when comment context allows
Follow up without exposing sensitive details publicly
```

Limit:

```text
Requires valid comment context and Meta messaging rules.
```

### 9. DM Send

Command:

```bash
npm run ig:dm:send -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --recipient_id "<IG_SCOPED_USER_ID>" \
  --message "<MESSAGE>" \
  --confirm LIVE
```

Business use:

```text
Continue conversations with users who have valid messaging context
Send approved customer support or lead follow-up replies
```

Limit:

```text
Requires a Meta-scoped recipient ID and allowed messaging window/context.
Cannot cold-DM arbitrary IG usernames.
```

### 10. Like Object

Command:

```bash
npm run ig:like -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --object_id "<MEDIA_OR_COMMENT_ID>" \
  --confirm LIVE
```

Business use:

```text
Like comments or media where official API permits it
Low-friction engagement action after review
```

## Current Official API Limits

These are not implemented because the official Instagram Graph API does not expose them for this use case:

```text
Follow/unfollow users
Cold-DM arbitrary usernames
Read hidden/private content without authorization
Bypass Meta content review
Bypass platform adult/sensitive content rules
Scrape Instagram like a browser/mobile app
```

Do not use private mobile automation or browser automation to bypass these limits.

## Business Workflows We Can Build Next

### A. Media Library

Goal:

```text
Track uploaded R2 media and whether each asset was used/published.
```

Useful fields:

```text
media_asset_id
client_id
platform
r2_key
public_url
content_type
size
uploaded_at
used_at
published_media_id
status: uploaded / published / rejected / archived
```

Business value:

```text
Avoid duplicate publishing
Find reusable approved assets
Clean up unused R2 files
Separate sensitive/rejected assets from approved assets without deleting raw data unless requested
```

### B. Publish Records For IG Live Posts

Goal:

```text
Write every successful IG live publish into publish-records.json, not only audit logs.
```

Business value:

```text
Reports can include real IG post URLs
Operators can see what was actually published
Duplicate detection by media URL and caption
```

### C. Comment Lead Inbox

Goal:

```text
Import IG comments into leads.json or a dedicated IG inbox.
```

Workflow:

```text
comments:list -> classify intent -> score lead -> generate reply draft -> operator approval -> reply/private reply
```

Business value:

```text
Turn post engagement into leads
Prioritize purchase/support questions
Build repeatable comment response workflows
```

### D. Reply Draft Approval Queue

Goal:

```text
Never send replies immediately. Create drafts first.
```

Workflow:

```text
comment -> draft -> approve -> ig:comment:reply or ig:private-reply
```

Business value:

```text
Safer customer communication
Better review for adult-products compliance
Reusable response templates
```

### E. Post Performance Snapshot

Possible API use:

```text
Fetch IG media metrics/insights where permissions allow.
```

Business value:

```text
Identify best-performing content
Compare image vs Reels performance
Build weekly reports
Guide KOL/content strategy
```

### F. Scheduled Publish Queue

Goal:

```text
Use existing publish queue to trigger approved IG posts at scheduled times.
```

Guardrails:

```text
account connected
content approved
variant approved
media URL public
operator/live approval recorded
audit entry written
```

Business value:

```text
Operate a weekly/monthly content calendar
Reduce manual copy/paste
Keep traceable approval history
```

### G. R2 Cleanup Policy

Goal:

```text
Manage R2 storage growth.
```

Options:

```text
Keep all published assets
Delete unpublished temp uploads after N days
Archive rejected video assets
Track storage size by client/platform
```

Business value:

```text
Control R2 costs
Prevent accidental reuse of rejected assets
Maintain asset history for reporting
```

## Recommended Next Implementation Order

1. Media Library records for every R2 upload.
2. Write IG live publish success into `publish-records.json`.
3. Duplicate warning if the same R2 URL was already published.
4. IG comment import into lead inbox.
5. Reply draft approval before public/private replies.
6. Scheduled IG publishing from approved queue.
7. R2 cleanup and storage report.

## OpenClaw Rules

- Use official Graph API only.
- Do not bypass platform review.
- Do not print tokens.
- Do not operate on an account other than `ig_brand_001` unless Jason explicitly says so.
- Do not publish without explicit LIVE confirmation.
- Preserve adult-products business context, but do not attempt to bypass Meta content enforcement.

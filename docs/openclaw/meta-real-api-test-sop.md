# OpenClaw SOP: Meta Real API Test

Use this SOP to guide Jason through real Instagram and Facebook Page API testing.

## Before Testing

1. Open the project:

```bash
cd /Users/jason/Nova/Overseas-Social-Media-Operations
```

2. Confirm local secrets exist:

```bash
ls MetaAPI.env
```

3. Confirm the client and accounts:

```bash
npm run ig:account:check -- --client_id client_brand_001 --account_id ig_brand_001 --live_probe
npm run fb:account:check -- --client_id client_brand_001 --account_id facebook_brand_001 --live_probe
```

Expected:

- Instagram shows `live_profile.username = zevaro.f4f`.
- Facebook shows Page `OverseasSocial`.
- Token values are not printed.

## UI Review

1. Start the UI:

```bash
npm run web:dev
```

2. Open:

```text
http://localhost:4321
```

3. Select `client_brand_001`.
4. Open `Meta Workspace`.
5. Check:

- Facebook Page account is present.
- Instagram account is present.
- Binding IDs are filled.
- Permissions are listed.
- Token status is `configured`.
- The `Meta Real API CLI Test Console` section shows commands.

The Web UI does not execute live Meta writes. Use CLI for live tests.

## Instagram Test Flow

Start with read-only account verification:

```bash
npm run ig:account:check -- --client_id client_brand_001 --account_id ig_brand_001 --live_probe
```

For image publish, use a public direct image URL:

```bash
npm run ig:publish:image -- --client_id client_brand_001 --account_id ig_brand_001 --image_url "<PUBLIC_IMAGE_URL>" --caption "API image test" --confirm LIVE
```

For Reels/video publish, use a public direct MP4 URL:

```bash
npm run ig:publish:video -- --client_id client_brand_001 --account_id ig_brand_001 --video_url "<PUBLIC_VIDEO_URL>" --media_type REELS --caption "API Reels test" --confirm LIVE
```

After publishing, list comments on the returned media ID:

```bash
npm run ig:comments:list -- --client_id client_brand_001 --account_id ig_brand_001 --media_id "<IG_MEDIA_ID>"
```

Reply to a comment only after Jason confirms the exact comment:

```bash
npm run ig:comment:reply -- --client_id client_brand_001 --account_id ig_brand_001 --comment_id "<COMMENT_ID>" --message "Thanks" --confirm LIVE
```

Private reply requires a valid comment context:

```bash
npm run ig:private-reply -- --client_id client_brand_001 --account_id ig_brand_001 --comment_id "<COMMENT_ID>" --message "Sent you details" --confirm LIVE
```

DM requires a Meta-scoped recipient ID and allowed messaging context:

```bash
npm run ig:dm:send -- --client_id client_brand_001 --account_id ig_brand_001 --recipient_id "<IG_SCOPED_USER_ID>" --message "Hi" --confirm LIVE
```

Instagram follow/unfollow is not available through the official API:

```bash
npm run ig:follow:run -- --client_id client_brand_001 --account_id ig_brand_001 --username "<TARGET_USERNAME>"
```

Expected result: blocked audit event explaining the official API limitation.

## Facebook Page Test Flow

Start with read-only account verification:

```bash
npm run fb:account:check -- --client_id client_brand_001 --account_id facebook_brand_001 --live_probe
```

Publish a Page text post:

```bash
npm run fb:publish:post -- --client_id client_brand_001 --account_id facebook_brand_001 --message "API Page test" --confirm LIVE
```

Publish a Page photo:

```bash
npm run fb:publish:photo -- --client_id client_brand_001 --account_id facebook_brand_001 --image_url "<PUBLIC_IMAGE_URL>" --caption "API photo test" --confirm LIVE
```

Publish a Page video:

```bash
npm run fb:publish:video -- --client_id client_brand_001 --account_id facebook_brand_001 --video_url "<PUBLIC_VIDEO_URL>" --description "API video test" --confirm LIVE
```

List comments:

```bash
npm run fb:comments:list -- --client_id client_brand_001 --account_id facebook_brand_001 --object_id "<POST_OR_MEDIA_ID>"
```

Reply to a comment:

```bash
npm run fb:comment:reply -- --client_id client_brand_001 --account_id facebook_brand_001 --comment_id "<COMMENT_ID>" --message "Thanks" --confirm LIVE
```

Private reply requires a valid comment context:

```bash
npm run fb:private-reply -- --client_id client_brand_001 --account_id facebook_brand_001 --comment_id "<COMMENT_ID>" --message "Sent you details" --confirm LIVE
```

DM requires a Page-scoped recipient ID and allowed messaging context:

```bash
npm run fb:dm:send -- --client_id client_brand_001 --account_id facebook_brand_001 --recipient_id "<PAGE_SCOPED_USER_ID>" --message "Hi" --confirm LIVE
```

Facebook user follow/unfollow is not available for Page automation through the official API.

## Public Media URL Rules

Use URLs that Meta can fetch directly:

- Direct HTTPS URL.
- No login.
- No preview page.
- No expiring browser-only cookies.
- Image URL should end or resolve to an image file.
- Video URL should end or resolve to an MP4/MOV file.

Google Drive, iCloud, and Baidu Netdisk links often fail because they are preview/download pages, not direct media files. Use a public object URL from a static host, CDN, Cloudflare R2, S3, or another direct-file host.

## Audit Trail

Successful and blocked actions append records to:

```text
data/clients/client_brand_001/publish-audit-log.json
```

Do not delete audit records during testing.


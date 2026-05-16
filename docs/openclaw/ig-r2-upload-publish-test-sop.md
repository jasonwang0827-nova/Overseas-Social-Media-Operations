# OpenClaw SOP: Instagram R2 Upload Publish Test

Use this SOP when Jason gives OpenClaw a local media file path and asks OpenClaw to pass values into Social Ops Hub for an Instagram publish test.

This SOP is **API/CLI driven**. Do not operate the Web UI unless Jason explicitly asks for a UI walkthrough.

## Operating Mode

Approved mode:

```text
local file path -> Social Ops Hub R2 upload endpoint -> R2 public URL -> IG CLI publish -> verification -> audit check
```

Do not invent a browser workflow. Do not click UI buttons. The system is still the source of truth because all upload and publish calls go through project endpoints/commands.

## Preconditions

Project root:

```bash
cd /Users/jason/Nova/Overseas-Social-Media-Operations
```

Required local config files:

```text
MetaAPI.env
/Users/jason/Nova/R2API.env
```

Do not print or expose secrets. Only verify that required keys are present.

Required Meta account:

```text
client_id: client_brand_001
Instagram account: ig_brand_001
Expected IG username: zevaro.f4f
Expected Page: OverseasSocial
```

Required R2 bucket:

```text
Bucket: zevaro-media
R2 public base URL: configured in /Users/jason/Nova/R2API.env
```

Required input from Jason:

```text
local_media_path
caption
publish_type: image, carousel, or reels
explicit approval to publish LIVE
```

## 1. Verify Local Config

Run:

```bash
node - <<'NODE'
const fs = require('fs');
for (const [label, file, keys] of [
  ['Meta', 'MetaAPI.env', ['META_APP_ID','META_APP_SECRET','META_REDIRECT_URI','META_ACCESS_TOKEN','META_PAGE_ACCESS_TOKEN']],
  ['R2', '/Users/jason/Nova/R2API.env', ['R2_ACCOUNT_ID','R2_S3_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_PUBLIC_BASE_URL']]
]) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  console.log(label);
  for (const key of keys) console.log(`  ${key}: ${env[key] ? 'present' : 'MISSING'}`);
}
NODE
```

Stop if any required key is missing.

## 2. Ensure The Local Web Server Is Running

The R2 upload endpoint is served by the local web server. Start or restart it only if needed.

Check:

```bash
lsof -nP -iTCP:4321 -sTCP:LISTEN
```

If not running from this project, start it:

```bash
npm run web:dev
```

Expected:

```text
Social Ops Hub UI running at http://localhost:4321
```

No browser operation is required.

## 3. Confirm Instagram Binding By CLI

Run:

```bash
npm run ig:account:check -- --client_id client_brand_001 --account_id ig_brand_001 --live_probe
```

Expected:

```text
live_profile.username = zevaro.f4f
ig_user_id = 17841422772389367
page_id = 1106487942548106
has_access_token = true
```

Stop if the account is not connected.

## 4. Upload The Local Media File To R2 Through The System

Use the system endpoint. Replace `<LOCAL_MEDIA_PATH>` with Jason's file path.

For image:

```bash
curl -sS -X POST http://localhost:4321/api/media/r2-upload \
  -F client_id=client_brand_001 \
  -F platform=ig \
  -F file=@"<LOCAL_MEDIA_PATH>" \
  | tee /tmp/social-ops-r2-upload.json
```

For video/Reels:

```bash
curl -sS -X POST http://localhost:4321/api/media/r2-upload \
  -F client_id=client_brand_001 \
  -F platform=ig \
  -F file=@"<LOCAL_MEDIA_PATH>" \
  | tee /tmp/social-ops-r2-upload.json
```

Expected JSON:

```json
{
  "ok": true,
  "url": "https://.../uploads/client_brand_001/ig/...",
  "key": "uploads/client_brand_001/ig/...",
  "content_type": "image/jpeg or video/mp4",
  "size": 12345
}
```

Extract URL:

```bash
R2_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/social-ops-r2-upload.json','utf8')).url)")
echo "$R2_URL"
```

For carousel/multi-image posts, repeat the upload once for each image file and collect 2-10 public image URLs. Store them as a comma-separated list:

```bash
CAROUSEL_URLS="https://.../image-1.jpg,https://.../image-2.jpg"
```

## 5. Verify The R2 URL

Run:

```bash
curl -I "$R2_URL"
```

Expected:

```text
HTTP/2 200
content-type: image/... or video/...
```

Stop if the URL is not public or returns HTML.

## 6. Publish To Instagram By CLI

Only run this step after Jason explicitly approves the exact account, media, caption, and LIVE publish.

For image:

```bash
npm run ig:publish:image -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --image_url "$R2_URL" \
  --caption "<CAPTION>" \
  --confirm LIVE \
  | tee /tmp/social-ops-ig-publish.json
```

For video/Reels:

```bash
npm run ig:publish:video -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --video_url "$R2_URL" \
  --media_type REELS \
  --caption "<CAPTION>" \
  --confirm LIVE \
  | tee /tmp/social-ops-ig-publish.json
```

For carousel/multi-image:

```bash
npm run ig:publish:carousel -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --image_urls "$CAROUSEL_URLS" \
  --caption "<CAPTION>" \
  --confirm LIVE \
  | tee /tmp/social-ops-ig-publish.json
```

Expected success:

```json
{
  "creation_id": "...",
  "media_id": "...",
  "children": ["...", "..."],
  "raw": {
    "id": "..."
  }
}
```

If Meta rejects the media during content review, report the exact API error and do not retry the same media repeatedly.

## 7. Verify Published Media

Extract media ID:

```bash
IG_MEDIA_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/social-ops-ig-publish.json','utf8')).media_id)")
echo "$IG_MEDIA_ID"
```

Query Instagram Graph:

```bash
node - <<'NODE'
const fs = require('fs');
function envFile(f) {
  if (!fs.existsSync(f)) return {};
  const env = {};
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}
(async () => {
  const env = envFile('MetaAPI.env');
  const token = env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN;
  const version = env.META_GRAPH_API_VERSION || 'v25.0';
  const mediaId = process.env.IG_MEDIA_ID;
  const url = new URL(`https://graph.facebook.com/${version}/${mediaId}`);
  url.searchParams.set('fields', 'id,caption,media_type,permalink,timestamp,username');
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const json = await res.json();
  console.log(JSON.stringify({
    ok: res.ok,
    status: res.status,
    id: json.id,
    media_type: json.media_type,
    permalink: json.permalink,
    timestamp: json.timestamp,
    username: json.username,
    error: json.error?.message
  }, null, 2));
})();
NODE
```

Expected:

```text
ok: true
username: zevaro.f4f
permalink: https://www.instagram.com/p/...
```

## 8. Check Comments Read Path

Run:

```bash
npm run ig:comments:list -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --media_id "$IG_MEDIA_ID"
```

This is read-only and does not require `--confirm LIVE`.

## 9. Check Audit Trail

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const mediaId = process.env.IG_MEDIA_ID;
const audit = JSON.parse(fs.readFileSync('data/clients/client_brand_001/publish-audit-log.json', 'utf8'));
const matches = audit.filter((entry) =>
  entry.platform_post_id === mediaId ||
  entry.metadata?.media_id === mediaId ||
  entry.metadata?.result?.media_id === mediaId ||
  entry.metadata?.result?.raw?.id === mediaId
);
console.log(JSON.stringify(matches.map((entry) => ({
  timestamp: entry.timestamp,
  event_type: entry.event_type,
  platform: entry.platform,
  account_id: entry.account_id,
  action: entry.metadata?.automation_action,
  platform_post_id: entry.platform_post_id,
  message: entry.message
})), null, 2));
NODE
```

Expected:

```text
At least one automation_success record for instagram / ig_brand_001.
```

If no audit record exists, report it as a logging defect even if the IG post succeeded.

## Common Errors

### R2API.env Missing

Error:

```text
R2_ACCOUNT_ID is required
```

Fix:

```text
Confirm /Users/jason/Nova/R2API.env exists and has all R2 keys.
```

### R2 Upload Failed

Common causes:

```text
Wrong R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
Wrong R2_S3_ENDPOINT
Wrong R2_BUCKET
Bucket token does not have Object Read & Write
```

### IG Cannot Fetch Media

Common causes:

```text
R2 Public Development URL is not enabled
R2_PUBLIC_BASE_URL is wrong
The URL returns HTML instead of the media file
The video format is not accepted by Instagram
```

### Meta Permission Error

Common causes:

```text
Token lacks instagram_content_publish
IG account is not professional/business
IG account is not connected to the selected Facebook Page
Meta app is still in development and the Facebook user is not an app role user
```

### Meta Content Review Rejection

If video or image is rejected by Meta content review:

```text
Report the rejection.
Do not bypass the platform review.
Do not repeatedly retry the same rejected media.
Use a different approved test asset if Jason wants another test.
```

## Safety Rules

- Do not publish unless Jason explicitly confirms LIVE.
- Do not paste tokens into chat.
- Do not print `MetaAPI.env`, `/Users/jason/Nova/R2API.env`, or token vault files.
- Do not use adult/sensitive filtering in local analysis; publish only the exact test media Jason selects.
- Do not use Instagram follow/unfollow automation. Official Instagram Graph API does not expose it.
- Do not operate Web UI unless Jason explicitly asks for UI testing.

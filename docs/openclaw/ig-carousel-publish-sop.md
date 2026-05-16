# OpenClaw SOP: Instagram Carousel Publish

Use this SOP when Jason asks OpenClaw to publish one Instagram multi-image post through Social Ops Hub.

This is an API/CLI workflow. Do not operate the Web UI unless Jason explicitly asks for UI testing.

## Goal

```text
local image files -> Social Ops Hub R2 upload endpoint -> public R2 image URLs -> ig:publish:carousel -> verify post -> audit check
```

## Preconditions

Project root:

```bash
cd /Users/jason/Nova/Overseas-Social-Media-Operations
```

Required files:

```text
MetaAPI.env
/Users/jason/Nova/R2API.env
```

Required account:

```text
client_id: client_brand_001
account_id: ig_brand_001
expected IG username: zevaro.f4f
```

Required input from Jason:

```text
2-10 local image file paths
caption
explicit approval to publish LIVE
```

Do not print access tokens, app secrets, or R2 secrets.

## 1. Confirm Config Exists

Run:

```bash
node - <<'NODE'
const fs = require('fs');
for (const [label, file, keys] of [
  ['Meta', 'MetaAPI.env', ['META_APP_ID','META_APP_SECRET','META_REDIRECT_URI']],
  ['R2', '/Users/jason/Nova/R2API.env', ['R2_ACCOUNT_ID','R2_S3_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_PUBLIC_BASE_URL']]
]) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  console.log(label);
  for (const key of keys) console.log(`  ${key}: ${raw.includes(`${key}=`) ? 'present' : 'MISSING'}`);
}
NODE
```

Stop if any required config is missing.

## 2. Start Local Endpoint If Needed

Check:

```bash
lsof -nP -iTCP:4321 -sTCP:LISTEN
```

If the Social Ops Hub server is not running:

```bash
npm run web:dev
```

Expected:

```text
Social Ops Hub UI running at http://localhost:4321
```

No browser action is required.

## 3. Verify Instagram Binding

Run:

```bash
npm run ig:account:check -- --client_id client_brand_001 --account_id ig_brand_001 --live_probe
```

Expected:

```text
live_profile.username = zevaro.f4f
ig_user_id present
page_id present
has_access_token = true
```

Stop if the wrong IG account is connected.

## 4. Upload Each Image To R2

Carousel supports 2-10 images. Replace the file paths below with Jason's actual local files.

```bash
IMAGE_FILES=(
  "/absolute/path/image-1.jpg"
  "/absolute/path/image-2.jpg"
)

rm -f /tmp/social-ops-carousel-urls.txt
for file in "${IMAGE_FILES[@]}"; do
  curl -sS -X POST http://localhost:4321/api/media/r2-upload \
    -F client_id=client_brand_001 \
    -F platform=ig \
    -F file=@"$file" \
    | tee /tmp/social-ops-r2-upload-one.json

  node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/social-ops-r2-upload-one.json','utf8')); if(!j.ok||!j.url) throw new Error(JSON.stringify(j)); console.log(j.url)" \
    >> /tmp/social-ops-carousel-urls.txt
done
```

Build the comma-separated URL list:

```bash
CAROUSEL_URLS=$(paste -sd, /tmp/social-ops-carousel-urls.txt)
echo "$CAROUSEL_URLS"
```

## 5. Verify Public URLs

Run:

```bash
while read -r url; do
  echo "Checking $url"
  curl -I "$url"
done < /tmp/social-ops-carousel-urls.txt
```

Expected for every URL:

```text
HTTP/2 200
content-type: image/...
```

Stop if any URL is not public or returns HTML.

## 6. Publish Carousel

Only run after Jason explicitly approves LIVE publishing.

```bash
npm run ig:publish:carousel -- \
  --client_id client_brand_001 \
  --account_id ig_brand_001 \
  --image_urls "$CAROUSEL_URLS" \
  --caption "<CAPTION>" \
  --confirm LIVE \
  | tee /tmp/social-ops-ig-carousel-publish.json
```

Expected:

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

If Meta rejects a media item, report the exact API error. Do not repeatedly retry the same rejected file.

## 7. Verify Published Post

Extract media ID:

```bash
IG_MEDIA_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/social-ops-ig-carousel-publish.json','utf8')).media_id)")
echo "$IG_MEDIA_ID"
```

Query the post:

```bash
node - <<'NODE'
const fs = require('fs');
function envFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
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
media_type: CAROUSEL_ALBUM
username: zevaro.f4f
permalink: https://www.instagram.com/p/...
```

## 8. Check Audit

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const mediaId = process.env.IG_MEDIA_ID;
const audit = JSON.parse(fs.readFileSync('data/clients/client_brand_001/publish-audit-log.json', 'utf8'));
const matches = audit.filter((entry) =>
  entry.platform_post_id === mediaId ||
  entry.metadata?.media_id === mediaId
);
console.log(JSON.stringify(matches.slice(-3), null, 2));
NODE
```

Expected:

```text
event_type: automation_success
action: ig_publish_carousel
platform: instagram
```

## Rules

- Use only image files for carousel.
- Use 2-10 images.
- Do not publish without Jason's explicit LIVE approval.
- Do not operate the Web UI unless Jason asks for UI testing.
- Do not print secrets.
- Do not bypass Meta platform review.

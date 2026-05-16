# X Media Finder SOP

Purpose: scan a public X account for recent posts that contain photos or short videos for client review.

This SOP is designed for requests like: "For client zevaro, scan @ChechikTv and find posts with photos or videos under 3 minutes."

## 1. Safety Rules

- Do not auto-follow from the media finder. If Jason explicitly asks to follow, use the separate gated `x:follow:run` workflow.
- Do not auto-like, auto-repost, auto-comment, or auto-DM.
- Do not download or reuse media automatically.
- Save links and metadata for human review.
- Use `--estimate-only` before API mode when possible.
- Respect client budget guardrails.

## 2. Command

Mock test:

```bash
npm run x:media:scan -- --client_id client_demo_001 --username ChechikTv --max_video_seconds 180 --mode mock
```

API estimate:

```bash
npm run x:media:scan -- --client_id client_brand_001 --username ChechikTv --max_video_seconds 180 --mode api --estimate-only
```

API run:

```bash
npm run x:media:scan -- --client_id client_brand_001 --username ChechikTv --max_video_seconds 180 --mode api
```

Optional limit:

```bash
npm run x:media:fetch -- --client_id client_brand_001 --username ChechikTv --limit 100 --max_video_seconds 180 --mode api
```

## 3. Output File

Results are saved to:

```text
data/clients/<client_id>/x-media-posts.json
```

Each result includes:

- source username
- post text
- post URL
- media type
- photo URL when available
- video preview image when available
- video duration in milliseconds when available
- whether the video is under the configured limit
- public metrics
- review status

## 4. What Counts As A Match

A post is saved if it has:

- at least one photo, or
- at least one video / animated GIF; `duration_ms` is saved for reference only and does not exclude the post. Adult or sensitive-labeled media is not excluded.

Videos longer than the limit are ignored unless the same post also contains a photo.

## 5. Operator Workflow

1. Run estimate-only.
2. If budget is acceptable, run API mode.
3. Open `x-media-posts.json`.
4. Review `post_url`, `text`, `media`, and `duration_ms`.
5. Manually decide whether the client should follow, save, reference, or ignore the post.
6. Do not reuse media without permission or client approval.

## 6. Known Limits

- X may not return all media fields for every post.
- Some videos may not expose direct downloadable URLs.
- Private, restricted, deleted, or sensitive posts may be unavailable.
- The system records media metadata and links; it does not guarantee media download.

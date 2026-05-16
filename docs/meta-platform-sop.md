# Meta Platform Foundation SOP

This SOP covers the shared Meta foundation for Facebook Page and Instagram. The Web UI is setup, validation, dry-run, mock, manual workflow, and CLI command display only. Instagram and Facebook Page real API testing is available through gated CLI commands.

## Safety Rules

- Do not perform real Facebook or Instagram publishing from the Web UI.
- Instagram and Facebook Page CLI write tests require `--confirm LIVE`.
- Instagram follow/unfollow is not supported by the official Meta Instagram Graph API.
- Do not auto-reply, auto-DM, auto-comment, auto-follow, or auto-message without the explicit gated CLI command for that action.
- Do not treat a dry-run preview as a real published post.
- Do not commit `MetaAPI.env`, access tokens, app secrets, Page tokens, or IG tokens.
- Use the X module as the safety model: review first, dry-run next, manual or CLI live test only after explicit approval. Web UI live publish is not available.

## Core Files

OpenClaw should read these before guiding setup:

```text
data/meta-platform-foundation.json
data/platform-capabilities.json
docs/meta-env-template.md
docs/meta-platform-sop.md
data/clients/<client_id>/accounts.json
data/clients/<client_id>/platform-variants.json
data/clients/<client_id>/publish-queue.json
```

## Account Model

Facebook and Instagram use a shared Meta foundation, but they are not the same account object.

Facebook Page account should include:

```json
{
  "platform": "facebook",
  "auth_status": "mock",
  "meta_binding": {
    "page_id": "future_page_id",
    "page_name": "Future Page Name",
    "permissions": [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "pages_manage_metadata"
    ],
    "token_status": "not_configured",
    "setup_status": "ready_for_mock"
  }
}
```

Instagram account should include:

```json
{
  "platform": "instagram",
  "auth_status": "mock",
  "meta_binding": {
    "instagram_business_account_id": "future_ig_user_id",
    "instagram_username": "future_username",
    "connected_facebook_page_id": "future_page_id",
    "permissions": [
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_comments",
      "pages_show_list",
      "pages_read_engagement"
    ],
    "token_status": "not_configured",
    "setup_status": "ready_for_mock"
  }
}
```

For demos, `auth_status: mock` is acceptable. For real API tests, use `auth_status: connected` and `meta_binding.token_status: configured`.

## Daily Operator Workflow

1. Select the client.
2. Confirm whether the target account is Facebook Page or Instagram.
3. Run setup status:

```bash
npm run meta:setup:status
```

4. Run account check:

```bash
npm run meta:account:check -- --client_id client_demo_001 --account_id facebook_demo_001
```

5. If the account check says bindings are missing, fill the `meta_binding` fields in `accounts.json`.
6. Confirm the content and variant are approved.
7. Run a dry-run preview:

```bash
npm run meta:publish:dry-run -- --client_id client_demo_001 --variant_id variant_facebook_demo_001
```

8. Review the endpoint preview and payload preview.
9. If the post is published manually outside the system, record it manually through the existing publish workflow.
10. For real API tests, switch to the gated CLI commands and require Jason to confirm the target account, caption, media URL, and `--confirm LIVE`.

## Facebook Page CLI Live-Test Phase

Allowed:

```text
mock publish
dry-run payload preview
manual completion record
manual comment import
CLI Page post/photo/video publish
CLI comment reply/private reply/DM/like
```

Reserved for later:

```text
insights via Graph API
webhooks
Web UI live publish
```

## Instagram CLI Live-Test Phase

Allowed:

```text
mock publish
dry-run media container preview
manual completion record
manual comment import
CLI image/Reels/video publish
CLI comment reply/private reply/DM/like
```

Reserved for later:

```text
insights via Graph API
webhooks
Web UI live publish
```

## Meta Env Setup

When Jason is ready, create:

```text
MetaAPI.env
```

Use:

```text
docs/meta-env-template.md
```

Mock and dry-run checks do not require real tokens. Real CLI tests require local tokens.

## OpenClaw Must Ask Before Any Future API Work

Before any future real API action, OpenClaw must ask:

```text
Is this Facebook Page or Instagram?
Is this a test account or a real client account?
Has Jason confirmed the final caption/media?
Are Meta permissions approved?
Is the token from a local ignored env file?
Are we in dry-run/manual mode, or has Jason explicitly approved a CLI live test?
```

If the answer is unclear, stop.

## Hard Stops

Stop immediately if:

```text
account is inactive
posting_enabled is false
content is not approved
variant is not approved
meta_binding is missing required fields
token file would be committed
the user asks for ungated Meta auto-DM, auto-reply, auto-comment, or auto-follow. X auto-follow is handled by the separate gated X CLI workflow.
```

## Verification Commands

```bash
npm run meta:setup:status
npm run meta:account:check -- --client_id client_demo_001 --account_id facebook_demo_001
npm run meta:account:check -- --client_id client_demo_001 --account_id ig_demo_001
npm run typecheck
```

Expected result:

```text
No real Meta Graph API request is made.
No Facebook or Instagram post is created.
Any missing bindings are shown as next steps.
```

For real API tests, use the dedicated OpenClaw SOP:

```text
docs/openclaw/meta-real-api-test-sop.md
```


## Instagram Real API CLI Test Commands

Use these only with a local `MetaAPI.env` and an Instagram professional account connected to a Facebook Page. Write actions require `--confirm LIVE`.

```bash
npm run ig:account:check -- --client_id <client_id> --account_id <ig_account_id> --live_probe
npm run ig:publish:image -- --client_id <client_id> --account_id <ig_account_id> --image_url <public_image_url> --caption "test" --confirm LIVE
npm run ig:publish:video -- --client_id <client_id> --account_id <ig_account_id> --video_url <public_video_url> --media_type REELS --caption "test" --confirm LIVE
npm run ig:comments:list -- --client_id <client_id> --account_id <ig_account_id> --media_id <ig_media_id>
npm run ig:comment:reply -- --client_id <client_id> --account_id <ig_account_id> --comment_id <comment_id> --message "Thanks" --confirm LIVE
npm run ig:private-reply -- --client_id <client_id> --account_id <ig_account_id> --comment_id <comment_id> --message "Sent you details" --confirm LIVE
npm run ig:dm:send -- --client_id <client_id> --account_id <ig_account_id> --recipient_id <ig_scoped_user_id> --message "Hi" --confirm LIVE
npm run ig:like -- --client_id <client_id> --account_id <ig_account_id> --object_id <media_or_comment_id> --confirm LIVE
```

If Jason asks for Instagram follow/unfollow, report that the official Meta Instagram Graph API does not expose a follow/unfollow endpoint. Do not use private or mobile automation for this.

## Facebook Page Real API CLI Test Commands

Use these only with a local `MetaAPI.env` and a Page access token. Write actions require `--confirm LIVE`.

```bash
npm run fb:account:check -- --client_id <client_id> --account_id <facebook_account_id> --live_probe
npm run fb:publish:post -- --client_id <client_id> --account_id <facebook_account_id> --message "test" --confirm LIVE
npm run fb:publish:photo -- --client_id <client_id> --account_id <facebook_account_id> --image_url <public_image_url> --caption "test" --confirm LIVE
npm run fb:publish:video -- --client_id <client_id> --account_id <facebook_account_id> --video_url <public_video_url> --description "test" --confirm LIVE
npm run fb:comments:list -- --client_id <client_id> --account_id <facebook_account_id> --object_id <post_or_photo_or_video_id>
npm run fb:comment:reply -- --client_id <client_id> --account_id <facebook_account_id> --comment_id <comment_id> --message "Thanks" --confirm LIVE
npm run fb:private-reply -- --client_id <client_id> --account_id <facebook_account_id> --comment_id <comment_id> --message "Sent you details" --confirm LIVE
npm run fb:dm:send -- --client_id <client_id> --account_id <facebook_account_id> --recipient_id <page_scoped_user_id> --message "Hi" --confirm LIVE
npm run fb:like -- --client_id <client_id> --account_id <facebook_account_id> --object_id <post_or_comment_id> --confirm LIVE
```

Facebook user follow/unfollow is not supported for Page automation by the official Meta Graph API. Do not use private or browser automation for this.

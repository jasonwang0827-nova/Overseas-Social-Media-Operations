# Development Log

## 2026-05-15 Meta Real API Test Layer

Scope:

- Added gated Instagram Graph API CLI tests for account check, image publish, video/Reels publish, comment list, comment reply, private reply, DM send, and like.
- Added gated Facebook Page Graph API CLI tests for account check, text post, photo publish, video publish, comment list, comment reply, private reply, DM send, and like.
- Bound `client_brand_001` to the real Meta Page and Instagram professional account:
  - Facebook Page ID: `1106487942548106`
  - Instagram Business Account ID: `17841422772389367`
  - Instagram username: `zevaro.f4f`
- Updated the Meta Workspace UI to show account bindings, permission status, dry-run previews, manual workflow status, and CLI live-test commands.
- Kept Web UI live publishing disabled. Real writes are CLI-only and require `--confirm LIVE`.
- Updated Meta foundation config from setup-only to `phase_1_meta_cli_live_test`.

Verified commands:

```bash
npm run ig:account:check -- --client_id client_brand_001 --account_id ig_brand_001 --live_probe
npm run fb:account:check -- --client_id client_brand_001 --account_id facebook_brand_001 --live_probe
npm run typecheck
```

Operational notes:

- Meta tokens stay in `MetaAPI.env`; the UI only shows whether required keys are present.
- Instagram follow/unfollow is not exposed by the official Meta Instagram Graph API.
- Facebook Page automation cannot follow users through the official Graph API.
- Public media URLs are required for IG/FB media publish tests. Google Drive, iCloud, and Baidu links are usually not reliable direct media URLs unless they resolve to a public downloadable file without login, redirect, or preview page.


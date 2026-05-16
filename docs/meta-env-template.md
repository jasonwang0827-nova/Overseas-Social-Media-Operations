# Meta Local Env Template

Create a local file named `MetaAPI.env` in the project root when you are ready to configure Meta credentials.

Do not commit `MetaAPI.env`.

```bash
# Shared Meta app settings
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
META_BUSINESS_ID=
META_FACEBOOK_PAGE_ID=
META_INSTAGRAM_BUSINESS_ACCOUNT_ID=

# Real IG/Facebook CLI test fields. Web UI live actions remain disabled.
META_REDIRECT_URI=http://localhost:4321/auth/meta/callback
META_GRAPH_API_VERSION=v25.0
META_USER_ACCESS_TOKEN=
META_PAGE_ACCESS_TOKEN=
META_PAGE_ID=
META_IG_USER_ID=
```

Meta live-test rule:

```text
Keep tokens local. Web UI uses mock, dry-run, and manual workflows only.
Instagram and Facebook Page real API tests are CLI-only and require `--confirm LIVE` for writes. Instagram follow/unfollow is not exposed by the official Meta Instagram Graph API. Facebook Page automation cannot follow users through the official Graph API.
```

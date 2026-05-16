# X Account OAuth Binding SOP

Purpose: make sure Social Ops Hub never performs follow, DM, comment, or live publish actions from the wrong X account.

## 1. Core Rule

One X Developer App can be shared, but each customer X account must authorize separately.

```text
App credentials: global
User access token: per X account
```

`XAPI.env` may contain app-level credentials and the app bearer token for public read operations. It must not be treated as the token for every customer account.

## 2. What Can Use Global Bearer Token

Allowed with global app/bearer credentials:

- public post search
- public user lookup
- public media scan
- public KOL discovery
- read-only research workflows

These operations do not act as a customer account.

## 3. What Requires Account-Level OAuth

These actions require the customer's own X account token:

- follow / unfollow
- DM read/write when acting as that account
- comment / reply
- like / repost
- live publish as that account

Example:

```text
If Zevaro wants @zevarof4f to follow @lanarhoades,
Social Ops Hub must use @zevarof4f's user token,
not Jason's @zhenyu271733 token.
```

## 4. Token Vault Location

Store account-level X tokens in:

```text
data/token-vault/x/<account_id>.json
```

Example:

```text
data/token-vault/x/x_brand_001.json
```

The token file should contain the authorized account username, user id, access token, refresh token or token secret, scopes, and expiry when applicable.

Do not commit token files to Git.

## 5. Account Binding Fields

Each X account in `accounts.json` should include or receive:

```json
{
  "platform": "x",
  "account_id": "x_brand_001",
  "account_name": "zevarof4f",
  "auth_status": "disconnected",
  "x_binding": {
    "x_username": "zevarof4f",
    "token_ref": "x_brand_001",
    "token_status": "not_configured",
    "setup_status": "needs_x_oauth",
    "scopes": []
  }
}
```

## 6. Check Command

Before using the UI connect flow, `XAPI.env` must include OAuth 2.0 app credentials:

```bash
X_CLIENT_ID=your_oauth2_client_id
X_CLIENT_SECRET=your_oauth2_client_secret
X_OAUTH_REDIRECT_URI=http://localhost:4321/auth/x/callback
```

In X Developer Console, the callback / redirect URL must exactly match:

```text
http://localhost:4321/auth/x/callback
```

`X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` are OAuth 1.0a credentials and are not enough for the customer-account connect button.

Run:

```bash
npm run x:account:check -- --client_id client_brand_001 --account_id x_brand_001
```

Expected before OAuth:

```text
token_exists=false
token_status=not_configured
setup_status=needs_x_oauth
can_follow_as_user=false
can_dm_as_user=false
```

Expected after OAuth with correct scopes:

```text
token_exists=true
token_status=configured
setup_status=ready_for_write
can_follow_as_user=true
```

## 7. UI Check

Open:

```text
平台账号 -> X account -> 检查 X 授权
```

To connect a customer X account:

```text
平台账号 -> X account -> Connect X
```

Then log in as the customer account, for example `@zevarof4f`.

Important: if X is currently logged in as Jason's personal account, log out or switch accounts first. The system will reject the callback if the authenticated username does not match the account name in Social Ops Hub.

The account list should show:

- authorized X username
- token status
- setup status
- whether follow is possible as that account
- whether DM is possible as that account

## 8. Current Zevaro Status

Zevaro client id:

```text
client_brand_001
```

Zevaro X account:

```text
x_brand_001 / @zevarof4f
```

Current status before OAuth:

```text
needs_x_oauth
```

Meaning: public research can run, but follow/DM/comment/live publish as Zevaro must remain blocked until account OAuth is connected and the required scopes are present. X auto-follow itself is supported by the gated CLI once those requirements are met.

## 9. Do Not Do

- Do not use Jason's personal token for a client account action.
- Do not mark an X account as `connected` unless token vault exists for that account.
- Do not auto-follow unless the gated X auto-follow workflow passes: account OAuth token exists, `follows.write` is present, `automation_settings.auto_follow_enabled=true`, target is approved, and the command includes `--confirm LIVE`.
- Do not store tokens in `accounts.json`.
- Do not commit `data/token-vault/`.

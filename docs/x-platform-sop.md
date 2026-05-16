# X Platform Module SOP

> ⚠️ **面向运营人员的快速安全指南**（非技术人员优先阅读本节）
>
> 1. **Mock 模式 = 安全。** 所有操作都在你本机的 JSON 文件里，不联网、不收费、不发帖。
> 2. **API 模式 = 只读。** 会去 X 读取公开帖子/用户资料。不会自动回复、发 DM、评论或关注。
> 3. **estimated_cost = 内部估算单位。** 不是 X API 官方给你的账单，只是用来做预算参考的分数值。
> 4. **Live 发布只能在命令行(CLI)做，不能在 UI 里触发。** 必须加 `--confirm LIVE` 才会执行。
> 5. **所有「生成回复草稿」按钮 = 只生成文本，不会自动发出。** 草稿需要你手动复制去发。
>
> ---
>
## 这个模块默认手动控制。它可以收集、分类、评分、生成草稿。X 自动关注已经支持，但默认阻断；只有在账号 `automation_settings.auto_follow_enabled=true`、目标已人工批准、账号 OAuth token 有 `follows.write`、并且 live 命令带 `--confirm LIVE` 时才允许执行。自动回复、自动 DM、自动评论仍需单独实现和审核。

## Safe Operating Modes

- Use `--mode mock` for normal demos and UI checks. **(推荐：非技术人员始终用这个模式)**
- Use `--estimate-only` before any `--mode api` read command — 可预览费用但不触发真实 API 调用。
- Keep `X_API_DRY_RUN=true` as the default publish setting.
- Run live publishing/following only on a dedicated approved X account and only with `--confirm LIVE`.
> **牢记：`estimated_cost` 是内部估算单位，不是美元金额，不代表 X API 官方账单。**

## Budget Guardrails

Each `client.json` can define:

- `monthly_api_budget`
- `budget_warn_at`
- `budget_block_at`
- `max_cost_per_command`
- `default_x_search_limit`
- `default_kol_discovery_limit`

The UI reads `x-api-usage.json` and `x-query-history.json` to show budget usage, remaining budget, estimate-only runs, and blocked attempts.

## X Workspace

Use the X Workspace to operate existing local JSON files:

- Publish Review: review X variants, X publish queue tasks, dry-run previews, and local/manual publish records. Live publishing is not available in the Web UI.
- Research Posts: review `x-research-posts.json`, mark relevant/irrelevant, or save a post as a draft content idea.
- KOL Prospects: review `kol-prospects.json`, sort by score/priority, update collaboration status, and add notes.
- Lead Candidates: review `lead-candidates.json`, convert qualified candidates to `leads.json`, generate reply drafts, or mark items handled/irrelevant.
- Engagement Inbox: review `x-engagement-inbox.json`, update classification, convert items to leads, generate reply drafts, or mark handled.
- Reports: review `reports/x/<date>.json` plus current local budget and usage summary.

Publish Review actions are manual-gated:

- `Generate dry-run preview` shows the local caption/readiness only and does not call the X API.
- `Mark manual completed` writes a local `publish-records.json` entry with `publish_mode: manual`; it does not call the X API.
- Live publish remains CLI-only and requires `npm run x:publish:live -- --confirm LIVE`.
- Live X follow remains CLI-only and requires `npm run x:follow:run -- --client_id <client_id> --account_id <x_account_id> --username <target> --mode api --approved --confirm LIVE`.


## X Auto-Follow SOP for OpenClaw

X auto-follow is supported only through the gated CLI workflow. OpenClaw should not tell Jason that auto-follow is unsupported. Instead, check the blockers below.

Required command:

```bash
npm run x:follow:run -- --client_id <client_id> --account_id <x_account_id> --username <target_username> --mode api --approved --confirm LIVE
```

Before running live follow, verify:

- `accounts.json` has the X account and `status = active`.
- `automation_settings.auto_follow_enabled = true` for that account.
- `npm run x:account:check -- --client_id <client_id> --account_id <x_account_id>` reports `can_follow_as_user = true`.
- The target is approved. For manual username targets, pass `--approved`; for KOL/lead targets, use an approved `prospect_status` or `candidate_status`.
- The command includes `--confirm LIVE`.

If any check fails, report the specific blocker and do not fall back to “Phase 1 does not support auto-follow.”

Mock test:

```bash
npm run x:follow:run -- --client_id <client_id> --account_id <x_account_id> --username <target_username> --mode mock --approved
```

Results are written to:

```text
data/clients/<client_id>/x-follow-actions.json
data/clients/<client_id>/publish-audit-log.json
```

## X Publishing SOP for OpenClaw

This section is written for OpenClaw to guide Jason through X publishing safely.

### Goal

Publish approved X content only after the content asset, platform variant, account, and publish task are all ready. The Web UI is for review and dry-run preview. Live publishing is never triggered from the Web UI.

### Files OpenClaw Should Read First

```text
docs/x-platform-sop.md
data/clients/<client_id>/client.json
data/clients/<client_id>/accounts.json
data/clients/<client_id>/content-pool.json
data/clients/<client_id>/platform-variants.json
data/clients/<client_id>/publish-queue.json
data/clients/<client_id>/publish-records.json
data/platform-capabilities.json
```

Replace `<client_id>` with the active client, for example:

```text
client_demo_001
```

### Step 1: Confirm The Client And X Account

OpenClaw should ask Jason to confirm:

```text
Which client_id are we publishing for?
Which X account should publish this?
Is this a test account or a real client account?
```

Then check `accounts.json`:

```text
platform must be x
status must be active
posting_enabled must be true
auth_status must be connected for official_api live publishing
```

If `auth_status` is `mock`, `disconnected`, `expired`, or `error`, OpenClaw must not proceed to live publishing.

### Step 2: Confirm Content Approval

Check `content-pool.json`.

The content must have:

```text
status = approved
approved_by_human = true
```

If not approved, stop and ask Jason to review/approve the content first.

### Step 3: Confirm X Variant Approval

Check `platform-variants.json`.

The X variant must have:

```text
platform = x
status = approved
approval_status = approved
account_id = the selected X account
caption is final
```

OpenClaw should read the caption back to Jason before any live publish.

### Step 4: Confirm Publish Queue Task

Check `publish-queue.json`.

The task must have:

```text
platform = x
variant_id = approved X variant
account_id = selected X account
status = scheduled
approval_status = approved
publish_method = mock or official_api
blocked_reason = null
```

If the task is `blocked`, `cancelled`, `failed`, or already `published`, OpenClaw must stop and explain why.

### Step 5: Use Web UI For Review

In the Web UI:

```text
http://localhost:4321/?v=polish
```

Go to:

```text
X 工作台 -> 发布审核
```

Operators may safely click:

```text
生成 dry-run 预览
标记人工已发布
```

Important:

```text
生成 dry-run 预览 = local preview only, no X API call
标记人工已发布 = local JSON record only, no X API call
```

The UI must not be used for live publishing.

### Step 6: Dry-run From CLI

Before any live publish, OpenClaw should run:

```bash
npm run x:publish:dry-run
```

Expected behavior:

```text
No live X API call
No real post created
Logs must clearly say dry-run or no live API call
```

If dry-run fails, do not continue.

### Step 7: Live Publish Safety Gate

Live publish can only be attempted if all of these are true:

```text
X_API_DRY_RUN=false
X OAuth credentials are configured
The X account is a test account or Jason explicitly approves using the real account
content is approved
variant is approved
publish task is scheduled/ready
account auth_status is connected
platform/account capability allows real API publishing
requires_human_review is false
Jason confirms the exact caption
Jason explicitly says: publish live
```

OpenClaw must remind Jason:

```text
This will create a real post on X. Continue only if this is intended.
```

Then the live command is:

```bash
npm run x:publish:live -- --confirm LIVE
```

Do not run this command without Jason's explicit confirmation in the current session.

### Step 8: Verify Publish Record

After live publish or manual completion, check:

```text
data/clients/<client_id>/publish-records.json
```

For live API publish, the record should include:

```text
publish_mode = api
platform_post_id = X returned tweet/post id
post_url = X post URL
published_at = timestamp
```

For manual completion from UI, the record should include:

```text
publish_mode = manual
mock_url = manual://x/<publish_task_id>
published_at = timestamp
```

### Step 9: What OpenClaw Must Never Do

OpenClaw must not:

```text
Run live publish without --confirm LIVE
Change X_API_DRY_RUN=false without telling Jason
Publish unapproved content
Publish unapproved variants
Publish from inactive accounts
Publish from posting_enabled=false accounts
Auto-DM
Auto-reply
Auto-comment
Auto-follow without `automation_settings.auto_follow_enabled=true`, an approved target, a valid account OAuth token with `follows.write`, and `--confirm LIVE`
Treat estimated_cost as an official bill
Commit XAPI.env or any token file
```

### Quick Operator Script

OpenClaw can guide Jason with this checklist:

```text
1. Select client_id.
2. Open X 工作台 -> 发布审核.
3. Check caption, account, status, readiness.
4. Click 生成 dry-run 预览.
5. If the post was manually published outside the system, click 标记人工已发布.
6. If Jason wants real API publish, stop and confirm:
   - Is this the correct X account?
   - Is this the final caption?
   - Is this a test or real account?
   - Did Jason explicitly approve live publishing now?
7. Only after confirmation, run:
   npm run x:publish:live -- --confirm LIVE
8. Verify publish-records.json.
```

## Verification Checklist

Run these before changing X API behavior:

```bash
npm install
npm run demo:seed
npm run demo:e2e
npm run x:publish:dry-run
npm run x:publish:live
npm run x:research:search -- --client_id client_demo_001 --mode mock
npm run x:kol:discover -- --client_id client_demo_001 --mode mock
npm run x:kol:discover -- --client_id client_demo_001 --mode api --depth light --estimate-only
npm run x:lead:discover -- --client_id client_demo_001 --mode mock
npm run x:report -- --client_id client_demo_001
npm run typecheck
node --check apps/web/public/app.js
```

`npm run x:publish:live` should refuse unless `--confirm LIVE` is provided. Do not run the confirmed live command unless the credentials belong to a dedicated test account.

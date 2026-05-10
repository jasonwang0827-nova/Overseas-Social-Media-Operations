# X Platform Module SOP

This module is Phase 1 manual-gated. It may collect, classify, score, and draft from local JSON or approved CLI reads, but it must not auto-send, auto-DM, auto-comment, auto-follow, or auto-reply.

## Safe Operating Modes

- Use `--mode mock` for normal demos and UI checks.
- Use `--estimate-only` before any `--mode api` read command.
- Keep `X_API_DRY_RUN=true` as the default publish setting.
- Run live publishing only on a dedicated test X account and only with `--confirm LIVE`.
- Treat `estimated_cost` as internal cost units, not dollars.

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

- Research Posts: review `x-research-posts.json`, mark relevant/irrelevant, or save a post as a draft content idea.
- KOL Prospects: review `kol-prospects.json`, sort by score/priority, update collaboration status, and add notes.
- Lead Candidates: review `lead-candidates.json`, convert qualified candidates to `leads.json`, generate reply drafts, or mark items handled/irrelevant.
- Engagement Inbox: review `x-engagement-inbox.json`, update classification, convert items to leads, generate reply drafts, or mark handled.
- Reports: review `reports/x/<date>.json` plus current local budget and usage summary.

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


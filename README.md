# Social Ops Hub

Overseas Social Media Operations & Lead Management Hub.

This MVP is organized around:

```text
Client -> Business Category -> Target Audience -> Content Strategy -> Platform Accounts -> Content Pool -> Publish Queue -> Lead Management
```

The first version uses local JSON files under `data/clients/<client_id>/` and mock publishers for Facebook, Instagram, TikTok, and X. YouTube is reserved as an adapter folder only.

## Quick Start

```bash
npm install
npm run demo:seed
npm run web:dev
```

Open:

```text
http://localhost:4321
```

CLI flow:

```bash
npm run publish:run -- --client_id client_study_001
npm run lead:score -- --client_id client_study_001
npm run report:daily -- --client_id client_study_001
```

## Web UI

The MVP includes a local dashboard for checking:

- Client profile
- Platform accounts
- Content assets
- Platform variants
- Publish queue and publish records
- Lead pool, lead scoring, and reply drafts
- Daily report preview

The web server reads and writes the same JSON files under `data/clients/<client_id>/`.

## CLI Commands

```bash
npm run client:create -- --client_id client_study_001 --client_name "ABC Study Abroad" --category_id study_abroad
npm run account:add -- --client_id client_study_001 --platform instagram --account_name abc_study_canada
npm run content:add -- --client_id client_study_001 --category_id study_abroad
npm run content:variant -- --client_id client_study_001 --content_id content_xxx --platform instagram --account_id ig_xxx
npm run content:approve -- --client_id client_study_001 --content_id content_xxx
npm run publish:schedule -- --client_id client_study_001 --variant_id variant_xxx
npm run publish:run -- --client_id client_study_001
npm run publish:status -- --client_id client_study_001
npm run lead:import -- --client_id client_study_001 --message_text "我孩子现在大一，可以转到加拿大吗？"
npm run lead:score -- --client_id client_study_001
npm run report:daily -- --client_id client_study_001
```

## Data Layout

```text
data/clients/<client_id>/
  client.json
  accounts.json
  content-pool.json
  platform-variants.json
  publish-queue.json
  publish-records.json
  leads.json
  reply-drafts.json
  reports/daily/
  reports/weekly/
  assets/raw/
  assets/videos/
  assets/images/
  assets/audio/
  exports/instagram/
  exports/tiktok/
  exports/facebook/
  exports/x/
```

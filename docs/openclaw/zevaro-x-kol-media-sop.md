# Zevaro X KOL 素材采集 SOP

> 用途：从 Pornstar_Accounts 表格选人 → 扫描 X 博主 → 下载图片/短视频 → 关注 → 归档到 Zevaro_Materials

---

## 0. 从表格选取 KOL

**表格位置：** `/Volumes/Elements/Zevaro_Materials/Pornstar_Accounts_Euro_2026.xlsx`

- 分两个 Sheet：`Female_Pornstars`（14位）、`Male_Pornstars`（14位）
- 取 X / Twitter 列的值作为 `--username`
- 表格已有 `已处理` + `处理备注` 两列跟踪进度

**选择规则：**
- 从 `已处理` = ⏳ 待处理的 KOL 中选
- 每次选 1 女 + 1 男（按表格顺序或指定）
- 优先选 X 账号是 **有效 handle** 的（以 `@` 开头，不是纯姓名）
- **执行完成后必须更新表格**：`已处理` = ✅ 已处理，`处理备注` = 日期 + 素材数量 + 关注状态
- 同一 KOL 只跑一次，不重复

**当前状态（2026-05-12）：**

| Sheet | 已处理 | 待处理 |
|-------|--------|--------|
| Female | @abella_danger ✅, @rileyreidx3 ✅ | 12 位待处理 |
| Male | 0 | 14 位待处理 |

---

## 1. 扫描博主帖子

```bash
npm run x:media:scan -- \
  --client_id client_brand_001 \
  --username 博主用户名 \
  --max_video_seconds 180 \
  --mode api \
  --limit 100
```

输出：`data/clients/client_brand_001/x-media-posts.json`

---

## 2. 下载图片和视频到本地

```bash
node /path/to/download-script.mjs
```

### 文件夹规则

```
/Volumes/Elements/Zevaro_Materials/{用户名}/
├── photos/   ← 图片文件
└── videos/   ← 短视频文件（<3min，取最高画质）
```

### 视频下载方式

通过 X API v2 获取视频原始地址：

```
GET /2/tweets?ids=...&expansions=attachments.media_keys
  &media.fields=duration_ms,variants,type
```

取 `variants` 中 `bit_rate` 最高的 MP4 下载。

---

## 3. 关注博主

```bash
npm run x:follow:run -- \
  --client_id client_brand_001 \
  --username 博主用户名 \
  --mode api \
  --confirm LIVE \
  --approved
```

### 安全门（会自动拦截）

| 条件 | 未满足时 |
|------|---------|
| `auto_follow_enabled = true` | blocked |
| `auth_status = connected` | blocked |
| 目标已批准（`--approved`） | blocked |
| `--confirm LIVE` | blocked |
| OAuth 含 `follows.write` | blocked |

---

## 4. 日志查看

```bash
# 扫描记录
data/clients/client_brand_001/x-query-history.json

# 关注记录
data/clients/client_brand_001/x-follow-actions.json

# 审计日志
data/clients/client_brand_001/publish-audit-log.json

# API 用量
data/clients/client_brand_001/x-api-usage.json
```

---

## 边缘情况处理

| 情况 | 处理方式 |
|------|---------|
| 博主帖子少于 15 张图/15 个视频 | 能下多少下多少，备注实际数量 |
| X handle 有误或不存在 | API 返回 user not found，换人 |
| 博主发帖频率低只有旧内容 | API 默认翻前 100 条，不够就实际数量 |
| 同一个博主已被关注过 | follow 接口返回 `following: true` 不会重复关注 |
| 预算不足 | `budget_block_at=950`，需等下个月重置 |

---

## 建议改进

- [ ] 写一个自动化脚本：读表格 → 遍历未处理的 KOL → 自动跑扫描+下载+关注
- [ ] 在表格里加 `已扫描` / `已下载` / `已关注` 三列跟踪进度
- [ ] 对 "搜索..." 类的 KOL 手动补充正确 X handle 后再跑
- [ ] 下载脚本复用为 CLI 子命令 `npm run x:media:download`

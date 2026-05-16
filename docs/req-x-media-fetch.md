# X Media Fetch — 需求文档

## 目标
给定一个 X 用户名（handle），自动拉取其帖子中的图片和视频，下载到客户素材目录。

## 背景
Zevaro 项目需要从 X 上多位成人明星（KOL）的帖子中批量获取媒体素材，用于运营。

## 功能需求

### 1. 拉取带媒体的帖子
- 输入：X username（如 `ChechikTv`）
- 使用 X API v2 `/2/users/:id/tweets`（用户时间线接口，而非搜索接口）
- 翻页拉取，最多可获取近 100 条帖子
- 从返回结果中筛选出带 `media` 的帖子（图片/视频/GIF）

### 2. 视频时长记录，不过滤
- 视频时长超过 3 分钟（180秒）的跳过
- X API 返回的 `duration_ms` 字段用作判断

### 3. 保存到系统
写入 `x-research-posts.json`，每条包含：
```json
{
  "post_id": "1851303687081378267",
  "text": "帖子文本",
  "username": "ChechikTv",
  "post_url": "https://x.com/ChechikTv/status/1851303687081378267",
  "created_at": "2024-10-29T16:42:49.000Z",
  "saved_at": "...",
  "research_status": "suggested",
  "media": [
    {
      "type": "photo",
      "url": "https://pbs.twimg.com/media/xxx.jpg",
      "downloaded_path": "data/clients/.../assets/images/xxx.jpg",
      "downloaded": true
    }
  ]
}
```

### 4. 下载媒体到客户端素材目录
- 图片 → `data/clients/<client_id>/assets/images/`
- 视频 → `data/clients/<client_id>/assets/videos/`
- 文件命名规则：`<username>_<post_id后8位>_<序号>.<ext>`

### 5. 记录 API 用量
- 写入 `x-api-usage.json`
- 写入 `x-query-history.json`

## CLI 命令设计
```
npm run x:media:fetch -- \
  --client_id client_brand_001 \
  --username ChechikTv \
  --limit 100 \
  --max_video_seconds 180
```

## 已知约束
- X API Basic 套餐不支持 `filter:media` 搜索操作符
- 必须使用用户时间线接口而非搜索接口
- Basic 套餐每 15 分钟 15 次请求的速率限制

## 相关文件
- 现有 X 搜索功能参考：`apps/worker/cli.ts` 中 `xResearchSearch` / `fetchXResearchPosts`
- X API 客户端：`packages/publishers/x/apiClient.ts`
- 数据模型参考：`packages/` 下 X 相关类型定义


## 当前实现状态

已实现 Phase 1：

- 命令：`npm run x:media:fetch` / `npm run x:media:scan`
- 使用 X API v2 用户时间线接口拉取指定账号最近帖子
- 请求 `attachments.media_keys` 和 `media.fields=type,url,preview_image_url,duration_ms,public_metrics,alt_text`
- 本地保存：保存所有带图片、视频或动图的帖子；`max_video_seconds` 只作为参考字段，不排除视频
- 输出：`data/clients/<client_id>/x-media-posts.json`
- 记录：`x-query-history.json` 和 `x-api-usage.json`

Phase 1 暂不自动下载媒体文件，原因是不同视频不一定返回可下载直链，且素材复用需要人工确认授权。当前系统保存媒体 URL、预览图、视频时长、帖子链接和互动数据，供运营人工审核。

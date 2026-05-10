const state = {
  clientId: "client_study_001",
  view: "overview",
  contentStatusFilter: "all",
  contentThemeFilter: "all",
  publishStatusFilter: "all",
  publishPlatformFilter: "all",
  leadStageFilter: "all",
  leadPlatformFilter: "all",
  leadSourceFilter: "all",
  data: null
};

const app = document.querySelector("#app");
const refreshButton = document.querySelector("#refreshButton");
const clientSelect = document.querySelector("#clientSelect");

refreshButton.addEventListener("click", () => loadState());
clientSelect.addEventListener("change", (event) => {
  state.clientId = event.target.value;
  loadState();
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.view = button.dataset.view;
    render();
  });
});

loadState();

async function loadState() {
  app.innerHTML = `<div class="loading">正在读取本地 JSON 数据...</div>`;
  try {
    const res = await fetch(`/api/state?client_id=${encodeURIComponent(state.clientId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "读取失败");
    state.data = data;
    updateClientOptions(data.clients || []);
    render();
  } catch (error) {
    app.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "操作失败");
  state.data = data;
  render();
}

function render() {
  if (!state.data) return;
  const views = {
    overview: renderOverview,
    clients: renderClients,
    accounts: renderAccounts,
    capabilities: renderCapabilities,
    content: renderContent,
    publish: renderPublish,
    leads: renderLeads,
    reports: renderReports
  };
  app.innerHTML = views[state.view]();
  bindViewEvents();
}

function renderOverview() {
  const { summary, client, queue, leads, contents } = state.data;
  return `
    ${renderMetrics(summary)}
    <div class="panel-grid">
      <section class="panel">
        <h2>${escapeHtml(client.client_name)}</h2>
        <p class="muted">${escapeHtml(client.industry)} · ${escapeHtml(client.region)} · ${client.language.map(escapeHtml).join(" / ")}</p>
        <div class="tag-row">${client.target_audience.map(tag).join("")}</div>
      </section>
      <section class="panel">
        <h2>运营状态</h2>
        <p class="muted">内容资产 ${contents.length} 条，发布任务 ${queue.length} 条，高分线索 ${leads.filter((lead) => lead.lead_score >= 70).length} 条。</p>
        <div class="inline-actions">
          <button class="action-button" data-action="runPublish">运行发布队列</button>
          <button class="action-button secondary" data-action="scoreLeads">重新评分线索</button>
          <button class="action-button secondary" data-action="writeReport">生成日报</button>
          <button class="action-button secondary" data-action="writeWeeklyReport">生成周报</button>
        </div>
      </section>
    </div>
  `;
}

function renderClients() {
  const { client, categories } = state.data;
  return `
    <section class="panel">
      <h2>创建客户</h2>
      <form class="client-form" id="clientForm">
        <label>
          <span>客户名称</span>
          <input name="client_name" placeholder="ABC Study Abroad" required />
        </label>
        <label>
          <span>client_id</span>
          <input name="client_id" placeholder="client_study_002" required />
        </label>
        <label>
          <span>客户类型</span>
          <select name="category_id">
            ${categories.map((category) => `<option value="${escapeHtml(category.category_id)}">${escapeHtml(category.category_name)} · ${escapeHtml(category.category_id)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>业务类型</span>
          <input name="business_type" placeholder="education_consulting" />
        </label>
        <label>
          <span>地区</span>
          <input name="region" value="Canada" />
        </label>
        <label>
          <span>语言</span>
          <input name="language" value="zh, en" />
        </label>
        <label class="wide">
          <span>目标人群</span>
          <input name="target_audience" placeholder="Chinese students, Chinese parents, new immigrants" />
        </label>
        <label class="wide">
          <span>服务关键词</span>
          <input name="service_keywords" placeholder="study abroad, visa, 转学分, 签证" />
        </label>
        <label class="wide">
          <span>品牌语气</span>
          <input name="brand_tone" value="professional, trustworthy, friendly" />
        </label>
        <label class="wide">
          <span>获客目标</span>
          <input name="lead_goal" value="book consultation, DM inquiry, WhatsApp contact" />
        </label>
        <label class="wide">
          <span>OpenClaw 客户简报</span>
          <textarea name="openclaw_brief" placeholder="粘贴更详细的客户资料：业务范围、目标客户、服务价格、优势、禁用表达、内容风格、主要平台、获客目标等。"></textarea>
        </label>
        <div class="form-actions">
          <button class="action-button" type="submit">创建客户</button>
          <button class="action-button secondary" type="button" data-action="fillClientExample">填入留学示例</button>
        </div>
      </form>
    </section>

    <section class="panel">
      <h2>客户业务档案</h2>
      <table class="table">
        <tbody>
          ${row("client_id", client.client_id)}
          ${row("行业", client.industry)}
          ${row("业务类型", client.business_type)}
          ${row("地区", client.region)}
          ${row("品牌语气", client.brand_tone)}
          ${row("获客目标", client.lead_goal.join(", "))}
          ${row("服务关键词", client.service_keywords.join(", "))}
        </tbody>
      </table>
    </section>
  `;
}

function renderAccounts() {
  const { accounts, platform_options, account_role_options, content_focus_options, account_stats } = state.data;
  return `
    <section class="panel">
      <h2>新增 / 编辑平台账号</h2>
      <form class="client-form" id="accountForm">
        <input type="hidden" name="account_id" />
        <label>
          <span>平台</span>
          <select name="platform">${platform_options.map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join("")}</select>
        </label>
        <label>
          <span>账号名</span>
          <input name="account_name" placeholder="brand_instagram" required />
        </label>
        <label>
          <span>显示名称</span>
          <input name="display_name" placeholder="Brand Official" />
        </label>
        <label class="wide">
          <span>账号链接</span>
          <input name="account_url" placeholder="https://instagram.com/brand" />
        </label>
        <label>
          <span>语言</span>
          <input name="language" value="en" />
        </label>
        <label>
          <span>地区</span>
          <input name="region" value="Canada" />
        </label>
        <label>
          <span>账号角色</span>
          <select name="account_role">${account_role_options.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join("")}</select>
        </label>
        <label>
          <span>内容重点</span>
          <select name="content_focus">${content_focus_options.map((focus) => `<option value="${escapeHtml(focus)}">${escapeHtml(focus)}</option>`).join("")}</select>
        </label>
        <label>
          <span>授权状态</span>
          <select name="auth_status">
            ${["mock", "connected", "disconnected", "expired", "error"].map((item) => `<option value="${item}">${item}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>账号状态</span>
          <select name="status">
            ${["active", "inactive", "archived"].map((item) => `<option value="${item}">${item}</option>`).join("")}
          </select>
        </label>
        <label class="check-label">
          <input name="posting_enabled" type="checkbox" checked />
          <span>允许发布</span>
        </label>
        <label class="check-label">
          <input name="lead_tracking_enabled" type="checkbox" checked />
          <span>追踪线索</span>
        </label>
        <label class="wide">
          <span>备注</span>
          <textarea name="notes" placeholder="账号用途、授权说明、禁用事项等"></textarea>
        </label>
        <label class="wide">
          <span>能力覆盖 JSON</span>
          <textarea name="capability_override" placeholder='{"can_read_comments": false, "can_publish_draft": true}'></textarea>
        </label>
        <div class="form-actions">
          <button class="action-button" type="submit">保存账号</button>
          <button class="action-button secondary" type="button" data-action="resetAccountForm">清空表单</button>
        </div>
      </form>
    </section>

    <section class="panel" style="margin-top:24px">
      <h2>账号列表</h2>
      <table class="table">
        <thead>
          <tr>
            <th>平台</th><th>账号</th><th>角色</th><th>内容重点</th><th>语言/地区</th><th>授权</th><th>状态</th><th>发布/线索</th><th>能力状态</th><th>统计</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${accounts.map((account) => {
            const stats = account_stats[account.account_id] || { queued: 0, published: 0, leads: 0 };
            return `
              <tr>
                <td>${escapeHtml(account.platform)}</td>
                <td><strong>${escapeHtml(account.account_name)}</strong><br><span class="muted">${escapeHtml(account.display_name || "")}</span></td>
                <td>${tag(account.account_role)}</td>
                <td>${tag(account.content_focus)}</td>
                <td>${escapeHtml(account.language)} / ${escapeHtml(account.region)}</td>
                <td>${status(account.auth_status)}</td>
                <td>${status(account.status)}</td>
                <td>${status(account.posting_enabled ? "posting_on" : "posting_off")} ${status(account.lead_tracking_enabled ? "leads_on" : "leads_off")}</td>
                <td>${renderAccountCapabilityStatus(account)}</td>
                <td>发布 ${stats.published}<br>线索 ${stats.leads}</td>
                <td>
                  <div class="table-actions">
                    <button class="action-button secondary" data-action="editAccount" data-account-id="${escapeHtml(account.account_id)}">编辑</button>
                    <button class="action-button secondary" data-action="togglePosting" data-account-id="${escapeHtml(account.account_id)}" data-value="${String(!account.posting_enabled)}">${account.posting_enabled ? "停发布" : "开发布"}</button>
                    <button class="action-button secondary" data-action="toggleLeadTracking" data-account-id="${escapeHtml(account.account_id)}" data-value="${String(!account.lead_tracking_enabled)}">${account.lead_tracking_enabled ? "停线索" : "开线索"}</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderCapabilities() {
  const capabilities = state.data.platform_capabilities || {};
  const platforms = Object.keys(capabilities);
  return `
    <section class="panel">
      <h2>Platform Capability Layer</h2>
      <p class="muted">这里定义每个平台当前能做什么、哪些只能 mock/manual、哪些需要 OAuth / App Review / Business Account。系统会用这些能力做发布前检查和线索导入检查。</p>
    </section>

    <section class="panel" style="margin-top:24px">
      <h2>平台能力总览</h2>
      <table class="table capability-table">
        <thead>
          <tr>
            <th>平台</th><th>发布能力</th><th>线索/数据</th><th>自动化</th><th>授权要求</th><th>工作流</th><th>说明</th>
          </tr>
        </thead>
        <tbody>
          ${platforms.map((platform) => {
            const capability = capabilities[platform];
            return `
              <tr>
                <td><strong>${escapeHtml(platform)}</strong></td>
                <td>
                  ${capabilityPill("text", capability.can_publish_text)}
                  ${capabilityPill("image", capability.can_publish_image)}
                  ${capabilityPill("video", capability.can_publish_video)}
                  ${capabilityPill("carousel", capability.can_publish_carousel)}
                  ${capabilityPill("story", capability.can_publish_story)}
                  ${capabilityPill("reel", capability.can_publish_reel)}
                  ${capabilityPill("draft", capability.can_publish_draft)}
                </td>
                <td>
                  ${capabilityPill("comments", capability.can_read_comments)}
                  ${capabilityPill("dm", capability.can_read_dm)}
                  ${capabilityPill("analytics", capability.can_fetch_analytics)}
                </td>
                <td>${capabilityPill("auto_reply", capability.can_auto_reply)}</td>
                <td>
                  ${capability.requires_oauth ? status("oauth_required") : status("no_oauth")}
                  ${capability.requires_app_review ? status("app_review") : status("no_app_review")}
                  ${capability.requires_business_account ? status("business_required") : status("no_business_required")}
                </td>
                <td>
                  ${capabilityPill("mock", capability.supports_mock)}
                  ${capabilityPill("real_api", capability.supports_real_api)}
                  ${capability.requires_human_review ? status("manual_workflow") : status("api_ready")}
                  ${hasLimitedCapability(capability) ? status("limited") : ""}
                </td>
                <td class="muted">${escapeHtml(capability.notes || "")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderContent() {
  const { contents, variants, accounts, content_theme_options, content_angle_options } = state.data;
  const filteredContents = contents.filter((content) => {
    const statusMatch = state.contentStatusFilter === "all" || content.status === state.contentStatusFilter;
    const themeMatch = state.contentThemeFilter === "all" || content.content_theme === state.contentThemeFilter;
    return statusMatch && themeMatch;
  });
  return `
    <section class="panel">
      <h2>Content Workspace</h2>
      <form class="client-form compact-form" id="contentGenerateForm">
        <label>
          <span>Mock 生成主题</span>
          <select name="theme">${content_theme_options.map((theme) => `<option value="${escapeHtml(theme)}">${escapeHtml(theme)}</option>`).join("")}</select>
        </label>
        <div class="form-actions">
          <button class="action-button" type="submit">生成内容资产</button>
        </div>
      </form>
      <div class="filter-row">
        <label>
          <span>状态</span>
          <select id="contentStatusFilter">
            ${["all", "draft", "ready_for_review", "approved", "failed"].map((item) => `<option value="${item}" ${state.contentStatusFilter === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>主题</span>
          <select id="contentThemeFilter">
            <option value="all">all</option>
            ${content_theme_options.map((theme) => `<option value="${escapeHtml(theme)}" ${state.contentThemeFilter === theme ? "selected" : ""}>${escapeHtml(theme)}</option>`).join("")}
          </select>
        </label>
      </div>
    </section>

    <section class="panel" style="margin-top:24px">
      <h2>手动创建内容资产</h2>
      <form class="client-form" id="contentForm">
        <label>
          <span>主题</span>
          <select name="content_theme">${content_theme_options.map((theme) => `<option value="${escapeHtml(theme)}">${escapeHtml(theme)}</option>`).join("")}</select>
        </label>
        <label>
          <span>角度</span>
          <select name="content_angle">${content_angle_options.map((angle) => `<option value="${escapeHtml(angle)}">${escapeHtml(angle)}</option>`).join("")}</select>
        </label>
        <label>
          <span>类型</span>
          <select name="content_type">
            ${["short_video", "image_post", "text_post", "carousel"].map((item) => `<option value="${item}">${item}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>漏斗阶段</span>
          <select name="funnel_stage">
            ${["awareness", "trust_building", "lead_generation", "conversion"].map((item) => `<option value="${item}">${item}</option>`).join("")}
          </select>
        </label>
        <label class="wide">
          <span>标题</span>
          <input name="title" placeholder="内容标题" required />
        </label>
        <label class="wide">
          <span>开头 Hook</span>
          <textarea name="hook" placeholder="第一句话要抓住目标人群的问题" required></textarea>
        </label>
        <label class="wide">
          <span>要点</span>
          <textarea name="main_points" placeholder="每行一个要点" required></textarea>
        </label>
        <label class="wide">
          <span>CTA</span>
          <input name="cta" placeholder="私信/评论/预约咨询" required />
        </label>
        <label>
          <span>语言</span>
          <input name="language" value="${escapeHtml(state.data.client.language[0] || "en")}" />
        </label>
        <label class="wide">
          <span>目标人群</span>
          <input name="target_audience" value="${escapeHtml(state.data.client.target_audience.join(", "))}" />
        </label>
        <div class="form-actions">
          <button class="action-button" type="submit">保存为 draft</button>
        </div>
      </form>
    </section>

    <div class="content-grid" style="margin-top:24px">
      ${filteredContents.map((content) => {
        const contentVariants = variants.filter((variant) => variant.content_id === content.content_id);
        return `
          <article class="row-card">
            <div class="row-card-head">
              <div>
                <h3>${escapeHtml(content.title)}</h3>
                <p class="muted">${escapeHtml(content.content_id)}</p>
              </div>
              <div class="tag-row">
                ${status(content.status)}
                ${tag(content.content_theme)}
                ${tag(content.content_angle)}
                ${tag(content.funnel_stage)}
              </div>
            </div>
            <p class="muted">${escapeHtml(content.hook)}</p>
            <p style="margin-top:12px">${content.main_points.map(escapeHtml).join(" / ")}</p>
            <p class="muted">CTA: ${escapeHtml(content.cta)}</p>
            <div class="inline-actions">
              <button class="action-button secondary" data-action="generateVariants" data-content-id="${escapeHtml(content.content_id)}">生成平台版本</button>
              ${content.approved_by_human ? "" : `<button class="action-button" data-action="approveContent" data-content-id="${escapeHtml(content.content_id)}">批准内容</button>`}
              ${content.status === "failed" ? "" : `<button class="action-button danger" data-action="rejectContent" data-content-id="${escapeHtml(content.content_id)}">驳回内容</button>`}
            </div>
            <h4>准备发布账号</h4>
            <div class="tag-row">
              ${contentVariants.length === 0 ? `<span class="muted">还没有平台版本</span>` : contentVariants.map((variant) => {
                const account = accounts.find((item) => item.account_id === variant.account_id);
                return tag(`${variant.platform}: ${account?.display_name || variant.account_id}`);
              }).join("")}
            </div>
            <div class="variant-list">
              ${contentVariants.map((variant) => renderVariantEditor(variant)).join("")}
            </div>
          </article>
        `;
      }).join("") || `<section class="panel"><p class="muted">当前筛选没有内容资产。</p></section>`}
    </div>
  `;
}

function renderVariantEditor(variant) {
  return `
    <form class="variant-editor" data-variant-id="${escapeHtml(variant.variant_id)}">
      <div class="variant-meta">
        <strong>${escapeHtml(variant.platform)} · ${escapeHtml(variant.account_id)}</strong>
        <span>${status(variant.approval_status)} ${tag(variant.account_role)} ${tag(variant.content_focus)}</span>
      </div>
      <label>
        <span>Caption</span>
        <textarea name="caption">${escapeHtml(variant.caption)}</textarea>
      </label>
      <label>
        <span>Hashtags</span>
        <input name="hashtags" value="${escapeHtml(variant.hashtags.join(", "))}" />
      </label>
      <label>
        <span>CTA</span>
        <input name="cta" value="${escapeHtml(variant.cta)}" />
      </label>
      ${variant.rejection_reason ? `<p class="muted">驳回原因：${escapeHtml(variant.rejection_reason)}</p>` : ""}
      <div class="table-actions">
        <button class="action-button secondary" type="submit">保存版本</button>
        ${variant.approval_status === "approved" ? "" : `<button class="action-button" type="button" data-action="approveVariant" data-variant-id="${escapeHtml(variant.variant_id)}">批准版本</button>`}
        <button class="action-button danger" type="button" data-action="rejectVariant" data-variant-id="${escapeHtml(variant.variant_id)}">驳回版本</button>
      </div>
    </form>
  `;
}

function renderPublish() {
  const { queue, records, contents, variants, accounts, platform_options } = state.data;
  const approvedVariants = variants.filter((variant) => variant.status === "approved" && variant.approval_status === "approved" && !queue.some((task) => task.variant_id === variant.variant_id && task.status !== "cancelled"));
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filteredQueue = queue.filter((task) => {
    const statusMatch = state.publishStatusFilter === "all" || task.status === state.publishStatusFilter;
    const platformMatch = state.publishPlatformFilter === "all" || task.platform === state.publishPlatformFilter;
    return statusMatch && platformMatch;
  }).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const todayTasks = queue.filter((task) => task.scheduled_at.slice(0, 10) === today);
  const weekTasks = queue.filter((task) => task.scheduled_at.slice(0, 10) >= today && task.scheduled_at.slice(0, 10) <= weekEnd);
  const accountDayCounts = todayTasks.reduce((acc, task) => {
    acc[task.account_id] = (acc[task.account_id] || 0) + 1;
    return acc;
  }, {});
  return `
    <section class="panel">
      <h2>Publish Queue Workspace</h2>
      <div class="inline-actions">
        <button class="action-button" data-action="runPublish">运行 mock 发布</button>
        <button class="action-button secondary" data-action="batchSchedule">批量排期今日</button>
      </div>
      <div class="summary-grid small-summary">
        <div class="metric"><span>今日计划</span><strong>${todayTasks.length}</strong></div>
        <div class="metric"><span>本周计划</span><strong>${weekTasks.length}</strong></div>
        <div class="metric"><span>可排期版本</span><strong>${approvedVariants.length}</strong></div>
        <div class="metric"><span>Blocked</span><strong>${queue.filter((task) => task.status === "blocked").length}</strong></div>
      </div>
      <div class="filter-row">
        <label>
          <span>状态</span>
          <select id="publishStatusFilter">
            ${["all", "scheduled", "publishing", "published", "failed", "blocked", "cancelled"].map((item) => `<option value="${item}" ${state.publishStatusFilter === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>平台</span>
          <select id="publishPlatformFilter">
            <option value="all">all</option>
            ${platform_options.map((platform) => `<option value="${escapeHtml(platform)}" ${state.publishPlatformFilter === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}
          </select>
        </label>
      </div>
    </section>

    <section class="panel" style="margin-top:24px">
      <h2>Approved Variants 排期</h2>
      <table class="table">
        <thead><tr><th>内容</th><th>平台/账号</th><th>Caption</th><th>排期时间</th><th>操作</th></tr></thead>
        <tbody>
          ${approvedVariants.map((variant) => {
            const content = contents.find((item) => item.content_id === variant.content_id);
            const account = accounts.find((item) => item.account_id === variant.account_id);
            return `
              <tr>
                <td><strong>${escapeHtml(content?.title || variant.content_id)}</strong><br><span class="muted">${escapeHtml(variant.variant_id)}</span></td>
                <td>${escapeHtml(variant.platform)}<br><span class="muted">${escapeHtml(account?.display_name || variant.account_id)}</span></td>
                <td>${escapeHtml(variant.caption.slice(0, 180))}</td>
                <td><input class="schedule-input" data-variant-id="${escapeHtml(variant.variant_id)}" type="datetime-local" value="${defaultLocalDateTime()}" /></td>
                <td><button class="action-button secondary" data-action="scheduleVariant" data-variant-id="${escapeHtml(variant.variant_id)}">加入队列</button></td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="5" class="muted">没有可排期的 approved variant。</td></tr>`}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>发布队列</h2>
      <table class="table">
        <thead><tr><th>内容</th><th>平台/账号</th><th>时间</th><th>状态</th><th>原因</th><th>操作</th></tr></thead>
        <tbody>
          ${filteredQueue.map((task) => {
            const content = contents.find((item) => item.content_id === task.content_id);
            const variant = variants.find((item) => item.variant_id === task.variant_id);
            return `
              <tr>
                <td><strong>${escapeHtml(content?.title || task.content_id)}</strong><br><span class="muted">${escapeHtml(task.publish_task_id)}</span></td>
                <td>${escapeHtml(task.platform)}<br><span class="muted">${escapeHtml(task.account_id)}</span></td>
                <td>
                  <input class="reschedule-input" data-task-id="${escapeHtml(task.publish_task_id)}" type="datetime-local" value="${toLocalDateTime(task.scheduled_at)}" />
                  <p class="muted">${escapeHtml(task.published_at ? `published ${task.published_at}` : "")}</p>
                </td>
                <td>${status(task.status)} ${status(task.approval_status)}</td>
                <td>${escapeHtml(task.blocked_reason || task.error_message || variant?.caption.slice(0, 90) || "")}</td>
                <td>
                  <div class="table-actions">
                    <button class="action-button secondary" data-action="rescheduleTask" data-task-id="${escapeHtml(task.publish_task_id)}">改时间</button>
                    <button class="action-button secondary" data-action="retryTask" data-task-id="${escapeHtml(task.publish_task_id)}">重试</button>
                    <button class="action-button danger" data-action="cancelTask" data-task-id="${escapeHtml(task.publish_task_id)}">取消</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="6" class="muted">当前筛选没有发布任务。</td></tr>`}
        </tbody>
      </table>
    </section>
    <section class="panel" style="margin-top:24px">
      <h2>发布记录</h2>
      <p class="muted">已记录 ${records.length} 条 mock 发布结果。</p>
      <div class="tag-row">
        ${Object.entries(accountDayCounts).map(([accountId, count]) => tag(`${accountId}: 今日 ${count}`)).join("")}
      </div>
      <table class="table" style="margin-top:14px">
        <thead><tr><th>记录</th><th>平台</th><th>账号</th><th>发布时间</th><th>Mock URL</th></tr></thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              <td>${escapeHtml(record.publish_record_id || record.record_id || record.publish_task_id)}</td>
              <td>${escapeHtml(record.platform)}</td>
              <td>${escapeHtml(record.account_id)}</td>
              <td>${escapeHtml(record.published_at || "")}</td>
              <td>${record.mock_url ? `<a href="${escapeHtml(record.mock_url)}" target="_blank">${escapeHtml(record.mock_url)}</a>` : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderLeads() {
  const { leads, drafts, accounts, platform_options, lead_stage_options, lead_source_type_options } = state.data;
  const today = new Date().toISOString().slice(0, 10);
  const filteredLeads = leads
    .filter((lead) => state.leadStageFilter === "all" || lead.lead_stage === state.leadStageFilter)
    .filter((lead) => state.leadPlatformFilter === "all" || lead.platform === state.leadPlatformFilter)
    .filter((lead) => state.leadSourceFilter === "all" || lead.source_type === state.leadSourceFilter)
    .sort((a, b) => b.lead_score - a.lead_score);
  const dueToday = leads.filter((lead) => lead.next_follow_up_at && lead.next_follow_up_at.slice(0, 10) <= today && !["converted", "not_interested", "spam"].includes(lead.lead_stage));
  const highUnreplied = leads.filter((lead) => lead.lead_score >= 70 && !["replied", "waiting_response", "booked", "converted", "spam"].includes(lead.lead_stage));
  return `
    <section class="panel">
      <h2>Lead Management Workspace</h2>
      <form class="client-form" id="leadForm">
        <label>
          <span>平台</span>
          <select name="platform">${platform_options.map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`).join("")}</select>
        </label>
        <label>
          <span>账号</span>
          <select name="account_id">${accounts.filter((account) => account.lead_tracking_enabled).map((account) => `<option value="${escapeHtml(account.account_id)}">${escapeHtml(account.display_name || account.account_id)}</option>`).join("")}</select>
        </label>
        <label>
          <span>来源</span>
          <select name="source_type">${lead_source_type_options.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}</select>
        </label>
        <label class="wide">
          <span>互动内容</span>
          <textarea name="message_text" placeholder="粘贴评论或私信，例如：我孩子现在大一，可以转到加拿大吗？"></textarea>
        </label>
        <label>
          <span>用户 handle</span>
          <input name="user_handle" placeholder="user123" />
        </label>
        <label>
          <span>显示名</span>
          <input name="user_display_name" placeholder="Lily" />
        </label>
        <label>
          <span>source_post_id</span>
          <input name="source_post_id" placeholder="post_xxx" />
        </label>
        <div class="form-actions">
          <button class="action-button" type="submit">导入线索</button>
          <button class="action-button secondary" type="button" data-action="scoreLeads">重新评分线索</button>
        </div>
      </form>
      <div class="filter-row">
        <label><span>阶段</span><select id="leadStageFilter"><option value="all">all</option>${lead_stage_options.map((stage) => `<option value="${escapeHtml(stage)}" ${state.leadStageFilter === stage ? "selected" : ""}>${escapeHtml(stage)}</option>`).join("")}</select></label>
        <label><span>平台</span><select id="leadPlatformFilter"><option value="all">all</option>${platform_options.map((platform) => `<option value="${escapeHtml(platform)}" ${state.leadPlatformFilter === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}</select></label>
        <label><span>来源</span><select id="leadSourceFilter"><option value="all">all</option>${lead_source_type_options.map((type) => `<option value="${escapeHtml(type)}" ${state.leadSourceFilter === type ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}</select></label>
      </div>
    </section>

    <section class="panel" style="margin-top:24px">
      <h2>Follow-up View</h2>
      <div class="summary-grid small-summary">
        <div class="metric"><span>今日跟进</span><strong>${dueToday.length}</strong></div>
        <div class="metric"><span>高分未回复</span><strong>${highUnreplied.length}</strong></div>
        <div class="metric"><span>等待回复</span><strong>${leads.filter((lead) => lead.lead_stage === "waiting_response").length}</strong></div>
        <div class="metric"><span>已预约</span><strong>${leads.filter((lead) => lead.lead_stage === "booked").length}</strong></div>
      </div>
    </section>

    <div class="lead-grid">
      ${filteredLeads.map((lead) => {
        const leadDrafts = drafts.filter((draft) => draft.lead_id === lead.lead_id);
        return `
        <article class="lead-card" data-lead-id="${escapeHtml(lead.lead_id)}">
          <h3>${escapeHtml(lead.user_display_name)} <span class="muted">@${escapeHtml(lead.user_handle)}</span></h3>
          <p class="muted">${escapeHtml(lead.platform)} · ${escapeHtml(lead.account_id)} · ${escapeHtml(lead.source_type)}</p>
          <p>${escapeHtml(lead.message_text)}</p>
          <div class="tag-row">
            ${status(lead.lead_stage)}
            ${tag(lead.detected_intent)}
            ${tag(`score ${lead.lead_score}`)}
          </div>
          <p class="muted" style="margin-top:12px">${escapeHtml(lead.recommended_reply)}</p>
          <form class="lead-editor" data-lead-id="${escapeHtml(lead.lead_id)}">
            <label><span>阶段</span><select name="lead_stage">${lead_stage_options.map((stage) => `<option value="${escapeHtml(stage)}" ${lead.lead_stage === stage ? "selected" : ""}>${escapeHtml(stage)}</option>`).join("")}</select></label>
            <label><span>负责人</span><input name="assigned_to" value="${escapeHtml(lead.assigned_to || "")}" /></label>
            <label><span>下次跟进</span><input name="next_follow_up_at" type="datetime-local" value="${lead.next_follow_up_at ? toLocalDateTime(lead.next_follow_up_at) : ""}" /></label>
            <label class="wide"><span>备注</span><textarea name="lead_notes">${escapeHtml((lead.lead_notes || []).join("\n"))}</textarea></label>
            <div class="table-actions">
              <button class="action-button secondary" type="submit">保存线索</button>
              <button class="action-button" type="button" data-action="generateReply" data-lead-id="${escapeHtml(lead.lead_id)}">生成回复草稿</button>
              ${["qualified", "booked", "converted", "not_interested", "spam"].map((stage) => `<button class="action-button secondary" type="button" data-action="quickLeadStage" data-lead-id="${escapeHtml(lead.lead_id)}" data-stage="${stage}">${stage}</button>`).join("")}
            </div>
          </form>
          <div class="variant-list">
            ${leadDrafts.map((draft) => `
              <form class="variant-editor reply-editor" data-reply-draft-id="${escapeHtml(draft.reply_draft_id)}">
                <div class="variant-meta"><strong>Reply Draft</strong><span>${status(draft.approval_status)} ${status(draft.sent_status)}</span></div>
                <p>${escapeHtml(draft.draft_text)}</p>
                ${draft.rejection_reason ? `<p class="muted">驳回原因：${escapeHtml(draft.rejection_reason)}</p>` : ""}
                <div class="table-actions">
                  <button class="action-button" type="button" data-action="approveReply" data-reply-draft-id="${escapeHtml(draft.reply_draft_id)}">批准草稿</button>
                  <button class="action-button danger" type="button" data-action="rejectReply" data-reply-draft-id="${escapeHtml(draft.reply_draft_id)}">驳回草稿</button>
                </div>
              </form>
            `).join("") || `<p class="muted">还没有回复草稿。</p>`}
          </div>
        </article>
      `;
      }).join("")}
    </div>
  `;
}

function renderReports() {
  const { summary, leads, queue, contents } = state.data;
  return `
    ${renderMetrics(summary)}
    <section class="panel">
      <div class="inline-actions">
        <button class="action-button" data-action="writeReport">生成今日报告</button>
        <button class="action-button secondary" data-action="writeWeeklyReport">生成本周报告</button>
      </div>
      <h2>日报预览</h2>
      <table class="table">
        <tbody>
          ${row("发布任务", queue.length)}
          ${row("失败任务", queue.filter((task) => task.status === "failed").length)}
          ${row("新线索", leads.filter((lead) => lead.lead_stage === "new").length)}
          ${row("高分线索", leads.filter((lead) => lead.lead_score >= 70).length)}
          ${row("内容主题", [...new Set(contents.map((content) => content.content_theme))].join(", "))}
        </tbody>
      </table>
    </section>
  `;
}

function renderMetrics(summary) {
  const metrics = [
    ["活跃账号", summary.active_accounts],
    ["内容资产", summary.content_assets],
    ["平台版本", summary.ready_variants],
    ["待发布", summary.scheduled_tasks],
    ["已发布", summary.published_tasks],
    ["高分线索", summary.high_score_leads]
  ];
  return `<div class="summary-grid">${metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}

function bindViewEvents() {
  document.querySelectorAll("[data-action='runPublish']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/publish/run", { client_id: state.clientId }));
  });
  document.querySelectorAll("[data-action='batchSchedule']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/publish/schedule-batch", { client_id: state.clientId, date: new Date().toISOString().slice(0, 10) }));
  });
  document.querySelectorAll("[data-action='scheduleVariant']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`.schedule-input[data-variant-id="${cssEscape(button.dataset.variantId)}"]`);
      postJson("/api/publish/schedule", {
        client_id: state.clientId,
        variant_id: button.dataset.variantId,
        scheduled_at: fromLocalDateTime(input?.value || defaultLocalDateTime())
      });
    });
  });
  document.querySelectorAll("[data-action='rescheduleTask']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`.reschedule-input[data-task-id="${cssEscape(button.dataset.taskId)}"]`);
      postJson("/api/publish/reschedule", {
        client_id: state.clientId,
        publish_task_id: button.dataset.taskId,
        scheduled_at: fromLocalDateTime(input?.value || defaultLocalDateTime())
      });
    });
  });
  document.querySelectorAll("[data-action='cancelTask']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/publish/cancel", { client_id: state.clientId, publish_task_id: button.dataset.taskId }));
  });
  document.querySelectorAll("[data-action='retryTask']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/publish/retry", { client_id: state.clientId, publish_task_id: button.dataset.taskId }));
  });
  document.querySelectorAll("[data-action='scoreLeads']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/lead/score", { client_id: state.clientId }));
  });
  document.querySelectorAll("[data-action='writeReport']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/report/daily", { client_id: state.clientId }));
  });
  document.querySelectorAll("[data-action='writeWeeklyReport']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/report/weekly", { client_id: state.clientId }));
  });
  document.querySelectorAll("[data-action='approveContent']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/content/approve", { client_id: state.clientId, content_id: button.dataset.contentId }));
  });
  document.querySelectorAll("[data-action='rejectContent']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/content/reject", { client_id: state.clientId, content_id: button.dataset.contentId }));
  });
  document.querySelectorAll("[data-action='generateVariants']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/content/variant/generate", { client_id: state.clientId, content_id: button.dataset.contentId }));
  });
  document.querySelectorAll("[data-action='approveVariant']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/variant/approve", { client_id: state.clientId, variant_id: button.dataset.variantId }));
  });
  document.querySelectorAll("[data-action='rejectVariant']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/variant/reject", {
      client_id: state.clientId,
      variant_id: button.dataset.variantId,
      rejection_reason: "Rejected from Content Workspace"
    }));
  });

  const contentStatusFilter = document.querySelector("#contentStatusFilter");
  if (contentStatusFilter) {
    contentStatusFilter.addEventListener("change", (event) => {
      state.contentStatusFilter = event.target.value;
      render();
    });
  }

  const contentThemeFilter = document.querySelector("#contentThemeFilter");
  if (contentThemeFilter) {
    contentThemeFilter.addEventListener("change", (event) => {
      state.contentThemeFilter = event.target.value;
      render();
    });
  }

  const publishStatusFilter = document.querySelector("#publishStatusFilter");
  if (publishStatusFilter) {
    publishStatusFilter.addEventListener("change", (event) => {
      state.publishStatusFilter = event.target.value;
      render();
    });
  }

  const publishPlatformFilter = document.querySelector("#publishPlatformFilter");
  if (publishPlatformFilter) {
    publishPlatformFilter.addEventListener("change", (event) => {
      state.publishPlatformFilter = event.target.value;
      render();
    });
  }

  const leadStageFilter = document.querySelector("#leadStageFilter");
  if (leadStageFilter) {
    leadStageFilter.addEventListener("change", (event) => {
      state.leadStageFilter = event.target.value;
      render();
    });
  }

  const leadPlatformFilter = document.querySelector("#leadPlatformFilter");
  if (leadPlatformFilter) {
    leadPlatformFilter.addEventListener("change", (event) => {
      state.leadPlatformFilter = event.target.value;
      render();
    });
  }

  const leadSourceFilter = document.querySelector("#leadSourceFilter");
  if (leadSourceFilter) {
    leadSourceFilter.addEventListener("change", (event) => {
      state.leadSourceFilter = event.target.value;
      render();
    });
  }

  const contentGenerateForm = document.querySelector("#contentGenerateForm");
  if (contentGenerateForm) {
    contentGenerateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(contentGenerateForm);
      await postJson("/api/content/generate", {
        client_id: state.clientId,
        theme: String(form.get("theme") || "brand_intro")
      });
    });
  }

  const contentForm = document.querySelector("#contentForm");
  if (contentForm) {
    contentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(contentForm);
      await postJson("/api/content/create", {
        client_id: state.clientId,
        content_theme: String(form.get("content_theme") || "pain_point"),
        content_angle: String(form.get("content_angle") || "problem_solution"),
        content_type: String(form.get("content_type") || "short_video"),
        funnel_stage: String(form.get("funnel_stage") || "lead_generation"),
        title: String(form.get("title") || "").trim(),
        hook: String(form.get("hook") || "").trim(),
        main_points: splitLines(String(form.get("main_points") || "")),
        cta: String(form.get("cta") || "").trim(),
        language: String(form.get("language") || "en").trim(),
        target_audience: splitList(String(form.get("target_audience") || "")),
        status: "draft"
      });
    });
  }

  document.querySelectorAll(".variant-editor").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await postJson("/api/variant/update", {
        client_id: state.clientId,
        variant_id: form.dataset.variantId,
        caption: String(data.get("caption") || "").trim(),
        hashtags: splitList(String(data.get("hashtags") || "")),
        cta: String(data.get("cta") || "").trim()
      });
    });
  });

  const leadForm = document.querySelector("#leadForm");
  if (leadForm) {
    leadForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(leadForm);
      const message = String(form.get("message_text") || "").trim();
      if (!message) return;
      postJson("/api/lead/import", {
        client_id: state.clientId,
        platform: String(form.get("platform") || "instagram"),
        account_id: String(form.get("account_id") || ""),
        source_type: String(form.get("source_type") || "comment"),
        source_post_id: String(form.get("source_post_id") || "").trim() || null,
        user_handle: String(form.get("user_handle") || "").trim() || "web_demo_lead",
        user_display_name: String(form.get("user_display_name") || "").trim() || "Web Demo Lead",
        message_text: message
      });
    });
  }

  document.querySelectorAll(".lead-editor").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await postJson("/api/lead/update", {
        client_id: state.clientId,
        lead_id: form.dataset.leadId,
        lead_stage: String(data.get("lead_stage") || "new"),
        assigned_to: String(data.get("assigned_to") || "").trim(),
        next_follow_up_at: data.get("next_follow_up_at") ? fromLocalDateTime(String(data.get("next_follow_up_at"))) : null,
        lead_notes: splitLines(String(data.get("lead_notes") || ""))
      });
    });
  });

  document.querySelectorAll("[data-action='quickLeadStage']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/lead/update", {
      client_id: state.clientId,
      lead_id: button.dataset.leadId,
      lead_stage: button.dataset.stage
    }));
  });

  document.querySelectorAll("[data-action='generateReply']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/reply/generate", { client_id: state.clientId, lead_id: button.dataset.leadId }));
  });

  document.querySelectorAll("[data-action='approveReply']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/reply/approve", { client_id: state.clientId, reply_draft_id: button.dataset.replyDraftId }));
  });

  document.querySelectorAll("[data-action='rejectReply']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/reply/reject", {
      client_id: state.clientId,
      reply_draft_id: button.dataset.replyDraftId,
      rejection_reason: "Rejected from Lead Workspace"
    }));
  });

  const clientForm = document.querySelector("#clientForm");
  if (clientForm) {
    clientForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(clientForm);
      const payload = {
        client_id: String(form.get("client_id") || "").trim(),
        client_name: String(form.get("client_name") || "").trim(),
        category_id: String(form.get("category_id") || "study_abroad"),
        business_type: String(form.get("business_type") || "").trim(),
        region: String(form.get("region") || "Canada").trim(),
        language: splitList(String(form.get("language") || "")),
        target_audience: splitList(String(form.get("target_audience") || "")),
        service_keywords: splitList(String(form.get("service_keywords") || "")),
        brand_tone: String(form.get("brand_tone") || "").trim(),
        lead_goal: splitList(String(form.get("lead_goal") || "")),
        openclaw_brief: String(form.get("openclaw_brief") || "").trim()
      };
      await postJson("/api/client/create", payload);
      state.clientId = payload.client_id;
      updateClientOptions(state.data.clients || []);
    });
  }

  document.querySelectorAll("[data-action='fillClientExample']").forEach((button) => {
    button.addEventListener("click", () => fillClientExample());
  });

  const accountForm = document.querySelector("#accountForm");
  if (accountForm) {
    accountForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(accountForm);
      const accountId = String(form.get("account_id") || "").trim();
      const overrideText = String(form.get("capability_override") || "").trim();
      const payload = {
        client_id: state.clientId,
        account_id: accountId || undefined,
        platform: String(form.get("platform") || "instagram"),
        account_name: String(form.get("account_name") || "").trim(),
        display_name: String(form.get("display_name") || "").trim(),
        account_url: String(form.get("account_url") || "").trim() || null,
        language: String(form.get("language") || "en").trim(),
        region: String(form.get("region") || "Canada").trim(),
        account_role: String(form.get("account_role") || "official_brand"),
        content_focus: String(form.get("content_focus") || "brand_awareness"),
        posting_enabled: form.get("posting_enabled") === "on",
        lead_tracking_enabled: form.get("lead_tracking_enabled") === "on",
        auth_status: String(form.get("auth_status") || "mock"),
        status: String(form.get("status") || "active"),
        notes: String(form.get("notes") || "").trim(),
        capability_override: overrideText ? JSON.parse(overrideText) : {}
      };
      await postJson(accountId ? "/api/account/update" : "/api/account/create", payload);
    });
  }

  document.querySelectorAll("[data-action='editAccount']").forEach((button) => {
    button.addEventListener("click", () => fillAccountForm(button.dataset.accountId));
  });
  document.querySelectorAll("[data-action='togglePosting']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/account/toggle", {
      client_id: state.clientId,
      account_id: button.dataset.accountId,
      field: "posting_enabled",
      value: button.dataset.value === "true"
    }));
  });
  document.querySelectorAll("[data-action='toggleLeadTracking']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/account/toggle", {
      client_id: state.clientId,
      account_id: button.dataset.accountId,
      field: "lead_tracking_enabled",
      value: button.dataset.value === "true"
    }));
  });
  document.querySelectorAll("[data-action='resetAccountForm']").forEach((button) => {
    button.addEventListener("click", () => resetAccountForm());
  });
}

function updateClientOptions(clients) {
  const known = new Set([...clientSelect.options].map((option) => option.value));
  for (const client of clients) {
    if (!known.has(client.client_id)) {
      const option = document.createElement("option");
      option.value = client.client_id;
      option.textContent = `${client.client_id} · ${client.client_name}`;
      clientSelect.appendChild(option);
    }
  }
  clientSelect.value = state.clientId;
}

function fillClientExample() {
  const form = document.querySelector("#clientForm");
  if (!form) return;
  form.client_name.value = "Maple Study Consulting";
  form.client_id.value = `client_study_${Date.now().toString().slice(-4)}`;
  form.category_id.value = "study_abroad";
  form.business_type.value = "education_consulting";
  form.region.value = "Canada";
  form.language.value = "zh, en";
  form.target_audience.value = "Chinese students, Chinese parents, international students, new immigrants";
  form.service_keywords.value = "study abroad, visa, college transfer, university application, 加拿大留学, 转学分, 签证";
  form.brand_tone.value = "professional, trustworthy, friendly";
  form.lead_goal.value = "book consultation, DM inquiry, WhatsApp contact, website visit";
  form.openclaw_brief.value = "客户是一家加拿大留学咨询公司，主要服务中国学生、家长和新移民家庭。核心业务包括大学申请、学院转大学、转学分规划、签证咨询和学校选择。内容需要专业、可信、温和，不夸大承诺，不制造焦虑。重点平台是 Instagram、TikTok、Facebook。主要获客目标是私信咨询和预约顾问。";
}

function splitList(value) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function splitLines(value) {
  return value.split(/\n/).map((item) => item.trim()).filter(Boolean);
}

function defaultLocalDateTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return toLocalDateTime(date.toISOString());
}

function toLocalDateTime(value) {
  if (!value) return defaultLocalDateTime();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return defaultLocalDateTime();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTime(value) {
  return new Date(value).toISOString();
}

function cssEscape(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function fillAccountForm(accountId) {
  const form = document.querySelector("#accountForm");
  const account = state.data.accounts.find((item) => item.account_id === accountId);
  if (!form || !account) return;
  form.account_id.value = account.account_id;
  form.platform.value = account.platform;
  form.account_name.value = account.account_name;
  form.display_name.value = account.display_name || "";
  form.account_url.value = account.account_url || "";
  form.language.value = account.language || "en";
  form.region.value = account.region || "Canada";
  form.account_role.value = account.account_role;
  form.content_focus.value = account.content_focus;
  form.auth_status.value = account.auth_status;
  form.status.value = account.status;
  form.posting_enabled.checked = Boolean(account.posting_enabled);
  form.lead_tracking_enabled.checked = Boolean(account.lead_tracking_enabled);
  form.notes.value = account.notes || "";
  form.capability_override.value = formatCapabilityOverride(account.capability_override);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetAccountForm() {
  const form = document.querySelector("#accountForm");
  if (!form) return;
  form.reset();
  form.account_id.value = "";
  form.language.value = "en";
  form.region.value = "Canada";
  form.posting_enabled.checked = true;
  form.lead_tracking_enabled.checked = true;
  form.capability_override.value = "";
}

function renderAccountCapabilityStatus(account) {
  const capability = mergeAccountCapabilities(account);
  const directPublishTier = capabilityTier([
    capability.can_publish_text,
    capability.can_publish_image,
    capability.can_publish_video,
    capability.can_publish_carousel,
    capability.can_publish_reel
  ]);
  const publishTier = directPublishTier === "api" && capability.supports_real_api !== true
    ? "limited"
    : directPublishTier === "none" && capability.can_publish_draft === true
      ? "draft"
      : directPublishTier;
  const leadTier = capabilityTier([capability.can_read_comments, capability.can_read_dm]);
  const manualRequired = capability.requires_human_review || capability.supports_real_api !== true || hasLimitedCapability(capability);
  return `
    <div class="capability-stack">
      ${status(`publish_${publishTier}`)}
      ${status(`lead_${leadTier}`)}
      ${status(`analytics_${capabilityValueLabel(capability.can_fetch_analytics)}`)}
      ${status(`reply_${capabilityValueLabel(capability.can_auto_reply)}`)}
      ${capability.requires_oauth ? status("oauth_required") : status("no_oauth")}
      ${manualRequired ? status("manual_workflow") : status("api_ready")}
    </div>
  `;
}

function mergeAccountCapabilities(account) {
  const defaults = (state.data.platform_capabilities || {})[account.platform] || {};
  return { ...defaults, ...(account.capability_override || {}) };
}

function capabilityPill(label, value) {
  return `<span class="status ${escapeHtml(capabilityValueLabel(value))}">${escapeHtml(label)}:${escapeHtml(capabilityValueLabel(value))}</span>`;
}

function capabilityValueLabel(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === "limited") return "limited";
  return "unknown";
}

function capabilityTier(values) {
  if (values.some((value) => value === true)) return "api";
  if (values.some((value) => value === "limited")) return "limited";
  return "none";
}

function hasLimitedCapability(capability) {
  return Object.values(capability || {}).some((value) => value === "limited");
}

function formatCapabilityOverride(value) {
  if (!value || Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function row(label, value) {
  return `<tr><th>${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`;
}

function tag(value) {
  return `<span class="tag">${escapeHtml(String(value))}</span>`;
}

function status(value) {
  return `<span class="status ${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

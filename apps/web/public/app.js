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
  xTab: "publish",
  xMode: "mock",
  xResearchKeywordFilter: "",
  xResearchStatusFilter: "all",
  xResearchAuthorFilter: "",
  xResearchDateFilter: "",
  xKolSort: "kol_score",
  xLeadSort: "lead_score",
  xHistoryFilter: "all",
  metaPlatformFilter: "all",
  data: null
};

const app = document.querySelector("#app");
const refreshButton = document.querySelector("#refreshButton");
const clientSelect = document.querySelector("#clientSelect");
const initialClientId = new URLSearchParams(window.location.search).get("client_id");
if (initialClientId) state.clientId = initialClientId;

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
    operator: renderOperatorDashboard,
    clients: renderClients,
    accounts: renderAccounts,
    capabilities: renderCapabilities,
    content: renderContent,
    publish: renderPublish,
    leads: renderLeads,
    xhub: renderXHub,
    metahub: renderMetaHub,
    reports: renderReports
  };
  app.innerHTML = views[state.view]();
  bindViewEvents();
}

function renderOverview() {
  const { summary, client, queue, leads, contents } = state.data;
  return `
    ${renderMetrics(summary)}
    ${renderDemoModePanel()}
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

function renderOperatorDashboard() {
  const { client, accounts, queue, records, leads, drafts, contents, variants, operations = {} } = state.data;
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayTasks = queue
    .filter((task) => safeDateKey(task.scheduled_at).slice(0, 10) === today)
    .sort((a, b) => safeDateKey(a.scheduled_at).localeCompare(safeDateKey(b.scheduled_at)));
  const weekTasks = queue
    .filter((task) => {
      const taskDate = safeDateKey(task.scheduled_at).slice(0, 10);
      return taskDate >= today && taskDate <= weekEnd;
    })
    .sort((a, b) => safeDateKey(a.scheduled_at).localeCompare(safeDateKey(b.scheduled_at)));
  const publishedToday = records.filter((record) => record.published_at?.slice(0, 10) === today);
  const dueLeads = leads
    .filter((lead) => isActionableLead(lead) && lead.next_follow_up_at && lead.next_follow_up_at.slice(0, 10) <= today)
    .sort((a, b) => safeDateKey(a.next_follow_up_at).localeCompare(safeDateKey(b.next_follow_up_at)));
  const highUnreplied = leads
    .filter((lead) => Number(lead.lead_score || 0) >= 70 && !["replied", "waiting_response", "booked", "converted", "not_interested", "spam"].includes(lead.lead_stage))
    .sort((a, b) => Number(b.lead_score || 0) - Number(a.lead_score || 0));
  const pendingDrafts = drafts.filter((draft) => ["draft", "ready_for_review"].includes(draft.approval_status || "draft") && draft.sent_status !== "sent");
  const accountIssues = accounts.filter((account) =>
    account.status !== "active" ||
    !account.posting_enabled ||
    !account.lead_tracking_enabled ||
    ["disconnected", "expired", "error"].includes(account.auth_status)
  );
  const blockedTasks = queue.filter((task) => ["blocked", "failed"].includes(task.status));
  const missingPackageTasks = todayTasks.filter((task) => !hasManualPackage(task));
  const missingBackfillTasks = queue.filter((task) => {
    if (task.status !== "published") return false;
    const record = records.find((item) => item.publish_task_id === task.publish_task_id);
    return record?.publish_mode === "manual" && !record.post_url;
  });
  const reportStatus = operations.report_status || {};
  const issues = [
    ...blockedTasks.map((task) => ({ label: `${task.platform} ${task.publish_task_id}`, detail: task.blocked_reason || task.last_error || task.error_message || task.status, view: "publish" })),
    ...missingPackageTasks.map((task) => ({ label: `${task.platform} ${task.variant_id}`, detail: "今天要发，但还没有找到手动发布包。", view: "publish" })),
    ...missingBackfillTasks.map((task) => ({ label: `${task.platform} ${task.publish_task_id}`, detail: "已标记发布，但缺少真实 post_url 回填。", view: "publish" })),
    ...accountIssues.map((account) => ({ label: account.display_name || account.account_id, detail: `${account.platform} · ${account.status} · posting:${account.posting_enabled} · leads:${account.lead_tracking_enabled} · auth:${account.auth_status}`, view: "accounts" }))
  ];

  return `
    <section class="panel operator-hero">
      <div>
        <p class="eyebrow">Daily Operator Dashboard</p>
        <h2>今日运营工作台</h2>
        <p class="muted">${escapeHtml(client.client_name)} · ${escapeHtml(today)} · 只做本地 JSON / mock / manual workflow，不会触发真实平台 API。</p>
      </div>
      <div class="inline-actions">
        <button class="action-button secondary" data-action="gotoView" data-view-target="publish">去发布队列</button>
        <button class="action-button secondary" data-action="gotoView" data-view-target="leads">去线索</button>
        <button class="action-button secondary" data-action="gotoView" data-view-target="reports">去报告</button>
      </div>
    </section>

    <div class="summary-grid operator-summary">
      <div class="metric"><span>今日待发</span><strong>${todayTasks.filter((task) => task.status !== "published" && task.status !== "cancelled").length}</strong></div>
      <div class="metric"><span>今日已发布</span><strong>${publishedToday.length}</strong></div>
      <div class="metric"><span>缺手动包</span><strong>${missingPackageTasks.length}</strong></div>
      <div class="metric"><span>待跟进线索</span><strong>${dueLeads.length}</strong></div>
      <div class="metric"><span>高分未回复</span><strong>${highUnreplied.length}</strong></div>
      <div class="metric"><span>异常提醒</span><strong>${issues.length}</strong></div>
    </div>

    <div class="panel-grid">
      <section class="panel operator-task-panel">
        <h2>今日发布任务</h2>
        <p class="muted">先导出手动包，运营人员在原生平台发布后，再回填真实 post_url。</p>
        <table class="table">
          <thead><tr><th>时间</th><th>平台/账号</th><th>内容</th><th>状态</th><th>手动包</th><th>回填</th><th>操作</th></tr></thead>
          <tbody>
            ${todayTasks.map((task) => renderOperatorTaskRow(task, contents, variants, accounts, records)).join("") || `<tr><td colspan="7" class="muted">今天没有排期任务。可以去发布队列批量排期或手动加入队列。</td></tr>`}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>今日提醒</h2>
        <div class="operator-alert-list">
          ${issues.slice(0, 10).map((issue) => `
            <article class="operator-alert">
              <strong>${escapeHtml(issue.label)}</strong>
              <p>${escapeHtml(issue.detail)}</p>
              <button class="action-button secondary" data-action="gotoView" data-view-target="${escapeHtml(issue.view)}">处理</button>
            </article>
          `).join("") || `<p class="muted">没有发现阻塞项。今天可以按计划推进。</p>`}
        </div>
      </section>
    </div>

    <div class="panel-grid" style="margin-top:24px">
      <section class="panel">
        <h2>线索跟进</h2>
        <div class="summary-grid small-summary">
          <div class="metric"><span>今日到期</span><strong>${dueLeads.length}</strong></div>
          <div class="metric"><span>高分未回复</span><strong>${highUnreplied.length}</strong></div>
          <div class="metric"><span>待审草稿</span><strong>${pendingDrafts.length}</strong></div>
          <div class="metric"><span>已预约</span><strong>${leads.filter((lead) => lead.lead_stage === "booked").length}</strong></div>
        </div>
        <table class="table compact-table">
          <thead><tr><th>线索</th><th>阶段</th><th>分数</th><th>下次跟进</th><th>建议</th></tr></thead>
          <tbody>
            ${[...dueLeads, ...highUnreplied].filter(uniqueBy("lead_id")).slice(0, 8).map((lead) => `
              <tr>
                <td><strong>${escapeHtml(lead.user_display_name || lead.user_handle || lead.lead_id)}</strong><br><span class="muted">${escapeHtml((lead.message_text || "").slice(0, 90))}</span></td>
                <td>${status(lead.lead_stage)}</td>
                <td>${escapeHtml(lead.lead_score ?? "-")}</td>
                <td>${escapeHtml(lead.next_follow_up_at || "未设置")}</td>
                <td>${escapeHtml((lead.recommended_reply || "检查线索详情并决定是否生成回复草稿。").slice(0, 120))}</td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="muted">没有今日到期或高分未回复线索。</td></tr>`}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>报告状态</h2>
        <table class="table compact-table">
          <tbody>
            ${row("今日日报", reportStatus.daily?.exists ? `已生成 · ${reportStatus.daily.path}` : `未生成 · ${reportStatus.daily?.path || ""}`)}
            ${row("本周周报", reportStatus.weekly?.exists ? `已生成 · ${reportStatus.weekly.path}` : `未生成 · ${reportStatus.weekly?.path || ""}`)}
            ${row("第一周运营计划", reportStatus.first_week_plan?.exists ? `已生成 · ${reportStatus.first_week_plan.path}` : "未生成")}
            ${row("本周排期", `${weekTasks.length} 个任务`)}
          </tbody>
        </table>
        <div class="inline-actions">
          <button class="action-button" data-action="writeReport">生成今日报告</button>
          <button class="action-button secondary" data-action="writeWeeklyReport">生成本周报告</button>
        </div>
      </section>
    </div>

    <section class="panel" style="margin-top:24px">
      <h2>今日运营 Checklist</h2>
      <div class="operator-checklist">
        ${[
          "检查今日发布任务是否都有手动发布包。",
          "逐个平台复制 caption、hashtags、CTA 和素材路径，手动发布。",
          "发布完成后回填真实 post_url，并确认 publish-records / audit log 已记录。",
          "检查评论、私信、mentions、WhatsApp 或表单，把有效互动导入线索。",
          "为高分线索生成回复草稿，人工审核后再手动回复。",
          "生成今日报告，记录发布数量、线索数量、异常任务和明天建议。"
        ].map((item) => `<label class="check-item"><input type="checkbox" /> <span>${escapeHtml(item)}</span></label>`).join("")}
      </div>
    </section>
  `;
}

function renderOperatorTaskRow(task, contents, variants, accounts, records) {
  const content = contents.find((item) => item.content_id === task.content_id);
  const variant = variants.find((item) => item.variant_id === task.variant_id);
  const account = accounts.find((item) => item.account_id === task.account_id);
  const record = records.find((item) => item.publish_task_id === task.publish_task_id);
  const packageState = getManualPackageState(task);
  return `
    <tr>
      <td>${escapeHtml(task.scheduled_at ? formatDateTime(task.scheduled_at) : "unscheduled")}</td>
      <td>${escapeHtml(task.platform)}<br><span class="muted">${escapeHtml(account?.display_name || task.account_id)}</span></td>
      <td><strong>${escapeHtml(content?.title || task.content_id)}</strong><br><span class="muted">${escapeHtml(variant?.caption?.slice(0, 90) || task.variant_id)}</span></td>
      <td>${status(task.status)} ${status(task.approval_status)}</td>
      <td>${status(packageState.status)}<br><span class="muted">${escapeHtml(packageState.label)}</span></td>
      <td>
        <input class="manual-url-input" data-task-id="${escapeHtml(task.publish_task_id)}" placeholder="post_url" value="${escapeHtml(record?.post_url || "")}" />
      </td>
      <td>
        <div class="table-actions">
          <button class="action-button secondary" data-action="manualExportTask" data-task-id="${escapeHtml(task.publish_task_id)}" data-variant-id="${escapeHtml(task.variant_id)}">导出包</button>
          <button class="action-button" data-action="manualCompleteTask" data-task-id="${escapeHtml(task.publish_task_id)}">手动完成</button>
        </div>
      </td>
    </tr>
  `;
}

function renderDemoModePanel() {
  const data = state.data;
  const { client, accounts, contents, variants, queue, records, leads, drafts, x, meta } = data;
  const highScoreLeads = leads.filter((lead) => Number(lead.lead_score || 0) >= 70).length;
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const approvedVariants = variants.filter((variant) => variant.approval_status === "approved" || variant.status === "approved");
  const pendingDrafts = drafts.filter((draft) => draft.approval_status !== "approved" || draft.sent_status === "not_sent").length;
  const metaMissing = meta?.env_status?.required_missing?.length || 0;
  const demoStages = [
    {
      label: "客户",
      value: client.client_name,
      state: client.status === "active" ? "ready" : "review",
      detail: `${client.industry} · ${client.region} · ${client.language.join(" / ")}`,
      view: "clients"
    },
    {
      label: "账号",
      value: `${activeAccounts.length}/${accounts.length}`,
      state: activeAccounts.length ? "ready" : "blocked",
      detail: "支持一个客户绑定多个 IG / X / Facebook 等账号",
      view: "accounts"
    },
    {
      label: "内容",
      value: contents.length,
      state: contents.length ? "ready" : "blocked",
      detail: `${approvedVariants.length} 个平台版本可进入发布或演示`,
      view: "content"
    },
    {
      label: "发布",
      value: `${records.length} records`,
      state: records.length ? "ready" : queue.length ? "review" : "blocked",
      detail: `${queue.filter((task) => task.status === "scheduled").length} scheduled · ${queue.filter((task) => task.status === "blocked").length} blocked`,
      view: "publish"
    },
    {
      label: "线索",
      value: leads.length,
      state: highScoreLeads ? "ready" : leads.length ? "review" : "blocked",
      detail: `${highScoreLeads} high-score · ${pendingDrafts} draft/review items`,
      view: "leads"
    },
    {
      label: "X",
      value: `${x?.research_posts?.length || 0} research`,
      state: x?.research_posts?.length || x?.kol_prospects?.length || x?.lead_candidates?.length ? "ready" : "review",
      detail: `${x?.kol_prospects?.length || 0} KOL · ${x?.lead_candidates?.length || 0} candidate · ${x?.query_history?.length || 0} queries`,
      view: "xhub"
    },
    {
      label: "Meta",
      value: metaMissing ? "manual setup" : "ready",
      state: "review",
      detail: metaMissing ? `${metaMissing} local env keys missing; dry-run/manual only` : "dry-run/manual workflow ready",
      view: "metahub"
    }
  ];

  return `
    <section class="panel demo-panel">
      <div class="row-card-head">
        <div>
          <p class="eyebrow">Client Demo Mode</p>
          <h2>演示总览：从客户运营到线索闭环</h2>
          <p class="muted">这块是给你讲 demo 用的摘要，不会触发任何真实 API。推荐演示顺序：客户、账号、内容、发布、线索、X 工作台、Meta 工作台、报告。</p>
        </div>
        <div class="tag-row">
          ${status("manual-gated")}
          ${status("no_auto_dm")}
          ${status("no_live_meta")}
        </div>
      </div>
      <div class="demo-stage-grid">
        ${demoStages.map((stage) => `
          <button class="demo-stage ${escapeHtml(stage.state)}" data-action="gotoView" data-view-target="${escapeHtml(stage.view)}">
            <span>${escapeHtml(stage.label)}</span>
            <strong>${escapeHtml(stage.value)}</strong>
            <small>${escapeHtml(stage.detail)}</small>
          </button>
        `).join("")}
      </div>
      <div class="demo-script">
        <strong>30 秒讲法：</strong>
        <span>这个系统不是单纯发帖工具，而是按客户管理账号、内容资产、平台版本、发布排期、线索跟进和报告。X 已经支持受控 API/dry-run，Meta 第一阶段只做 setup/dry-run/manual workflow。</span>
      </div>
    </section>
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
  const { accounts, platform_options, account_role_options, content_focus_options, account_stats, x_account_auth = {} } = state.data;
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
        <label class="wide binding-field binding-field-x">
          <span>X Binding JSON</span>
          <textarea name="x_binding" placeholder='{"x_username":"brand","token_ref":"x_brand_001","oauth_version":"2.0"}'></textarea>
        </label>
        <label class="wide binding-field binding-field-meta">
          <span>Meta Binding JSON</span>
          <textarea name="meta_binding" placeholder='{"page_id":"123","page_name":"Brand Page","permissions":["pages_show_list"]}'></textarea>
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
                <td>
                  ${status(account.auth_status)}
                  ${account.platform === "x" ? renderXAccountAuthSummary(x_account_auth[account.account_id]) : ""}
                  ${["facebook", "instagram"].includes(account.platform) ? renderAccountMetaSummary(account) : ""}
                </td>
                <td>${status(account.status)}</td>
                <td>${status(account.posting_enabled ? "posting_on" : "posting_off")} ${status(account.lead_tracking_enabled ? "leads_on" : "leads_off")}</td>
                <td>${renderAccountCapabilityStatus(account)}</td>
                <td>发布 ${stats.published}<br>线索 ${stats.leads}</td>
                <td>
                  <div class="table-actions">
                    <button class="action-button secondary" data-action="editAccount" data-account-id="${escapeHtml(account.account_id)}">编辑</button>
                    ${account.platform === "x" ? `<button class="action-button" data-action="connectXAccount" data-account-id="${escapeHtml(account.account_id)}">Connect X</button>` : ""}
                    ${account.platform === "x" ? `<button class="action-button secondary" data-action="checkXAccount" data-account-id="${escapeHtml(account.account_id)}">检查 X 授权</button>` : ""}
                    ${["facebook", "instagram"].includes(account.platform) ? `<button class="action-button" data-action="connectMetaAccount" data-account-id="${escapeHtml(account.account_id)}">Connect Meta</button>` : ""}
                    ${["facebook", "instagram"].includes(account.platform) ? `<button class="action-button secondary" data-action="metaAccountCheck" data-account-id="${escapeHtml(account.account_id)}">检查 Meta 绑定</button>` : ""}
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

function renderXAccountAuthSummary(auth) {
  if (!auth) return `<div class="mode-hint">X account token: unknown</div>`;
  return `
    <div class="mode-hint">
      X user: ${escapeHtml(auth.x_username || "-")}<br>
      token: ${escapeHtml(auth.token_status)} · ${escapeHtml(auth.setup_status)}<br>
      follow: ${auth.can_follow_as_user ? "yes" : "no"} · dm: ${auth.can_dm_as_user ? "yes" : "no"}<br>
      missing: ${escapeHtml((auth.missing_scopes || []).join(", ") || "none")}
    </div>
  `;
}

function renderAccountMetaSummary(account) {
  const binding = account.meta_binding || {};
  const missing = getMissingMetaBindings(account);
  return `
    <div class="mode-hint">
      Meta: ${escapeHtml(binding.setup_status || "not_started")} · token ${escapeHtml(binding.token_status || "not_configured")}<br>
      ${account.platform === "facebook"
        ? `Page: ${escapeHtml(binding.page_id || "-")}`
        : `IG: ${escapeHtml(binding.instagram_business_account_id || "-")}`}<br>
      missing: ${escapeHtml(missing.join(", ") || "none")}
    </div>
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
  }).sort((a, b) => safeDateKey(a.scheduled_at).localeCompare(safeDateKey(b.scheduled_at)));
  const todayTasks = queue.filter((task) => safeDateKey(task.scheduled_at).slice(0, 10) === today);
  const weekTasks = queue.filter((task) => {
    const taskDate = safeDateKey(task.scheduled_at).slice(0, 10);
    return taskDate >= today && taskDate <= weekEnd;
  });
  const accountDayCounts = todayTasks.reduce((acc, task) => {
    acc[task.account_id] = (acc[task.account_id] || 0) + 1;
    return acc;
  }, {});
  return `
    <section class="panel">
      <h2>Publish Queue Workspace</h2>
      <p class="muted">UI 上所有发布操作均为 <strong>Mock 模式</strong>，不会真实发帖。如果需要真实 API 发布，必须通过 CLI 执行 <code>--mode api</code>，且纯文本 X 发布需要额外加 <code>--confirm LIVE</code>。</p>
      <p class="muted">Manual Publishing Export 会生成运营人员可复制的发布包；手动发完后把真实 post_url 回填到系统，系统会写入 publish-records 和 publish-audit-log。</p>
      <div class="inline-actions">
        <button class="action-button" data-action="runPublish">运行 mock 发布</button>
        <button class="action-button secondary" data-action="batchSchedule">批量排期今日</button>
      </div>
      ${renderPublishActionNotice(state.data.publish_action_log)}
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
                <td>
                  <div class="table-actions">
                    <button class="action-button secondary" data-action="scheduleVariant" data-variant-id="${escapeHtml(variant.variant_id)}">加入队列</button>
                    <button class="action-button secondary" data-action="manualExportVariant" data-variant-id="${escapeHtml(variant.variant_id)}">导出手动包</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="5" class="muted">没有可排期的 approved variant。</td></tr>`}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>发布队列</h2>
      <table class="table">
        <thead><tr><th>内容</th><th>平台/账号</th><th>时间</th><th>状态</th><th>原因</th><th>手动回填</th><th>操作</th></tr></thead>
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
                  <p class="muted">${escapeHtml(task.published_at ? `published ${task.published_at}` : task.scheduled_at ? "" : "unscheduled")}</p>
                </td>
                <td>${status(task.status)} ${status(task.approval_status)}</td>
                <td>${escapeHtml(task.blocked_reason || task.error_message || variant?.caption.slice(0, 90) || "")}</td>
                <td>
                  <input class="manual-url-input" data-task-id="${escapeHtml(task.publish_task_id)}" placeholder="https://platform.com/post/..." value="${escapeHtml((records.find((record) => record.publish_task_id === task.publish_task_id)?.post_url) || "")}" />
                  <div class="mode-hint">手动发布后回填 URL，不会调用 API。</div>
                </td>
                <td>
                  <div class="table-actions">
                    <button class="action-button secondary" data-action="manualExportTask" data-task-id="${escapeHtml(task.publish_task_id)}" data-variant-id="${escapeHtml(task.variant_id)}">导出包</button>
                    <button class="action-button" data-action="manualCompleteTask" data-task-id="${escapeHtml(task.publish_task_id)}">手动完成</button>
                    <button class="action-button secondary" data-action="rescheduleTask" data-task-id="${escapeHtml(task.publish_task_id)}">改时间</button>
                    <button class="action-button secondary" data-action="retryTask" data-task-id="${escapeHtml(task.publish_task_id)}">重试</button>
                    <button class="action-button danger" data-action="cancelTask" data-task-id="${escapeHtml(task.publish_task_id)}">取消</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="7" class="muted">当前筛选没有发布任务。</td></tr>`}
        </tbody>
      </table>
    </section>
    <section class="panel" style="margin-top:24px">
      <h2>发布记录</h2>
      <p class="muted">已记录 ${records.length} 条发布结果，包含 mock / manual / api。手动发布回填会保留 post_url 并追加 audit log。</p>
      <div class="tag-row">
        ${Object.entries(accountDayCounts).map(([accountId, count]) => tag(`${accountId}: 今日 ${count}`)).join("")}
      </div>
      <table class="table" style="margin-top:14px">
        <thead><tr><th>记录</th><th>平台</th><th>账号</th><th>模式</th><th>发布时间</th><th>Post URL</th></tr></thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              <td>${escapeHtml(record.publish_record_id || record.record_id || record.publish_task_id)}</td>
              <td>${escapeHtml(record.platform)}</td>
              <td>${escapeHtml(record.account_id)}</td>
              <td>${status(record.publish_mode || "mock")}</td>
              <td>${escapeHtml(record.published_at || "")}</td>
              <td>${record.post_url || record.mock_url ? `<a href="${escapeHtml(record.post_url || record.mock_url)}" target="_blank">${escapeHtml(record.post_url || record.mock_url)}</a>` : ""}</td>
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

function renderXHub() {
  const x = state.data.x || {};
  const research = x.research_posts || [];
  const prospects = x.kol_prospects || [];
  const candidates = x.lead_candidates || [];
  const inbox = x.engagement_inbox || [];
  const reports = x.reports || [];
  const history = x.query_history || [];
  const usage = x.api_usage || [];
  const budget = x.budget || {};
  const jsonErrors = x.json_errors || [];
  const pendingDrafts = (state.data.drafts || []).filter((draft) => draft.platform === "x" && draft.approval_status !== "approved");
  const xRecords = (state.data.records || []).filter((record) => record.platform === "x");
  return `
    <section class="panel">
      <div class="row-card-head">
        <div>
          <h2>X Platform Module</h2>
          <p class="muted">⚠️ 安全须知 — <strong>Mock 模式</strong>只操作本地 JSON 数据，不联网不收费。<strong>API 模式</strong>会读取 X 公开信息（搜索/用户资料/帖子），不会写任何内容。<strong>estimated_cost</strong> 是内部估算单位，不是官方账单金额。<strong>Live 发布</strong>仅限 CLI 执行，必须加 <code>--confirm LIVE</code>，UI 不提供此功能。</p>
        </div>
        <div class="tag-row">
          ${status("manual_gated")}
          ${status("dry_run_default")}
          ${status(state.xMode)}
        </div>
      </div>
      <div class="summary-grid small-summary">
        <div class="metric"><span>Research Posts</span><strong>${research.length}</strong></div>
        <div class="metric"><span>KOL Prospects</span><strong>${prospects.length}</strong></div>
        <div class="metric"><span>Lead Candidates</span><strong>${candidates.length}</strong></div>
        <div class="metric"><span>Inbox Items</span><strong>${inbox.length}</strong></div>
      </div>
      <div class="filter-row">
        <label>
          <span>模式</span>
          <select id="xMode">
            ${["mock", "api"].map((mode) => `<option value="${mode}" ${state.xMode === mode ? "selected" : ""}>${mode}</option>`).join("")}
          </select>
          <span class="mode-hint">mock=安全(本地数据) · api=读取公开信息(会产生估算费用)</span>
        </label>
        <label class="wide-input">
          <span>关键词</span>
          <input id="xKeywords" placeholder="looking for, need help with, overseas social media" />
        </label>
        <label>
          <span>竞品 Username</span>
          <input id="xCompetitor" placeholder="competitor_demo" />
        </label>
      </div>
      <div class="inline-actions">
        <button class="action-button" data-action="xResearch">搜索帖子</button>
        <button class="action-button secondary" data-action="xKol">发现 KOL</button>
        <button class="action-button secondary" data-action="xCompetitor">竞品挖掘</button>
        <button class="action-button secondary" data-action="xLead">发现线索</button>
        <button class="action-button secondary" data-action="xEngagement">同步 Mentions</button>
        <button class="action-button secondary" data-action="xDm">读取 DM</button>
        <button class="action-button secondary" data-action="xReport">生成 X 报告</button>
      </div>
      ${state.data.x_action_log ? `<pre class="log-box">${escapeHtml(state.data.x_action_log)}</pre>` : ""}
    </section>

    ${renderXBudgetHistory(budget, history, usage, jsonErrors)}

    <section class="panel" style="margin-top:24px">
      <h2>安全状态</h2>
      <table class="table">
        <tbody>
          ${row("当前阶段", "Phase 1: full features, manual actions")}
          ${row("外发动作", "全部人工 gated，不自动 reply / DM / comment / follow")}
          ${row("X 发布", "dry-run 默认；live 仍需 CLI --confirm LIVE")}
          ${row("Pending X Reply Drafts", pendingDrafts.length)}
          ${row("X Publish Records", xRecords.length)}
        </tbody>
      </table>
    </section>

    <div class="x-tabs">
      ${[
        ["publish", "发布审核"],
        ["research", "research"],
        ["kol", "kol"],
        ["leads", "leads"],
        ["inbox", "inbox"],
        ["reports", "reports"]
      ].map(([tab, label]) => `<button class="action-button ${state.xTab === tab ? "" : "secondary"}" data-action="xTab" data-tab="${tab}">${label}</button>`).join("")}
    </div>

    ${state.xTab === "publish" ? renderXPublishReview() : ""}
    ${state.xTab === "research" ? renderXResearch(research) : ""}
    ${state.xTab === "kol" ? renderXKols(prospects) : ""}
    ${state.xTab === "leads" ? renderXLeadCandidates(candidates) : ""}
    ${state.xTab === "inbox" ? renderXInbox(inbox) : ""}
    ${state.xTab === "reports" ? renderXReports(reports) : ""}
  `;
}

function renderMetaHub() {
  const meta = state.data.meta || {};
  const foundation = meta.foundation || {};
  const env = meta.env_status || {};
  const accounts = (state.data.accounts || []).filter((account) => account.platform === "facebook" || account.platform === "instagram");
  const facebookAccounts = accounts.filter((account) => account.platform === "facebook");
  const instagramAccounts = accounts.filter((account) => account.platform === "instagram");
  const variants = (state.data.variants || []).filter((variant) => variant.platform === "facebook" || variant.platform === "instagram");
  const filteredVariants = variants.filter((variant) => state.metaPlatformFilter === "all" || variant.platform === state.metaPlatformFilter);
  return `
    <section class="panel">
      <div class="row-card-head">
        <div>
          <h2>Meta Platform Foundation</h2>
          <p class="muted">Facebook Page 和 Instagram 共用 Meta foundation，但账号是一对多管理：一个客户可以有多个 Facebook Page、多个 Instagram 账号。Web UI 展示 setup、dry-run、manual workflow 和 CLI 实测命令；真实 Meta API 写入只走 CLI，并且必须显式 <code>--confirm LIVE</code>。</p>
        </div>
        <div class="tag-row">
          ${status(foundation.phase || "phase_1_foundation")}
          ${status("web_live_disabled")}
          ${status("manual_gated")}
        </div>
      </div>
      <div class="summary-grid small-summary">
        <div class="metric"><span>Facebook Accounts</span><strong>${facebookAccounts.length}</strong></div>
        <div class="metric"><span>Instagram Accounts</span><strong>${instagramAccounts.length}</strong></div>
        <div class="metric"><span>Meta Variants</span><strong>${variants.length}</strong></div>
        <div class="metric"><span>Missing Env</span><strong>${(env.required_missing || []).length}</strong></div>
      </div>
    </section>

    ${renderMetaSetupStatus(foundation, env)}
    ${state.data.meta_action_log ? `<section class="panel" style="margin-top:24px"><h2>Meta Action Log</h2><pre class="log-box">${escapeHtml(state.data.meta_action_log)}</pre></section>` : ""}
    ${renderMetaAccounts("Facebook Page Accounts", facebookAccounts)}
    ${renderMetaAccounts("Instagram Accounts", instagramAccounts)}
    ${renderMetaDryRunSection(filteredVariants)}
    ${renderMetaCliLiveTestSection(facebookAccounts, instagramAccounts)}
    ${renderMetaManualWorkflow()}
    ${renderMetaSopSection()}
  `;
}

function renderMetaSetupStatus(foundation, env) {
  const rules = foundation.safety_rules || {};
  return `
    <section class="panel" style="margin-top:24px">
      <h2>Meta Setup Status</h2>
      <div class="summary-grid small-summary">
        <div class="metric"><span>Graph Version</span><strong>${escapeHtml(foundation.graph_api_version || "v23.0")}</strong></div>
        <div class="metric"><span>Real Publish</span><strong>${rules.real_publish_enabled ? "enabled" : "disabled"}</strong></div>
        <div class="metric"><span>Web Live Publish</span><strong>${rules.web_ui_live_publish_enabled ? "enabled" : "disabled"}</strong></div>
        <div class="metric"><span>Env File</span><strong>${escapeHtml(env.env_file || "MetaAPI.env")}</strong></div>
      </div>
      <div class="tag-row">
        ${status((env.required_missing || []).length ? "missing_credentials" : "ready_for_manual")}
        ${status("cli_live_test_available")}
        ${status("ready_for_manual")}
        ${rules.web_ui_live_publish_enabled ? "" : status("web_live_disabled")}
      </div>
      <table class="table compact-table">
        <tbody>
          ${row("Allowed modes", (rules.allowed_modes || ["mock", "dry_run", "manual"]).join(", "))}
          ${row("Auto reply", rules.auto_reply_enabled ? "enabled" : "disabled")}
          ${row("Auto DM", rules.auto_dm_enabled ? "enabled" : "disabled")}
          ${row("Auto comment", rules.auto_comment_enabled ? "enabled" : "disabled")}
          ${row("Auto follow", rules.auto_follow_enabled ? "enabled" : "disabled")}
          ${row("Required env present", (env.required_present || []).join(", ") || "-")}
          ${row("Required env missing", (env.required_missing || []).join(", ") || "-")}
          ${row("Optional env present", (env.optional_present || []).join(", ") || "-")}
          ${row("Token policy", env.token_storage_policy || "Do not commit tokens.")}
        </tbody>
      </table>
      <p class="muted">本区块只显示字段是否存在，不显示 token 或 secret 内容。查看页面不会调用 Meta API；CLI live test 命令才会调用 Graph API。</p>
    </section>
  `;
}

function renderMetaAccounts(title, accounts) {
  return `
    <section class="panel" style="margin-top:24px">
      <h2>${escapeHtml(title)}</h2>
      <table class="table">
        <thead><tr><th>Account</th><th>Binding</th><th>Permissions</th><th>Status</th><th>Safety</th><th>Actions</th></tr></thead>
        <tbody>
          ${accounts.map((account) => {
            const binding = account.meta_binding || {};
            const missing = getMissingMetaBindings(account);
            const permissionStatus = getMetaPermissionStatus(account);
            const tokenMissing = binding.token_status !== "configured";
            return `
              <tr>
                <td><strong>${escapeHtml(account.display_name || account.account_name)}</strong><br><span class="muted">${escapeHtml(account.account_id)} · ${escapeHtml(account.platform)}</span><br><span class="muted">${escapeHtml(account.account_url || "")}</span></td>
                <td>${renderMetaBinding(account, binding)}${missing.length ? `<div class="error">缺少：${escapeHtml(missing.join(", "))}</div>` : ""}</td>
                <td>${(binding.permissions || []).map(tag).join("") || `<span class="muted">No permissions recorded</span>`}<br>${status(permissionStatus)}</td>
                <td>${status(account.status)} ${status(account.auth_status)}<br>${status(binding.token_status || "not_configured")} ${status(binding.setup_status || "not_started")} ${tokenMissing ? status("missing_token") : ""}</td>
                <td>${account.posting_enabled ? status("posting_on") : status("posting_off")} ${account.lead_tracking_enabled ? status("lead_tracking_on") : status("lead_tracking_off")}<br><span class="muted">${escapeHtml((binding.setup_notes || []).join(" | "))}</span></td>
                <td>
                  <button class="action-button" data-action="connectMetaAccount" data-account-id="${escapeHtml(account.account_id)}">授权绑定</button>
                  <button class="action-button secondary" data-action="metaAccountCheck" data-account-id="${escapeHtml(account.account_id)}">检查账号准备度</button>
                </td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="6" class="muted">当前客户还没有这类 Meta 账号。一个客户可以绑定多个账号。</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderMetaDryRunSection(variants) {
  return `
    <section class="panel" style="margin-top:24px">
      <div class="row-card-head">
        <div>
          <h2>Meta Dry-run Preview</h2>
          <p class="muted">选择 Facebook/Instagram variant 生成 Graph API payload 预览。不会调用 Meta API，不会发帖。</p>
        </div>
        <label>
          <span>Platform</span>
          <select id="metaPlatformFilter">
            ${[["all", "All"], ["facebook", "Facebook"], ["instagram", "Instagram"]].map(([value, label]) => `<option value="${value}" ${state.metaPlatformFilter === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>
      <table class="table">
        <thead><tr><th>Variant</th><th>Account</th><th>Status</th><th>Caption</th><th>Action</th></tr></thead>
        <tbody>
          ${variants.map((variant) => {
            const account = (state.data.accounts || []).find((item) => item.account_id === variant.account_id);
            return `
              <tr>
                <td><strong>${escapeHtml(variant.variant_id)}</strong><br><span class="muted">${escapeHtml(variant.platform)} · ${escapeHtml(variant.format)}</span></td>
                <td>${escapeHtml(account?.display_name || variant.account_id)}<br><span class="muted">${escapeHtml(variant.account_id)}</span></td>
                <td>${status(variant.status)} ${status(variant.approval_status)}</td>
                <td>${escapeHtml(variant.caption)}</td>
                <td><button class="action-button secondary" data-action="metaDryRun" data-variant-id="${escapeHtml(variant.variant_id)}">生成 Meta dry-run preview</button></td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="5" class="muted">没有 Facebook / Instagram variants。</td></tr>`}
        </tbody>
      </table>
      <div class="detail-box">
        <strong>Preview examples</strong>
        <p class="muted">Facebook: Page text post, Page link post, Page photo post endpoint preview. Instagram: media container creation, media publish, image, reel/video placeholder, carousel placeholder preview.</p>
      </div>
    </section>
  `;
}

function renderMetaCliLiveTestSection(facebookAccounts, instagramAccounts) {
  const clientId = state.clientId;
  const igAccount = instagramAccounts.find((account) => account.meta_binding?.token_status === "configured") || instagramAccounts[0];
  const fbAccount = facebookAccounts.find((account) => account.meta_binding?.token_status === "configured") || facebookAccounts[0];
  const igId = igAccount?.account_id || "ig_brand_001";
  const fbId = fbAccount?.account_id || "facebook_brand_001";
  return `
    <section class="panel" style="margin-top:24px">
      <div class="row-card-head">
        <div>
          <h2>Meta Real API CLI Test Console</h2>
          <p class="muted">这些按钮会从 Web 后端直接调用 Meta Graph API。写入动作必须在 Confirm 字段输入 <code>LIVE</code>。</p>
        </div>
        <div class="tag-row">
          ${status("cli_live_test")}
          ${status("requires_confirm_live")}
          ${status("web_live_disabled")}
        </div>
      </div>
      <div class="meta-live-grid">
        ${renderMetaLiveForm("Instagram", igId, [
          ["ig_account_check", "检查账号", "read"],
          ["ig_publish_image", "发布图片", "image"],
          ["ig_publish_video", "发布 Reels/视频", "video"],
          ["ig_comments_list", "查看评论", "comments"],
          ["ig_comment_reply", "回复评论", "comment_reply"],
          ["ig_private_reply", "私密回复", "private_reply"],
          ["ig_dm_send", "发送 DM", "dm"],
          ["ig_like", "点赞对象", "like"]
        ])}
        ${renderMetaLiveForm("Facebook", fbId, [
          ["fb_account_check", "检查账号", "read"],
          ["fb_publish_post", "发布文字", "text"],
          ["fb_publish_photo", "发布图片", "image"],
          ["fb_publish_video", "发布视频", "video"],
          ["fb_comments_list", "查看评论", "comments"],
          ["fb_comment_reply", "回复评论", "comment_reply"],
          ["fb_private_reply", "私密回复", "private_reply"],
          ["fb_dm_send", "发送 DM", "dm"],
          ["fb_like", "点赞对象", "like"]
        ])}
      </div>
      <div class="detail-box">
        <strong>Known limits</strong>
        <p class="muted">Instagram official Graph API does not expose follow/unfollow. Facebook Page automation also cannot follow users. DM/reply commands require the recipient/comment context allowed by Meta permissions and messaging windows.</p>
      </div>
    </section>
  `;
}

function renderMetaLiveForm(title, accountId, actions) {
  return `
    <form class="meta-live-form tool-card" data-account-id="${escapeHtml(accountId)}">
      <h3>${escapeHtml(title)} Live Buttons</h3>
      <label><span>Account</span><input name="account_id" value="${escapeHtml(accountId)}" /></label>
      <label><span>Action</span><select name="action">${actions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}</select></label>
      <label><span>Caption / Message</span><textarea name="message" rows="3" placeholder="Caption, post text, comment reply, DM text"></textarea></label>
      <label>
        <span>Upload Local Media To R2</span>
        <input name="media_file" type="file" accept="image/*,video/*" />
      </label>
      <button class="action-button secondary" type="button" data-action="uploadR2Media">上传到 R2 并回填 URL</button>
      <label><span>Public Image URL</span><input name="image_url" placeholder="https://..." /></label>
      <label><span>Public Video URL</span><input name="video_url" placeholder="https://...mp4" /></label>
      <div class="two-column-form">
        <label><span>Media ID</span><input name="media_id" placeholder="IG media id" /></label>
        <label><span>Object ID</span><input name="object_id" placeholder="FB post/comment/media id" /></label>
        <label><span>Comment ID</span><input name="comment_id" placeholder="comment id" /></label>
        <label><span>Recipient ID</span><input name="recipient_id" placeholder="scoped recipient id" /></label>
        <label><span>Link</span><input name="link" placeholder="optional link for FB post" /></label>
        <label><span>Media Type</span><select name="media_type"><option value="REELS">REELS</option><option value="VIDEO">VIDEO</option><option value="STORIES">STORIES</option></select></label>
      </div>
      <label><span>Confirm For Writes</span><input name="confirm" placeholder="type LIVE for publish/reply/DM/like" /></label>
      <button class="action-button danger" type="submit">执行真实 API 动作</button>
    </form>
  `;
}

function renderMetaManualWorkflow() {
  const exports = state.data.meta?.manual_exports || {};
  return `
    <section class="panel" style="margin-top:24px">
      <h2>Manual Workflow Status</h2>
      <div class="summary-grid small-summary">
        ${["facebook", "instagram"].map((platform) => {
          const item = exports[platform] || {};
          return `<div class="metric"><span>${escapeHtml(platform)} export folder</span><strong>${item.exists ? "exists" : "missing"}</strong></div>`;
        }).join("")}
      </div>
      <table class="table compact-table">
        <thead><tr><th>Platform</th><th>Folder</th><th>Latest files</th></tr></thead>
        <tbody>
          ${["facebook", "instagram"].map((platform) => {
            const item = exports[platform] || {};
            return `<tr><td>${escapeHtml(platform)}</td><td>${escapeHtml(item.path || "")}</td><td>${(item.latest_files || []).map(tag).join("") || `<span class="muted">No manual export files yet</span>`}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
      <h3>Manual Posting Checklist</h3>
      <ol class="checklist">
        <li>Confirm client.</li>
        <li>Confirm platform account.</li>
        <li>Copy caption from approved variant.</li>
        <li>Upload asset manually.</li>
        <li>Publish manually on Facebook / Instagram.</li>
        <li>Paste post URL back into the system as a manual record.</li>
      </ol>
    </section>
  `;
}

function renderMetaSopSection() {
  return `
    <section class="panel" style="margin-top:24px">
      <h2>Meta SOP</h2>
      <table class="table compact-table">
        <tbody>
          ${row("OpenClaw SOP", "docs/meta-platform-sop.md")}
          ${row("Env template", "docs/meta-env-template.md")}
          ${row("Foundation config", "data/meta-platform-foundation.json")}
          ${row("Live test rule", "Web UI display/dry-run/manual only; real Meta API tests use CLI with --confirm LIVE")}
          ${row("OpenClaw real API SOP", "docs/openclaw/meta-real-api-test-sop.md")}
          ${row("Development log", "docs/development-log.md")}
        </tbody>
      </table>
    </section>
  `;
}

function renderXPublishReview() {
  const { contents, variants, queue, records, accounts } = state.data;
  const xVariants = variants.filter((variant) => variant.platform === "x");
  const xTasks = queue.filter((task) => task.platform === "x").sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const xRecords = records.filter((record) => record.platform === "x").slice().reverse();
  const contentById = new Map(contents.map((item) => [item.content_id, item]));
  const variantById = new Map(variants.map((item) => [item.variant_id, item]));
  const accountById = new Map(accounts.map((item) => [item.account_id, item]));
  const taskVariantIds = new Set(xTasks.map((task) => task.variant_id));
  const unscheduled = xVariants.filter((variant) => !taskVariantIds.has(variant.variant_id));
  return `
    <section class="panel">
      <div class="row-card-head">
        <div>
          <h2>X Publish Review</h2>
          <p class="muted">这里只做 X 发布审核、dry-run 预览和人工完成记录。不会 live publish；真实发布仍只能通过 CLI 且必须 <code>--confirm LIVE</code>。</p>
        </div>
        <div class="tag-row">
          ${status("manual_gated")}
          ${status("no_live_publish")}
        </div>
      </div>
      <div class="summary-grid small-summary">
        <div class="metric"><span>X Variants</span><strong>${xVariants.length}</strong></div>
        <div class="metric"><span>X Tasks</span><strong>${xTasks.length}</strong></div>
        <div class="metric"><span>X Records</span><strong>${xRecords.length}</strong></div>
        <div class="metric"><span>Unscheduled</span><strong>${unscheduled.length}</strong></div>
      </div>

      <h3>X Publish Queue</h3>
      <table class="table">
        <thead><tr><th>Content / Caption</th><th>Account</th><th>Schedule</th><th>Status</th><th>Readiness</th><th>Actions</th></tr></thead>
        <tbody>
          ${xTasks.map((task) => {
            const variant = variantById.get(task.variant_id);
            const content = contentById.get(task.content_id);
            const account = accountById.get(task.account_id);
            const ready = getXPublishReadiness(task, variant, content, account);
            return `
              <tr>
                <td><strong>${escapeHtml(content?.title || task.content_id)}</strong><br><span class="muted">${escapeHtml(variant?.caption || "variant missing")}</span></td>
                <td>${escapeHtml(account?.display_name || task.account_id)}<br><span class="muted">${escapeHtml(task.account_id)}</span></td>
                <td>${escapeHtml(formatDateTime(task.scheduled_at))}<br><span class="muted">${escapeHtml(task.publish_method)}</span></td>
                <td>${status(task.status)} ${status(task.approval_status)}</td>
                <td>${ready.ok ? status("ready") : status("blocked")}<br><span class="muted">${escapeHtml(ready.reason)}</span>${task.blocked_reason ? `<br><span class="muted">task: ${escapeHtml(task.blocked_reason)}</span>` : ""}</td>
                <td>
                  <div class="table-actions">
                    <button class="action-button secondary" data-action="xPublishPreview" data-task-id="${escapeHtml(task.publish_task_id)}">生成 dry-run 预览</button>
                    <button class="action-button secondary" data-action="xManualComplete" data-task-id="${escapeHtml(task.publish_task_id)}">标记人工已发布</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("") || `<tr><td colspan="6" class="muted">还没有 X publish tasks。请先在发布队列里排期 platform=x 的 approved variant。</td></tr>`}
        </tbody>
      </table>

      <h3>Approved X Variants</h3>
      <table class="table compact-table">
        <thead><tr><th>Variant</th><th>Content</th><th>Account</th><th>Status</th><th>Caption</th></tr></thead>
        <tbody>
          ${xVariants.map((variant) => {
            const content = contentById.get(variant.content_id);
            const account = accountById.get(variant.account_id);
            return `<tr>
              <td>${escapeHtml(variant.variant_id)}</td>
              <td>${escapeHtml(content?.title || variant.content_id)}</td>
              <td>${escapeHtml(account?.display_name || variant.account_id)}</td>
              <td>${status(variant.status)} ${status(variant.approval_status)}</td>
              <td>${escapeHtml(variant.caption)}</td>
            </tr>`;
          }).join("") || `<tr><td colspan="5" class="muted">还没有 X variants。</td></tr>`}
        </tbody>
      </table>

      <h3>X Publish Records</h3>
      <table class="table compact-table">
        <thead><tr><th>Time</th><th>Mode</th><th>Account</th><th>Post</th><th>Task</th></tr></thead>
        <tbody>
          ${xRecords.map((record) => `<tr>
            <td>${escapeHtml(formatDateTime(record.published_at))}</td>
            <td>${status(record.publish_mode)}</td>
            <td>${escapeHtml(record.account_id)}</td>
            <td>${record.post_url ? `<a href="${escapeHtml(record.post_url)}" target="_blank">${escapeHtml(record.platform_post_id)}</a>` : escapeHtml(record.platform_post_id)}</td>
            <td>${escapeHtml(record.publish_task_id)}</td>
          </tr>`).join("") || `<tr><td colspan="5" class="muted">还没有 X publish records。</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderXResearch(items) {
  const filtered = items.filter((item) => {
    const keyword = state.xResearchKeywordFilter.toLowerCase();
    const author = state.xResearchAuthorFilter.toLowerCase();
    const keywordMatch = !keyword || item.text.toLowerCase().includes(keyword) || (item.matched_keywords || []).some((value) => value.toLowerCase().includes(keyword));
    const statusMatch = state.xResearchStatusFilter === "all" || item.research_status === state.xResearchStatusFilter;
    const authorMatch = !author || item.username.toLowerCase().includes(author) || item.author_id.toLowerCase().includes(author);
    const dateMatch = !state.xResearchDateFilter || (item.saved_at || "").slice(0, 10) === state.xResearchDateFilter;
    return keywordMatch && statusMatch && authorMatch && dateMatch;
  });
  return `
    <section class="panel">
      <h2>X Research Posts</h2>
      <div class="filter-row">
        <label><span>Keyword</span><input id="xResearchKeywordFilter" value="${escapeHtml(state.xResearchKeywordFilter)}" placeholder="keyword or text" /></label>
        <label><span>Status</span><select id="xResearchStatusFilter">${["all", "suggested", "draft", "approved", "rejected", "manually_completed"].map((item) => `<option value="${item}" ${state.xResearchStatusFilter === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
        <label><span>Date</span><input id="xResearchDateFilter" type="date" value="${escapeHtml(state.xResearchDateFilter)}" /></label>
        <label><span>Author</span><input id="xResearchAuthorFilter" value="${escapeHtml(state.xResearchAuthorFilter)}" placeholder="@username or ID" /></label>
      </div>
      <table class="table">
        <thead><tr><th>Post</th><th>Author</th><th>Metrics</th><th>Keywords</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${filtered.map((item) => `
            <tr>
              <td><a href="${escapeHtml(item.post_url)}" target="_blank">${escapeHtml(item.post_id)}</a><br>${escapeHtml(item.text)}</td>
              <td>@${escapeHtml(item.username)}<br><span class="muted">${escapeHtml(item.author_id)}</span></td>
              <td>${metricText(item.public_metrics)}</td>
              <td>${(item.matched_keywords || []).map(tag).join("")}</td>
              <td>${status(item.research_status || "suggested")}</td>
              <td>
                <div class="table-actions">
                  <button class="action-button secondary" data-action="xSaveContentIdea" data-post-id="${escapeHtml(item.post_id)}">保存为内容灵感</button>
                  <button class="action-button secondary" data-action="xMarkResearchRelevant" data-post-id="${escapeHtml(item.post_id)}">相关</button>
                  <button class="action-button danger" data-action="xMarkResearchIrrelevant" data-post-id="${escapeHtml(item.post_id)}">无关</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="6" class="muted">还没有匹配的 research posts。</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderXBudgetHistory(budget, history, usage, jsonErrors) {
  const filteredHistory = history.filter((item) => {
    if (state.xHistoryFilter === "blocked") return String(item.result_file || "").startsWith("blocked:");
    if (state.xHistoryFilter === "estimate") return String(item.result_file || "").includes("estimate-only");
    if (state.xHistoryFilter === "api") return item.mode === "api";
    return true;
  }).slice().reverse().slice(0, 12);
  const recentUsage = usage.slice().reverse().slice(0, 8);
  const budgetRemaining = budget.budget_remaining === null ? "unlimited" : budget.budget_remaining;
  return `
    <section class="panel" style="margin-top:24px">
      <div class="row-card-head">
        <div>
          <h2>Budget & Query History</h2>
          <p class="muted">只展示本地 JSON 记录；这里不会触发 API 调用。</p>
        </div>
        <label>
          <span>History filter</span>
          <select id="xHistoryFilter">
            ${[["all", "All"], ["api", "API mode"], ["estimate", "Estimate-only"], ["blocked", "Blocked"]].map(([value, label]) => `<option value="${value}" ${state.xHistoryFilter === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>
      ${jsonErrors.length ? `<div class="error-list">${jsonErrors.map((item) => `<div class="error">JSON 读取错误：${escapeHtml(item.file)} - ${escapeHtml(item.message)}</div>`).join("")}</div>` : ""}
      <div class="summary-grid small-summary">
        <div class="metric"><span>Monthly Budget</span><strong>${escapeHtml(budget.monthly_api_budget ?? 0)}</strong></div>
        <div class="metric"><span>Used</span><strong>${escapeHtml(budget.budget_used ?? 0)}</strong></div>
        <div class="metric"><span>Remaining</span><strong>${escapeHtml(budgetRemaining)}</strong></div>
        <div class="metric"><span>Max / Command</span><strong>${escapeHtml(budget.max_cost_per_command ?? 0)}</strong></div>
      </div>
      <p class="muted cost-note">所有 <strong>Cost / estimated_cost</strong> 均为内部估算单位，不代表 X API 官方账单金额。Estimate-only 模式可预览费用但不触发实际 API 调用。</p>
      <table class="table compact-table">
        <thead><tr><th>Time</th><th>Command</th><th>Mode</th><th>Cost</th><th>Result</th></tr></thead>
        <tbody>
          ${filteredHistory.map((item) => `
            <tr>
              <td>${escapeHtml(formatDateTime(item.created_at))}</td>
              <td>${escapeHtml(item.command || "")}<br><span class="muted">${escapeHtml((item.keywords || []).join(", "))}</span></td>
              <td>${status(item.mode || "mock")}</td>
              <td>${escapeHtml(item.estimated_cost ?? 0)}<br><span class="muted">api ${escapeHtml(item.api_calls ?? 0)} · cache ${escapeHtml(item.cache_hits ?? 0)}</span></td>
              <td>${String(item.result_file || "").startsWith("blocked:") ? status("blocked") : String(item.result_file || "").includes("estimate-only") ? status("estimate-only") : status("recorded")}<br><span class="muted">${escapeHtml(item.result_file || "")}</span></td>
            </tr>
          `).join("") || `<tr><td colspan="5" class="muted">还没有查询历史。运行 X mock 或 estimate-only 后会出现在这里。</td></tr>`}
        </tbody>
      </table>
      <details class="detail-box">
        <summary>Recent API Usage Ledger</summary>
        <table class="table compact-table">
          <thead><tr><th>Time</th><th>Path</th><th>Cost</th><th>Cache</th></tr></thead>
          <tbody>
            ${recentUsage.map((item) => `<tr><td>${escapeHtml(formatDateTime(item.timestamp))}</td><td>${escapeHtml(item.path || "")}</td><td>${escapeHtml(item.cost_units ?? 0)}</td><td>${escapeHtml(String(item.cache_hit ?? false))}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">还没有真实 API usage。</td></tr>`}
          </tbody>
        </table>
      </details>
    </section>
  `;
}

function renderXKols(items) {
  const sorted = items.slice().sort((a, b) => xKolSortValue(b, state.xKolSort) - xKolSortValue(a, state.xKolSort));
  return `
    <section class="panel">
      <h2>KOL Prospects</h2>
      <div class="filter-row">
        <label><span>Sort</span><select id="xKolSort">${[
          ["kol_score", "KOL score"],
          ["priority", "Priority"],
          ["follower_count", "Follower count"],
          ["engagement_score", "Engagement score"],
          ["content_match", "Content match"],
          ["audience_fit", "Audience fit"],
          ["collaboration", "Collaboration"]
        ].map(([value, label]) => `<option value="${value}" ${state.xKolSort === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      </div>
      <table class="table">
        <thead><tr><th>KOL</th><th>Source</th><th>Score</th><th>Keywords</th><th>Status / Notes</th><th>Actions</th></tr></thead>
        <tbody>
          ${sorted.map((item) => `
            <tr>
              <td><a href="${escapeHtml(item.profile_url)}" target="_blank">@${escapeHtml(item.username)}</a><br><strong>${escapeHtml(item.display_name || item.username)}</strong><br><span class="muted">${escapeHtml(item.bio || "")}</span></td>
              <td>${escapeHtml(item.source)}</td>
              <td><strong>${escapeHtml(item.kol_score)}</strong> ${status(item.kol_priority || "watchlist")}<br>${metricText(item.public_metrics)}<br><span class="muted">match ${xKolSortValue(item, "content_match")} · eng ${xKolSortValue(item, "engagement_score")} · follower ${escapeHtml(item.follower_score || 0)} · audience ${escapeHtml(item.audience_fit_score || 0)} · collab ${escapeHtml(item.collaboration_score || 0)}</span></td>
              <td>${(item.matched_keywords || []).map(tag).join("")}</td>
              <td>
                ${status(item.collaboration_status || "new")} ${status(item.prospect_status || "suggested")}
                <textarea class="x-kol-notes" data-prospect-id="${escapeHtml(item.prospect_id)}">${escapeHtml(item.notes || "")}</textarea>
              </td>
              <td>
                <div class="table-actions">
                  ${["priority", "contacted", "rejected", "watchlist"].map((value) => `<button class="action-button secondary" data-action="xKolStatus" data-prospect-id="${escapeHtml(item.prospect_id)}" data-status="${value}">${value}</button>`).join("")}
                  <button class="action-button" data-action="xKolSaveNotes" data-prospect-id="${escapeHtml(item.prospect_id)}">保存备注</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="6" class="muted">还没有 KOL prospects。</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderXLeadCandidates(items) {
  const sorted = items.slice().sort((a, b) => xLeadSortValue(b, state.xLeadSort) - xLeadSortValue(a, state.xLeadSort));
  return `
    <section class="panel">
      <h2>X Lead Candidates</h2>
      <div class="filter-row">
        <label><span>Sort</span><select id="xLeadSort">${[
          ["lead_score", "Lead score"],
          ["date", "Newest"]
        ].map(([value, label]) => `<option value="${value}" ${state.xLeadSort === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      </div>
      <table class="table">
        <thead><tr><th>Candidate</th><th>Scores</th><th>Keywords</th><th>Reply Draft</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${sorted.map((item) => `
            <tr>
              <td><a href="${escapeHtml(item.source_url)}" target="_blank">@${escapeHtml(item.username)}</a><br>${escapeHtml(item.message_text)}</td>
              <td><strong>${escapeHtml(item.intent_score)}</strong> ${status(item.lead_priority || "unknown")}<br><span class="muted">buyer ${escapeHtml(item.buyer_intent_score ?? "-")} · industry ${escapeHtml(item.industry_match_score ?? "-")} · urgency ${escapeHtml(item.urgency_score ?? "-")} · negative ${escapeHtml(item.negative_score ?? "-")} · reply ${escapeHtml(item.reply_value_score ?? "-")}</span></td>
              <td>${(item.matched_keywords || []).map(tag).join("")}</td>
              <td>${escapeHtml(item.recommended_reply || "")}</td>
              <td>${status(item.candidate_status || "suggested")}</td>
              <td>
                <div class="table-actions">
                  <button class="action-button secondary" data-action="xConvertLead" data-candidate-id="${escapeHtml(item.candidate_id)}">转为正式线索</button>
                  <button class="action-button" data-action="xCandidateReply" data-candidate-id="${escapeHtml(item.candidate_id)}">生成回复草稿</button>
                  <button class="action-button secondary" data-action="xCandidateHandled" data-candidate-id="${escapeHtml(item.candidate_id)}">handled</button>
                  <button class="action-button danger" data-action="xCandidateIrrelevant" data-candidate-id="${escapeHtml(item.candidate_id)}">无关</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="6" class="muted">还没有 lead candidates。</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderXInbox(items) {
  return `
    <section class="panel">
      <h2>X Engagement Inbox</h2>
      <table class="table">
        <thead><tr><th>Interaction</th><th>Type</th><th>Class</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank">@${escapeHtml(item.username)}</a>` : `@${escapeHtml(item.username)}`}<br>${escapeHtml(item.text)}</td>
              <td>${escapeHtml(item.source_type)}</td>
              <td>
                <select class="x-inbox-classification" data-engagement-id="${escapeHtml(item.engagement_id)}">
                  ${["lead", "complaint", "question", "partnership", "spam", "general_engagement"].map((value) => `<option value="${value}" ${item.classification === value ? "selected" : ""}>${value}</option>`).join("")}
                </select>
              </td>
              <td>${escapeHtml(item.lead_score)}</td>
              <td>${status(item.action_status || "suggested")}</td>
              <td>
                <div class="table-actions">
                  <button class="action-button secondary" data-action="xInboxClassify" data-engagement-id="${escapeHtml(item.engagement_id)}">保存分类</button>
                  <button class="action-button secondary" data-action="xInboxConvertLead" data-engagement-id="${escapeHtml(item.engagement_id)}">转线索</button>
                  <button class="action-button" data-action="xInboxReply" data-engagement-id="${escapeHtml(item.engagement_id)}">生成回复草稿</button>
                  <button class="action-button secondary" data-action="xInboxHandled" data-engagement-id="${escapeHtml(item.engagement_id)}">handled</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="6" class="muted">还没有 inbox items。</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderXReports(items) {
  const x = state.data.x || {};
  const budget = x.budget || {};
  const history = x.query_history || [];
  const latestCosts = history.slice(-10).reduce((total, item) => total + Number(item.estimated_cost || 0), 0);
  return `
    <section class="panel">
      <h2>X Reports</h2>
      ${items.map((report) => `
        <article class="row-card" style="margin-bottom:14px">
          <h3>${escapeHtml(report.date || "report")}</h3>
          <p class="muted">${escapeHtml(report.phase || "")}</p>
          <div class="summary-grid small-summary">
            <div class="metric"><span>Published</span><strong>${(report.published_posts || []).length}</strong></div>
            <div class="metric"><span>Research</span><strong>${(report.top_posts || []).length}</strong></div>
            <div class="metric"><span>KOL</span><strong>${(report.new_kol_prospects || []).length}</strong></div>
            <div class="metric"><span>Leads</span><strong>${(report.new_lead_candidates || []).length}</strong></div>
            <div class="metric"><span>Drafts</span><strong>${(report.pending_reply_drafts || []).length}</strong></div>
          </div>
          <h4>API Usage Summary</h4>
          <table class="table compact-table"><tbody>
            ${row("Budget used", budget.budget_used ?? 0)}
            ${row("Budget remaining", budget.budget_remaining === null ? "unlimited" : budget.budget_remaining)}
            ${row("Recent estimated cost", latestCosts)}
          </tbody></table>
          <h4>Recommended Actions</h4>
          <ul>${(report.recommended_next_actions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h4>Pending Actions</h4>
          <p class="muted">Pending drafts: ${(report.pending_reply_drafts || []).length}; New KOLs: ${(report.new_kol_prospects || []).length}; New leads: ${(report.new_lead_candidates || []).length}</p>
        </article>
      `).join("") || `<p class="muted">还没有 X report。</p>`}
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

function isActionableLead(lead) {
  return !["converted", "not_interested", "spam"].includes(lead.lead_stage);
}

function uniqueBy(key) {
  const seen = new Set();
  return (item) => {
    const value = item?.[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  };
}

function hasManualPackage(task) {
  return getManualPackageState(task).status === "ready";
}

function getManualPackageState(task) {
  const platformExports = state.data.operations?.manual_exports?.[task.platform];
  if (!platformExports?.exists) {
    return { status: "missing", label: "exports folder missing" };
  }
  const files = platformExports.latest_files || [];
  const matched = files.find((file) => file.includes(task.variant_id));
  if (matched) {
    return { status: "ready", label: matched };
  }
  return { status: "missing", label: "no package for variant" };
}

function renderPublishActionNotice(rawLog) {
  if (!rawLog) return "";
  try {
    const log = JSON.parse(rawLog);
    if (log?.ok && log?.message) {
      return `
        <div class="success-box">
          <strong>${escapeHtml(log.message)}</strong>
          <p>平台：${escapeHtml(log.platform || "-")} · 账号：${escapeHtml(log.account_id || "-")} · Variant：${escapeHtml(log.variant_id || "-")}</p>
          <table class="table compact-table">
            <tbody>
              ${row("Markdown 发布包", log.markdown_path || "-")}
              ${row("JSON 发布包", log.json_path || "-")}
              ${row("Publish Task", log.publish_task_id || "未绑定队列任务")}
            </tbody>
          </table>
          <p class="muted">这是导出结果，不是报错。没有调用任何平台 API，也没有真实发布。</p>
        </div>
      `;
    }
  } catch {
    return `<pre class="log-box">${escapeHtml(rawLog)}</pre>`;
  }
  return `<pre class="log-box">${escapeHtml(rawLog)}</pre>`;
}

function bindViewEvents() {
  document.querySelectorAll("[data-action='gotoView']").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.viewTarget;
      if (!target) return;
      state.view = target;
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.view === target);
      });
      render();
    });
  });

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
  document.querySelectorAll("[data-action='manualExportVariant']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/publish/manual-export", {
      client_id: state.clientId,
      variant_id: button.dataset.variantId
    }));
  });
  document.querySelectorAll("[data-action='manualExportTask']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/publish/manual-export", {
      client_id: state.clientId,
      variant_id: button.dataset.variantId,
      publish_task_id: button.dataset.taskId
    }));
  });
  document.querySelectorAll("[data-action='manualCompleteTask']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`.manual-url-input[data-task-id="${cssEscape(button.dataset.taskId)}"]`);
      const postUrl = input?.value?.trim();
      if (!postUrl) {
        alert("请先填写手动发布后的 post_url。");
        return;
      }
      postJson("/api/publish/manual-complete", {
        client_id: state.clientId,
        publish_task_id: button.dataset.taskId,
        post_url: postUrl
      });
    });
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

  const xMode = document.querySelector("#xMode");
  if (xMode) {
    xMode.addEventListener("change", (event) => {
      state.xMode = event.target.value;
      render();
    });
  }

  const metaPlatformFilter = document.querySelector("#metaPlatformFilter");
  if (metaPlatformFilter) {
    metaPlatformFilter.addEventListener("change", (event) => {
      state.metaPlatformFilter = event.target.value;
      render();
    });
  }

  document.querySelectorAll("[data-action='metaAccountCheck']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/meta/account/check", {
      client_id: state.clientId,
      account_id: button.dataset.accountId
    }));
  });

  document.querySelectorAll("[data-action='metaDryRun']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/meta/publish/dry-run", {
      client_id: state.clientId,
      variant_id: button.dataset.variantId
    }));
  });

  document.querySelectorAll(".meta-live-form").forEach((form) => {
    form.querySelector("[data-action='uploadR2Media']")?.addEventListener("click", async () => {
      const fileInput = form.querySelector("input[name='media_file']");
      const file = fileInput?.files?.[0];
      if (!file) {
        alert("请选择一个本地图片或视频文件。");
        return;
      }
      const upload = await uploadMediaToR2(form, file);
      const target = file.type.startsWith("video/") ? form.querySelector("input[name='video_url']") : form.querySelector("input[name='image_url']");
      if (target) target.value = upload.url;
      alert(`上传完成：${upload.url}`);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const action = String(data.get("action") || "");
      const isWrite = !action.endsWith("_account_check") && !action.endsWith("_comments_list");
      if (isWrite && String(data.get("confirm") || "") !== "LIVE") {
        alert("真实写入动作必须在 Confirm 字段输入 LIVE。");
        return;
      }
      if (isWrite && !window.confirm("确认要调用真实 Meta API 执行写入动作？")) return;
      await postJson("/api/meta/live-action", {
        client_id: state.clientId,
        account_id: String(data.get("account_id") || form.dataset.accountId || ""),
        action,
        confirm: String(data.get("confirm") || ""),
        caption: String(data.get("message") || ""),
        message: String(data.get("message") || ""),
        image_url: String(data.get("image_url") || ""),
        video_url: String(data.get("video_url") || ""),
        media_id: String(data.get("media_id") || ""),
        object_id: String(data.get("object_id") || ""),
        comment_id: String(data.get("comment_id") || ""),
        recipient_id: String(data.get("recipient_id") || ""),
        link: String(data.get("link") || ""),
        media_type: String(data.get("media_type") || "REELS")
      });
    });
  });

  document.querySelectorAll("[data-action='xTab']").forEach((button) => {
    button.addEventListener("click", () => {
      state.xTab = button.dataset.tab;
      render();
    });
  });

  document.querySelectorAll("[data-action='xPublishPreview']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/publish/dry-run-preview", {
      client_id: state.clientId,
      publish_task_id: button.dataset.taskId
    }));
  });
  document.querySelectorAll("[data-action='xManualComplete']").forEach((button) => {
    button.addEventListener("click", () => {
      const confirmed = window.confirm("这只会把本地 JSON 任务标记为人工已发布，不会调用 X API。确认继续？");
      if (!confirmed) return;
      postJson("/api/x/publish/manual-complete", {
        client_id: state.clientId,
        publish_task_id: button.dataset.taskId
      });
    });
  });

  bindValueToState("#xResearchKeywordFilter", "xResearchKeywordFilter");
  bindValueToState("#xResearchStatusFilter", "xResearchStatusFilter");
  bindValueToState("#xResearchAuthorFilter", "xResearchAuthorFilter");
  bindValueToState("#xResearchDateFilter", "xResearchDateFilter");
  bindValueToState("#xKolSort", "xKolSort");
  bindValueToState("#xLeadSort", "xLeadSort");
  bindValueToState("#xHistoryFilter", "xHistoryFilter");

  const xActions = {
    xResearch: "research",
    xKol: "kol",
    xCompetitor: "competitor",
    xLead: "lead",
    xEngagement: "engagement",
    xDm: "dm",
    xReport: "report"
  };
  Object.entries(xActions).forEach(([action, xAction]) => {
    document.querySelectorAll(`[data-action='${action}']`).forEach((button) => {
      button.addEventListener("click", () => postJson("/api/x/action", {
        client_id: state.clientId,
        action: xAction,
        mode: document.querySelector("#xMode")?.value || state.xMode,
        keywords: document.querySelector("#xKeywords")?.value || "",
        username: document.querySelector("#xCompetitor")?.value || "competitor_demo"
      }));
    });
  });

  document.querySelectorAll("[data-action='xSaveContentIdea']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/research/save-content", {
      client_id: state.clientId,
      post_id: button.dataset.postId
    }));
  });
  document.querySelectorAll("[data-action='xMarkResearchRelevant']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/research/update", {
      client_id: state.clientId,
      post_id: button.dataset.postId,
      research_status: "approved"
    }));
  });
  document.querySelectorAll("[data-action='xMarkResearchIrrelevant']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/research/update", {
      client_id: state.clientId,
      post_id: button.dataset.postId,
      research_status: "rejected"
    }));
  });
  document.querySelectorAll("[data-action='xKolStatus']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/kol/update", {
      client_id: state.clientId,
      prospect_id: button.dataset.prospectId,
      collaboration_status: button.dataset.status,
      prospect_status: button.dataset.status === "rejected" ? "rejected" : "suggested"
    }));
  });
  document.querySelectorAll("[data-action='xKolSaveNotes']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`.x-kol-notes[data-prospect-id="${cssEscape(button.dataset.prospectId)}"]`);
      postJson("/api/x/kol/update", {
        client_id: state.clientId,
        prospect_id: button.dataset.prospectId,
        notes: input?.value || ""
      });
    });
  });
  document.querySelectorAll("[data-action='xConvertLead']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/lead/convert", {
      client_id: state.clientId,
      candidate_id: button.dataset.candidateId,
      generate_reply: false
    }));
  });
  document.querySelectorAll("[data-action='xCandidateReply']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/lead/reply-draft", {
      client_id: state.clientId,
      candidate_id: button.dataset.candidateId
    }));
  });
  document.querySelectorAll("[data-action='xCandidateHandled']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/lead/update", {
      client_id: state.clientId,
      candidate_id: button.dataset.candidateId,
      candidate_status: "manually_completed"
    }));
  });
  document.querySelectorAll("[data-action='xCandidateIrrelevant']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/lead/update", {
      client_id: state.clientId,
      candidate_id: button.dataset.candidateId,
      candidate_status: "rejected"
    }));
  });
  document.querySelectorAll("[data-action='xInboxClassify']").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`.x-inbox-classification[data-engagement-id="${cssEscape(button.dataset.engagementId)}"]`);
      postJson("/api/x/engagement/update", {
        client_id: state.clientId,
        engagement_id: button.dataset.engagementId,
        classification: input?.value || "general_engagement"
      });
    });
  });
  document.querySelectorAll("[data-action='xInboxReply']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/engagement/reply-draft", {
      client_id: state.clientId,
      engagement_id: button.dataset.engagementId
    }));
  });
  document.querySelectorAll("[data-action='xInboxConvertLead']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/engagement/convert-lead", {
      client_id: state.clientId,
      engagement_id: button.dataset.engagementId
    }));
  });
  document.querySelectorAll("[data-action='xInboxHandled']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/engagement/update", {
      client_id: state.clientId,
      engagement_id: button.dataset.engagementId,
      action_status: "manually_completed"
    }));
  });

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
    accountForm.platform.addEventListener("change", () => updateAccountBindingFields(accountForm));
    updateAccountBindingFields(accountForm);
    accountForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(accountForm);
      const accountId = String(form.get("account_id") || "").trim();
      const overrideText = String(form.get("capability_override") || "").trim();
      const xBindingText = String(form.get("x_binding") || "").trim();
      const metaBindingText = String(form.get("meta_binding") || "").trim();
      const platform = String(form.get("platform") || "instagram");
      const payload = {
        client_id: state.clientId,
        account_id: accountId || undefined,
        platform,
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
        capability_override: overrideText ? JSON.parse(overrideText) : {},
        x_binding: platform === "x" && xBindingText ? JSON.parse(xBindingText) : undefined,
        meta_binding: ["facebook", "instagram"].includes(platform) && metaBindingText ? JSON.parse(metaBindingText) : undefined
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
  document.querySelectorAll("[data-action='checkXAccount']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/x/account/check", {
      client_id: state.clientId,
      account_id: button.dataset.accountId
    }));
  });
  document.querySelectorAll("[data-action='connectXAccount']").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/auth/x/start?client_id=${encodeURIComponent(state.clientId)}&account_id=${encodeURIComponent(button.dataset.accountId)}`;
    });
  });
  document.querySelectorAll("[data-action='connectMetaAccount']").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/auth/meta/start?client_id=${encodeURIComponent(state.clientId)}&account_id=${encodeURIComponent(button.dataset.accountId)}`;
    });
  });
  document.querySelectorAll("[data-action='resetAccountForm']").forEach((button) => {
    button.addEventListener("click", () => resetAccountForm());
  });
}

async function uploadMediaToR2(form, file) {
  const data = new FormData();
  data.set("client_id", state.clientId);
  data.set("platform", String(form.querySelector("select[name='action']")?.value || "meta").split("_")[0]);
  data.set("file", file);
  const res = await fetch("/api/media/r2-upload", {
    method: "POST",
    body: data
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "R2 上传失败");
  return payload;
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

function safeDateKey(value) {
  return value ? String(value) : "9999-12-31T23:59:59.999Z";
}

function getXPublishReadiness(task, variant, content, account) {
  if (!content) return { ok: false, reason: "content missing" };
  if (content.status !== "approved" || !content.approved_by_human) return { ok: false, reason: "content not approved" };
  if (!variant) return { ok: false, reason: "variant missing" };
  if (variant.status !== "approved" || variant.approval_status !== "approved") return { ok: false, reason: "variant not approved" };
  if (!account) return { ok: false, reason: "account missing" };
  if (account.platform !== "x") return { ok: false, reason: "account is not X" };
  if (account.status !== "active") return { ok: false, reason: "account inactive" };
  if (!account.posting_enabled) return { ok: false, reason: "posting disabled" };
  if (task.status === "cancelled") return { ok: false, reason: "task cancelled" };
  if (task.status === "blocked") return { ok: false, reason: task.blocked_reason || "task blocked" };
  if (task.status === "published") return { ok: true, reason: "already published / recorded" };
  if (task.approval_status !== "approved") return { ok: false, reason: "task approval missing" };
  if (task.publish_method === "official_api" && account.auth_status !== "connected") return { ok: false, reason: "official API requires connected auth" };
  return { ok: true, reason: "ready for dry-run preview / manual workflow" };
}

function getMissingMetaBindings(account) {
  const binding = account.meta_binding || {};
  const requiredBindings = account.platform === "facebook"
    ? ["page_id", "page_name"]
    : account.platform === "instagram"
      ? ["instagram_business_account_id", "instagram_username", "connected_facebook_page_id"]
      : [];
  const missing = requiredBindings.filter((field) => !binding[field]);
  if ((binding.permissions || []).length === 0) missing.push("permissions");
  if (binding.token_status !== "configured") missing.push("token");
  return missing;
}

function getMetaPermissionStatus(account) {
  const permissions = account.meta_binding?.permissions || [];
  const required = account.platform === "facebook"
    ? ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_metadata"]
    : ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "pages_show_list", "pages_read_engagement"];
  return required.every((permission) => permissions.includes(permission)) ? "permissions_ready" : "missing_permissions";
}

function renderMetaBinding(account, binding) {
  if (account.platform === "facebook") {
    return `
      <div><strong>Page ID:</strong> ${escapeHtml(binding.page_id || "-")}</div>
      <div><strong>Page:</strong> ${escapeHtml(binding.page_name || "-")}</div>
      <div><strong>Business:</strong> ${escapeHtml(binding.business_id || "-")}</div>
    `;
  }
  return `
    <div><strong>IG User ID:</strong> ${escapeHtml(binding.instagram_business_account_id || "-")}</div>
    <div><strong>Username:</strong> ${escapeHtml(binding.instagram_username || "-")}</div>
    <div><strong>Connected Page:</strong> ${escapeHtml(binding.connected_facebook_page_id || "-")}</div>
    <div><strong>Page Name:</strong> ${escapeHtml(binding.connected_facebook_page_name || binding.page_name || "-")}</div>
  `;
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
  form.x_binding.value = formatCapabilityOverride(account.x_binding);
  form.meta_binding.value = formatCapabilityOverride(account.meta_binding);
  updateAccountBindingFields(form);
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
  form.x_binding.value = "";
  form.meta_binding.value = "";
  updateAccountBindingFields(form);
}

function updateAccountBindingFields(form) {
  const platform = form.platform?.value;
  form.querySelectorAll(".binding-field-x").forEach((field) => {
    field.style.display = platform === "x" ? "" : "none";
  });
  form.querySelectorAll(".binding-field-meta").forEach((field) => {
    field.style.display = ["facebook", "instagram"].includes(platform) ? "" : "none";
  });
}

function bindValueToState(selector, key) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.addEventListener("change", (event) => {
    state[key] = event.target.value;
    render();
  });
}

function xKolSortValue(item, sortKey) {
  if (sortKey === "priority") return { high_priority: 4, medium_priority: 3, watchlist: 2, ignored: 1 }[item.kol_priority] || 0;
  if (sortKey === "follower_count") return Number(item.public_metrics?.followers_count || 0);
  if (sortKey === "engagement_score") return Number(item.engagement_score ?? metricTotal(item.public_metrics || {}));
  if (sortKey === "content_match") return Number(item.content_match_score ?? (item.matched_keywords || []).length * 10);
  if (sortKey === "audience_fit") return Number(item.audience_fit_score || 0);
  if (sortKey === "collaboration") return Number(item.collaboration_score || 0);
  return Number(item.kol_score || 0);
}

function xLeadSortValue(item, sortKey) {
  if (sortKey === "date") return Date.parse(item.saved_at || item.updated_at || "") || 0;
  return Number(item.intent_score || 0);
}

function metricTotal(metrics = {}) {
  return Number(metrics.like_count || 0) + Number(metrics.reply_count || 0) * 3 + Number(metrics.retweet_count || 0) * 4 + Number(metrics.quote_count || 0) * 5 + Number(metrics.impression_count || 0) / 100;
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

function metricText(metrics = {}) {
  return [
    ["like", metrics.like_count],
    ["reply", metrics.reply_count],
    ["rt", metrics.retweet_count],
    ["quote", metrics.quote_count],
    ["impr", metrics.impression_count]
  ].filter(([, value]) => value !== undefined).map(([label, value]) => `${label}:${value}`).join(" · ") || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

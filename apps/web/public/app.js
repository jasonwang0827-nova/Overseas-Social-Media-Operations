const state = {
  clientId: "client_study_001",
  view: "overview",
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
        </div>
      </section>
    </div>
  `;
}

function renderClients() {
  const { client, accounts } = state.data;
  return `
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
    <h2 style="margin-top:24px">平台账号</h2>
    <div class="account-grid">
      ${accounts.map((account) => `
        <article class="row-card">
          <h3>${escapeHtml(account.platform)}</h3>
          <p>${escapeHtml(account.account_name)}</p>
          <p class="muted">${escapeHtml(account.persona)} · ${escapeHtml(account.content_role)}</p>
          <div class="tag-row">
            ${status(account.status)}
            ${status(account.auth_status)}
            ${tag(account.language)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderContent() {
  const { contents, variants } = state.data;
  return `
    <div class="content-grid">
      ${contents.map((content) => `
        <article class="row-card">
          <h3>${escapeHtml(content.title)}</h3>
          <p class="muted">${escapeHtml(content.hook)}</p>
          <div class="tag-row">
            ${status(content.status)}
            ${tag(content.content_theme)}
            ${tag(content.funnel_stage)}
          </div>
          <p style="margin-top:12px">${content.main_points.map(escapeHtml).join(" / ")}</p>
          ${content.approved_by_human ? "" : `<button class="action-button" data-action="approveContent" data-content-id="${escapeHtml(content.content_id)}">人工批准</button>`}
        </article>
      `).join("")}
    </div>
    <section class="panel" style="margin-top:24px">
      <h2>平台版本</h2>
      <table class="table">
        <thead><tr><th>平台</th><th>账号</th><th>格式</th><th>文案</th><th>状态</th></tr></thead>
        <tbody>
          ${variants.map((variant) => `
            <tr>
              <td>${escapeHtml(variant.platform)}</td>
              <td>${escapeHtml(variant.account_id)}</td>
              <td>${escapeHtml(variant.format)}</td>
              <td>${escapeHtml(variant.caption)}</td>
              <td>${status(variant.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderPublish() {
  const { queue, records } = state.data;
  return `
    <div class="inline-actions">
      <button class="action-button" data-action="runPublish">运行 mock 发布</button>
    </div>
    <section class="panel">
      <h2>发布队列</h2>
      <table class="table">
        <thead><tr><th>任务</th><th>平台</th><th>账号</th><th>审批</th><th>状态</th><th>发布时间</th></tr></thead>
        <tbody>
          ${queue.map((task) => `
            <tr>
              <td>${escapeHtml(task.publish_task_id)}</td>
              <td>${escapeHtml(task.platform)}</td>
              <td>${escapeHtml(task.account_id)}</td>
              <td>${status(task.approval_status)}</td>
              <td>${status(task.status)}</td>
              <td>${escapeHtml(task.published_at || task.scheduled_at)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
    <section class="panel" style="margin-top:24px">
      <h2>发布记录</h2>
      <p class="muted">已记录 ${records.length} 条 mock 发布结果。</p>
    </section>
  `;
}

function renderLeads() {
  const { leads } = state.data;
  return `
    <form class="lead-form" id="leadForm">
      <textarea id="leadText" placeholder="粘贴评论或私信，例如：我孩子现在大一，可以转到加拿大吗？"></textarea>
      <button class="action-button" type="submit">导入线索</button>
    </form>
    <div class="inline-actions">
      <button class="action-button secondary" data-action="scoreLeads">重新评分线索</button>
    </div>
    <div class="lead-grid">
      ${leads.map((lead) => `
        <article class="lead-card">
          <h3>${escapeHtml(lead.user_display_name)} <span class="muted">@${escapeHtml(lead.user_handle)}</span></h3>
          <p>${escapeHtml(lead.message_text)}</p>
          <div class="tag-row">
            ${status(lead.lead_stage)}
            ${tag(lead.detected_intent)}
            ${tag(`score ${lead.lead_score}`)}
          </div>
          <p class="muted" style="margin-top:12px">${escapeHtml(lead.recommended_reply)}</p>
        </article>
      `).join("")}
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
  document.querySelectorAll("[data-action='scoreLeads']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/lead/score", { client_id: state.clientId }));
  });
  document.querySelectorAll("[data-action='writeReport']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/report/daily", { client_id: state.clientId }));
  });
  document.querySelectorAll("[data-action='approveContent']").forEach((button) => {
    button.addEventListener("click", () => postJson("/api/content/approve", { client_id: state.clientId, content_id: button.dataset.contentId }));
  });

  const leadForm = document.querySelector("#leadForm");
  if (leadForm) {
    leadForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const textarea = document.querySelector("#leadText");
      const message = textarea.value.trim();
      if (!message) return;
      postJson("/api/lead/import", { client_id: state.clientId, message_text: message });
    });
  }
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

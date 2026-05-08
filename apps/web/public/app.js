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
  const { client, accounts, categories } = state.data;
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

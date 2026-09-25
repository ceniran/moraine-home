const guideStyle = document.createElement("link");
guideStyle.rel = "stylesheet";
guideStyle.href = "./connection-guide.css";
document.head.appendChild(guideStyle);
const state = { overview: null, memories: [], candidates: [], archived: [], events: [], calendar: [], rollbacks: [], snapshots: [], profile: {}, relations: [], settings: {}, adviser: {} };
const API_ROOT = window.location.pathname.startsWith("/moraine-beta/") ? "/moraine-beta" : "";
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const date = value => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "未标日期";
const dateTime = value => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未标时间";

function installGovernanceControls() {
  const kind = $("#candidate-kind");
  if (kind && !kind.querySelector('[value="identity"]')) kind.insertAdjacentHTML("beforeend", '<option value="identity">身份</option><option value="relationship">关系</option>');
  const settings = $("#settings");
  const adviserCard = $("#adviser-form")?.closest("article");
  if (!settings || !adviserCard || $("#governance-form")) return;
  adviserCard.insertAdjacentHTML("beforebegin", `<article class="card"><div class="card-head"><div><p class="eyebrow">CANDIDATE GOVERNANCE</p><h2>候选归位与保留</h2></div></div><form id="governance-form" class="stack-form"><label class="toggle-row"><input id="routing-enabled" type="checkbox"><span>开启身份与关系候选归位</span></label><label class="toggle-row"><input id="retention-enabled" type="checkbox"><span>到期后粉碎已结案候选正文</span></label><label>保留时间<select id="retention-hours"><option value="24">1天</option><option value="72">3天</option><option value="168">7天</option><option value="720">30天</option></select></label><div class="candidate-actions"><button type="button" class="secondary" id="run-shred">立即检查到期内容</button><button class="primary">保存设置</button></div></form><p class="muted">待审候选不会粉碎；结案后只留下不含正文的最小审计凭据。归位开启后，身份和关系候选可明确进入 self-core 或关系网。</p></article><article class="card"><div class="card-head"><div><p class="eyebrow">RECOVERY SNAPSHOTS</p><h2>安全快照</h2></div><button class="text-button" id="create-snapshot">保存当前状态</button></div><p class="muted">恢复前会再次保存当前实例，避免一次恢复堵住回来的路。</p><div id="snapshot-list" class="list"></div></article>`);
}

installGovernanceControls();

async function api(path, options = {}) {
  const token = sessionStorage.getItem("moraine_api_token");
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(response.status === 401 ? "工作台令牌不正确或已经更换" : data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return data;
}

function showConnectionGuide(message, invalid = false) {
  const guide = $("#connection-guide");
  guide.hidden = false;
  $("#connection-message").textContent = message;
  guide.dataset.state = invalid ? "invalid" : "missing";
  $("#connection-token").focus();
}

function hideConnectionGuide() { $("#connection-guide").hidden = true; }

async function bootstrap() {
  let health;
  try {
    const response = await fetch(`${API_ROOT}/api/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health = await response.json();
  } catch (_) {
    showConnectionGuide("无法连接 Moraine 后端。请确认服务已经启动、地址正确，再刷新页面。");
    $("#connection-form").hidden = true;
    return;
  }
  if (health.auth_required && !sessionStorage.getItem("moraine_api_token")) {
    showConnectionGuide("这个实例启用了访问保护。填写部署时设置的工作台令牌，记忆才会在当前浏览器中加载。");
    return;
  }
  try { await load(); hideConnectionGuide(); }
  catch (error) {
    if (error.status === 401) showConnectionGuide("当前令牌未通过验证。请重新复制完整的 MORAINE_BETA_TOKEN。", true);
    else notice(`无法载入：${error.message}`);
  }
}

function notice(text) {
  $("#notice").textContent = text;
  setTimeout(() => { $("#notice").textContent = ""; }, 2800);
}

function item(row, action = "") {
  return `<article class="item">${action}<h3>${esc(row.title)}</h3><div class="item-meta"><span>${esc(row.kind || "event")}</span><span>${date(row.occurred_at || row.created_at)}</span>${row.importance != null ? `<span>强度 ${Math.round(row.importance * 100)}</span>` : ""}</div>${row.content ? `<p>${esc(row.content).slice(0, 220)}</p>` : ""}</article>`;
}

async function load() {
  const [overview, memories, candidates, archived, events, calendar, rollbacks, snapshots, profile, relations, settings, adviser] = await Promise.all([
    api("/api/overview"), api("/api/memories?state=active"), api("/api/candidates"),
    api("/api/memories?state=historical"), api("/api/events?limit=120"), api("/api/calendar"),
    api("/api/rollbacks"), api("/api/snapshots"), api("/api/profile"), api("/api/relations"), api("/api/settings"), api("/api/adviser"),
  ]);
  Object.assign(state, { overview, memories: memories.items, candidates: candidates.items, archived: archived.items, events: events.items, calendar: calendar.items, rollbacks: rollbacks.items, snapshots: snapshots.items, profile, relations: relations.items, settings, adviser });
  render();
}

function render() {
  const o = state.overview;
  $("#stats").innerHTML = [[o.active, "当前有效"], [o.candidates, "待筛选"], [o.archived, "历史归档"], [o.total, "全部记忆"]].map(([n, label]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join("");
  $("#recent").innerHTML = o.recent.length ? o.recent.map(row => item(row)).join("") : '<p class="muted">还没有近期变化。</p>';
  renderMemories(state.memories);
  const pending = state.candidates.filter(row => row.state === "pending");
  const baskets = Object.groupBy ? Object.groupBy(pending, row => row.basket || "未分篮") : pending.reduce((groups, row) => { (groups[row.basket || "未分篮"] ||= []).push(row); return groups; }, {});
  $("#candidate-list").innerHTML = Object.entries(baskets).map(([basket, rows]) => `<section class="basket-group"><h3 class="basket-title">${esc(basket)}</h3>${rows.map(row => `<label class="item"><input type="checkbox" value="${esc(row.id)}"><span><button type="button" class="row-action" data-ignore="${esc(row.id)}">忽略</button><h3>${esc(row.title)}</h3><span class="item-meta">${date(row.occurred_at)} · ${esc(row.kind || "event")}</span><p>${esc(row.content)}</p><select class="relation-select" data-relation="${esc(row.id)}"><option value="supplement">补充：汇入同一事件</option><option value="duplicate">重复：压缩硬重复</option><option value="evolution">更迭：发展线与当前状态</option><option value="conflict">冲突：并存为未决冲突</option><option value="related_only">仅相关：只建立关联</option></select>${state.settings.identity_relation_routing && row.kind === "identity" ? `<button type="button" class="secondary route-action" data-route-core="${esc(row.id)}">归入 self-core</button>` : ""}${state.settings.identity_relation_routing && row.kind === "relationship" ? `<button type="button" class="secondary route-action" data-route-relation="${esc(row.id)}">归入关系网</button>` : ""}</span></label>`).join("")}</section>`).join("") || '<p class="muted">候选箱是空的。</p>';
  $("#rollback-list").innerHTML = state.rollbacks.length ? state.rollbacks.map(row => `<article class="item"><button type="button" class="row-action" data-rollback="${esc(row.id)}">撤回</button><h3>${esc(state.memories.find(memory => memory.id === row.memory_id)?.title || "最近一次整合")}</h3><div class="item-meta"><span>${row.candidate_ids.length} 条来源候选</span><span>截止 ${dateTime(row.available_until)}</span></div></article>`).join("") : '<p class="muted">目前没有可撤回的整合。</p>';
  $("#archive-list").innerHTML = state.archived.length ? state.archived.map(row => item(row, row.state === "archived" ? `<button class="row-action" data-restore="${esc(row.id)}">恢复</button>` : '<span class="row-action">已由新记忆替换</span>')).join("") : '<p class="muted">归档里还没有内容。</p>';
  $("#activity-list").innerHTML = state.events.length ? state.events.map(event => `<article class="item"><h3>${eventName(event.type)}</h3><div class="item-meta"><span>${date(event.at)}</span><span>${esc(event.target || "")}</span></div></article>`).join("") : '<p class="muted">还没有操作记录。</p>';
  $("#calendar-grid").innerHTML = state.calendar.length ? state.calendar.map(day => `<div class="day"><strong>${day.count}</strong><span>${esc(day.date)}</span></div>`).join("") : '<p class="muted">还没有可显示的日期。</p>';
  $("#weight-list").innerHTML = state.memories.map(row => `<article class="item"><h3>${esc(row.title)}</h3><div class="weight-control"><input type="range" min="0" max="100" value="${Math.round((row.importance ?? .5) * 100)}" data-weight="${esc(row.id)}"><output>${Math.round((row.importance ?? .5) * 100)}</output></div></article>`).join("") || '<p class="muted">还没有可调整的记忆。</p>';
  renderWorkbench();
  renderSpace();
  $("#review-mode").value = state.settings.review_mode || "autonomous";
  $("#adviser-enabled").checked = Boolean(state.adviser.enabled);
  $("#adviser-wakeup").checked = Boolean(state.adviser.use_for_wakeup);
  $("#adviser-status").textContent = state.adviser.configured ? "密钥已安全保存" : "尚未配置密钥";
  $("#routing-enabled").checked = Boolean(state.settings.identity_relation_routing);
  $("#retention-enabled").checked = Boolean(state.settings.candidate_retention_enabled);
  $("#retention-hours").value = String(state.settings.candidate_retention_hours || 168);
  $("#snapshot-list").innerHTML = state.snapshots.length ? state.snapshots.map(row => `<article class="item"><button type="button" class="row-action" data-restore-snapshot="${esc(row.id)}">恢复</button><h3>${esc(row.label)}</h3><div class="item-meta"><span>${dateTime(row.created_at)}</span><span>${row.memories} 条记忆 · ${row.candidates} 条候选</span></div></article>`).join("") : '<p class="muted">还没有快照。</p>';
}

function renderWorkbench() {
  const options = state.memories.map(row => `<option value="${esc(row.id)}">${esc(row.title)}</option>`).join("");
  $("#revision-memory").innerHTML = '<option value="">选择需要修订的记忆</option>' + options;
  $("#replacement-old").innerHTML = '<option value="">选择旧记忆</option>' + options;
  $("#replacement-new").innerHTML = '<option value="">选择新的当前记忆</option>' + options;
}

function renderSpace() {
  const profile = state.profile || {};
  $("#profile-name").textContent = profile.display_name || "个人空间";
  $("#profile-summary").textContent = profile.summary || "尚未填写身份简介。";
  $("#self-core-list").innerHTML = (profile.self_core || []).map(line => `<div class="core-line">${esc(line)}</div>`).join("") || '<p class="muted">尚未设置 self-core。</p>';
  $("#relation-list").innerHTML = state.relations.length ? state.relations.map(row => `<article class="relation-node"><strong>${esc(row.name)}</strong><span>${esc(row.relation)}</span>${row.note ? `<p>${esc(row.note)}</p>` : ""}</article>`).join("") : '<p class="muted">关系网还是空的。</p>';
}

function renderMemories(rows) {
  $("#memory-list").innerHTML = rows.length ? rows.map(row => item(row, `<button class="row-action" data-archive="${esc(row.id)}">归档</button>`)).join("") : '<p class="muted">没有找到记忆。</p>';
}

function candidateSelection() {
  const ids = [...document.querySelectorAll("#candidate-list input:checked")].map(input => input.value);
  const relations = Object.fromEntries(ids.map(id => [id, document.querySelector(`[data-relation="${CSS.escape(id)}"]`).value]));
  return { ids, relations };
}

function eventName(type) {
  return ({ candidate_added: "候选已加入", candidates_admitted: "候选已整理入库", candidate_admission_rolled_back: "候选整合已撤回", candidate_ignored: "候选已忽略", candidate_restored: "候选已恢复", memory_archived: "记忆已归档", memory_restored: "记忆已恢复", memory_revised: "记忆已修订", memory_replaced: "记忆已替换", importance_changed: "记忆强度已调整", profile_updated: "身份资料已更新", relation_added: "关系节点已加入", relation_updated: "关系节点已更新", settings_updated: "审阅模式已更新" })[type] || type;
}

function activateView(name, updateUrl = true) {
  const button = document.querySelector(`[data-view="${CSS.escape(name)}"]`);
  const view = document.getElementById(name);
  if (!button || !view) return;
  document.querySelectorAll("[data-view],.view").forEach(node => node.classList.remove("active"));
  button.classList.add("active");
  view.classList.add("active");
  if (updateUrl) history.replaceState(null, "", `?view=${encodeURIComponent(name)}`);
}

async function exportData() {
  const data = await api("/api/export");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  link.download = `moraine-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.addEventListener("click", async event => {
  const tab = event.target.closest("[data-view]");
  if (tab) {
    activateView(tab.dataset.view);
    return;
  }
  const archive = event.target.dataset.archive, restore = event.target.dataset.restore, ignore = event.target.dataset.ignore, rollback = event.target.dataset.rollback;
  const routeCore = event.target.dataset.routeCore, routeRelation = event.target.dataset.routeRelation, restoreSnapshot = event.target.dataset.restoreSnapshot;
  try {
    let rolledBack = false;
    let routed = false;
    let snapshotRestored = false;
    if (archive) await api(`/api/memories/${archive}/archive`, { method: "POST", body: "{}" });
    if (restore) await api(`/api/memories/${restore}/restore`, { method: "POST", body: "{}" });
    if (ignore) await api(`/api/candidates/${ignore}/ignore`, { method: "POST", body: "{}" });
    if (rollback && confirm("撤回这次整合，并恢复原来的来源候选吗？")) { await api(`/api/rollbacks/${rollback}`, { method: "POST", body: "{}" }); rolledBack = true; }
    if (routeCore) { await api(`/api/candidates/${routeCore}/route`, { method: "POST", body: JSON.stringify({ destination: "self_core" }) }); routed = true; }
    if (routeRelation) { const relation = prompt("请填写关系，例如：朋友、协作者"); if (relation) { await api(`/api/candidates/${routeRelation}/route`, { method: "POST", body: JSON.stringify({ destination: "relation", relation }) }); routed = true; } }
    if (restoreSnapshot && confirm("恢复这个快照会替换当前实例；系统会先保存当前状态。继续吗？")) { await api(`/api/snapshots/${restoreSnapshot}`, { method: "POST", body: "{}" }); snapshotRestored = true; }
    if (archive || restore || ignore || rolledBack || routed || snapshotRestored) { await load(); notice(archive ? "已移入可恢复归档" : restore ? "已恢复到记忆库" : ignore ? "已忽略候选" : rolledBack ? "已撤回整合并恢复来源候选" : snapshotRestored ? "快照已恢复，恢复前状态也已保存" : "候选已完成归位"); }
  } catch (error) { notice(error.message); }
});

$("#admit").addEventListener("click", async () => {
  const { ids, relations } = candidateSelection();
  if (!ids.length) return notice("请先选择候选");
  try { await api("/api/candidates/admit", { method: "POST", body: JSON.stringify({ candidate_ids: ids, relations }) }); await load(); notice("已整理入库；48小时内可完整撤回"); } catch (error) { notice(error.message); }
});

$("#candidate-form").addEventListener("submit", async event => {
  event.preventDefault();
  const occurred = $("#candidate-time").value;
  try {
    await api("/api/candidates", { method: "POST", body: JSON.stringify({ title: $("#candidate-title").value, content: $("#candidate-content").value, basket: $("#candidate-basket").value || "未分篮", kind: $("#candidate-kind").value, occurred_at: occurred ? new Date(occurred).toISOString() : undefined }) });
    event.target.reset();
    event.target.closest("details").open = false;
    await load();
    notice("候选已加入事件篮子");
  } catch (error) { notice(error.message); }
});

$("#preview-draft").addEventListener("click", async () => {
  const { ids, relations } = candidateSelection();
  if (!ids.length) return notice("请先选择候选");
  try {
    const draft = await api("/api/candidates/consolidate-preview", { method: "POST", body: JSON.stringify({ candidate_ids: ids, relations }) });
    const box = $("#draft-preview");
    box.hidden = false;
    box.innerHTML = `<strong>${esc(draft.title)}</strong><p>${esc(draft.content)}</p><p class="muted">按事件时间排列 ${draft.timeline.length} 个来源；去除 ${draft.removed.length} 处硬重复；仅关联 ${draft.associations.length} 条，仍需人工确认。</p>`;
  } catch (error) { notice(error.message); }
});

$("#search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#search-input").value.trim();
  if (!query) { $("#search-mode").textContent = ""; return renderMemories(state.memories); }
  try { const result = await api(`/api/search?query=${encodeURIComponent(query)}`); renderMemories(result.items); $("#search-mode").textContent = result.mode === "semantic" ? "本地向量召回" : "关键词召回（向量服务未连接）"; } catch (error) { notice(error.message); }
});

$("#weight-list").addEventListener("input", event => { if (event.target.dataset.weight) event.target.nextElementSibling.value = event.target.value; });
$("#weight-list").addEventListener("change", async event => {
  const id = event.target.dataset.weight;
  if (!id) return;
  try { await api(`/api/memories/${id}/importance`, { method: "POST", body: JSON.stringify({ importance: Number(event.target.value) / 100 }) }); await load(); notice("记忆强度已保存"); } catch (error) { notice(error.message); }
});

$("#revision-memory").addEventListener("change", event => {
  const row = state.memories.find(item => item.id === event.target.value);
  $("#revision-title").value = row?.title || "";
  $("#revision-content").value = row?.content || "";
});
$("#revision-form").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("#revision-memory").value;
  try { await api(`/api/memories/${id}/revise`, { method: "POST", body: JSON.stringify({ title: $("#revision-title").value, content: $("#revision-content").value, reason: $("#revision-reason").value }) }); event.target.reset(); await load(); notice("修订已保存，旧版本仍可追溯"); } catch (error) { notice(error.message); }
});
$("#replacement-form").addEventListener("submit", async event => {
  event.preventDefault();
  const oldId = $("#replacement-old").value;
  try { await api(`/api/memories/${oldId}/replace`, { method: "POST", body: JSON.stringify({ replacement_id: $("#replacement-new").value, reason: $("#replacement-reason").value }) }); event.target.reset(); await load(); notice("替换关系已建立，旧记忆保留在历史中"); } catch (error) { notice(error.message); }
});

$("#refresh").addEventListener("click", () => load().then(() => notice("已刷新")).catch(error => notice(error.message)));
$("#export").addEventListener("click", () => exportData().catch(error => notice(error.message)));
$("#settings-export").addEventListener("click", () => exportData().catch(error => notice(error.message)));
$("#import-file").addEventListener("change", async event => { const file = event.target.files[0]; if (!file) return; if (!confirm("导入会替换当前实例的数据。继续前会自动保存恢复快照，确定导入吗？")) { event.target.value = ""; return; } try { await api("/api/import", { method: "POST", body: JSON.stringify(JSON.parse(await file.text())) }); await load(); notice("导入完成，旧数据已自动留存快照"); } catch (error) { notice(`导入失败：${error.message}`); } finally { event.target.value = ""; } });
async function saveToken(value, sourceInput) {
  if (value) sessionStorage.setItem("moraine_api_token", value); else sessionStorage.removeItem("moraine_api_token");
  try { await load(); hideConnectionGuide(); sourceInput.value = ""; notice("令牌已验证并保存到当前浏览器会话"); }
  catch (error) { if (error.status === 401) showConnectionGuide("令牌没有通过验证。请检查是否复制了完整的 MORAINE_BETA_TOKEN。", true); else notice(`连接失败：${error.message}`); }
}
$("#connection-form").addEventListener("submit", event => { event.preventDefault(); saveToken($("#connection-token").value.trim(), $("#connection-token")); });
$("#token-form").addEventListener("submit", event => { event.preventDefault(); saveToken($("#token-input").value.trim(), $("#token-input")); });
$("#mode-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/settings", { method: "POST", body: JSON.stringify({ review_mode: $("#review-mode").value }) }); await load(); notice("审阅模式已保存"); } catch (error) { notice(error.message); } });
$("#governance-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/settings", { method: "POST", body: JSON.stringify({ identity_relation_routing: $("#routing-enabled").checked, candidate_retention_enabled: $("#retention-enabled").checked, candidate_retention_hours: Number($("#retention-hours").value) }) }); await load(); notice("候选治理设置已保存"); } catch (error) { notice(error.message); } });
$("#run-shred").addEventListener("click", async () => { if (!confirm("只粉碎已结案且超过保留期的候选正文，待审候选不会变化。继续吗？")) return; try { const result = await api("/api/candidates/shred", { method: "POST", body: "{}" }); await load(); notice(`已粉碎 ${result.shredded} 条到期候选正文`); } catch (error) { notice(error.message); } });
$("#create-snapshot").addEventListener("click", async () => { try { await api("/api/snapshots", { method: "POST", body: JSON.stringify({ label: "手动安全点" }) }); await load(); notice("当前状态已保存为快照"); } catch (error) { notice(error.message); } });
$("#adviser-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/adviser", { method: "POST", body: JSON.stringify({ enabled: $("#adviser-enabled").checked, use_for_wakeup: $("#adviser-wakeup").checked, api_key: $("#adviser-api-key").value.trim() }) }); $("#adviser-api-key").value = ""; await load(); notice("Jev 小参谋设置已保存"); } catch (error) { notice(error.message); } });
$("#adviser-clear").addEventListener("click", async () => { if (!confirm("清除后，自动唤醒将不能调用 Jev。确定继续吗？")) return; try { await api("/api/adviser", { method: "POST", body: JSON.stringify({ enabled: false, clear_api_key: true }) }); $("#adviser-api-key").value = ""; await load(); notice("Jev 密钥已清除"); } catch (error) { notice(error.message); } });
$("#edit-profile").addEventListener("click", () => { const form = $("#profile-form"); form.hidden = !form.hidden; if (!form.hidden) { $("#profile-name-input").value = state.profile.display_name || ""; $("#profile-summary-input").value = state.profile.summary || ""; $("#profile-core-input").value = (state.profile.self_core || []).join("\n"); } });
$("#profile-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/profile", { method: "POST", body: JSON.stringify({ display_name: $("#profile-name-input").value, summary: $("#profile-summary-input").value, self_core: $("#profile-core-input").value.split("\n") }) }); event.target.hidden = true; await load(); notice("身份资料已保存"); } catch (error) { notice(error.message); } });
$("#add-relation").addEventListener("click", () => { $("#relation-form").hidden = !$("#relation-form").hidden; });
$("#relation-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/relations", { method: "POST", body: JSON.stringify({ name: $("#relation-name").value, relation: $("#relation-type").value, note: $("#relation-note").value }) }); event.target.reset(); event.target.hidden = true; await load(); notice("关系节点已保存"); } catch (error) { notice(error.message); } });

activateView(new URLSearchParams(location.search).get("view") || "overview", false);
bootstrap();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(() => {});

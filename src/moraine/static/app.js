const state = { overview: null, memories: [], candidates: [], archived: [], events: [], calendar: [], profile: {}, relations: [], settings: {} };
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const date = value => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value)) : "未标日期";

async function api(path, options = {}) {
  const token = sessionStorage.getItem("moraine_api_token");
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? "需要先在设置中填写 API 令牌" : data.error || `HTTP ${response.status}`);
  return data;
}

function notice(text) {
  $("#notice").textContent = text;
  setTimeout(() => { $("#notice").textContent = ""; }, 2800);
}

function item(row, action = "") {
  return `<article class="item">${action}<h3>${esc(row.title)}</h3><div class="item-meta"><span>${esc(row.kind || "event")}</span><span>${date(row.occurred_at || row.created_at)}</span>${row.importance != null ? `<span>强度 ${Math.round(row.importance * 100)}</span>` : ""}</div>${row.content ? `<p>${esc(row.content).slice(0, 220)}</p>` : ""}</article>`;
}

async function load() {
  const [overview, memories, candidates, archived, events, calendar, profile, relations, settings] = await Promise.all([
    api("/api/overview"), api("/api/memories?state=active"), api("/api/candidates"),
    api("/api/memories?state=historical"), api("/api/events?limit=120"), api("/api/calendar"),
    api("/api/profile"), api("/api/relations"), api("/api/settings"),
  ]);
  Object.assign(state, { overview, memories: memories.items, candidates: candidates.items, archived: archived.items, events: events.items, calendar: calendar.items, profile, relations: relations.items, settings });
  render();
}

function render() {
  const o = state.overview;
  $("#stats").innerHTML = [[o.active, "当前有效"], [o.candidates, "待筛选"], [o.archived, "历史归档"], [o.total, "全部记忆"]].map(([n, label]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join("");
  $("#recent").innerHTML = o.recent.length ? o.recent.map(row => item(row)).join("") : '<p class="muted">还没有近期变化。</p>';
  renderMemories(state.memories);
  const pending = state.candidates.filter(row => row.state === "pending");
  const baskets = Object.groupBy ? Object.groupBy(pending, row => row.basket || "未分篮") : pending.reduce((groups, row) => { (groups[row.basket || "未分篮"] ||= []).push(row); return groups; }, {});
  $("#candidate-list").innerHTML = Object.entries(baskets).map(([basket, rows]) => `<section class="basket-group"><h3 class="basket-title">${esc(basket)}</h3>${rows.map(row => `<label class="item"><input type="checkbox" value="${esc(row.id)}"><span><button type="button" class="row-action" data-ignore="${esc(row.id)}">忽略</button><h3>${esc(row.title)}</h3><span class="item-meta">${date(row.occurred_at)} · ${esc(row.kind || "event")}</span><p>${esc(row.content)}</p><select class="relation-select" data-relation="${esc(row.id)}"><option value="supplement">补充：汇入同一事件</option><option value="duplicate">重复：压缩硬重复</option><option value="evolution">更迭：发展线与当前状态</option><option value="conflict">冲突：并存为未决冲突</option><option value="related_only">仅相关：只建立关联</option></select></span></label>`).join("")}</section>`).join("") || '<p class="muted">候选箱是空的。</p>';
  $("#archive-list").innerHTML = state.archived.length ? state.archived.map(row => item(row, row.state === "archived" ? `<button class="row-action" data-restore="${esc(row.id)}">恢复</button>` : '<span class="row-action">已由新记忆替换</span>')).join("") : '<p class="muted">归档里还没有内容。</p>';
  $("#activity-list").innerHTML = state.events.length ? state.events.map(event => `<article class="item"><h3>${eventName(event.type)}</h3><div class="item-meta"><span>${date(event.at)}</span><span>${esc(event.target || "")}</span></div></article>`).join("") : '<p class="muted">还没有操作记录。</p>';
  $("#calendar-grid").innerHTML = state.calendar.length ? state.calendar.map(day => `<div class="day"><strong>${day.count}</strong><span>${esc(day.date)}</span></div>`).join("") : '<p class="muted">还没有可显示的日期。</p>';
  $("#weight-list").innerHTML = state.memories.map(row => `<article class="item"><h3>${esc(row.title)}</h3><div class="weight-control"><input type="range" min="0" max="100" value="${Math.round((row.importance ?? .5) * 100)}" data-weight="${esc(row.id)}"><output>${Math.round((row.importance ?? .5) * 100)}</output></div></article>`).join("") || '<p class="muted">还没有可调整的记忆。</p>';
  renderWorkbench();
  renderSpace();
  $("#review-mode").value = state.settings.review_mode || "autonomous";
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
  return ({ candidate_added: "候选已加入", candidates_admitted: "候选已整理入库", candidate_ignored: "候选已忽略", candidate_restored: "候选已恢复", memory_archived: "记忆已归档", memory_restored: "记忆已恢复", memory_revised: "记忆已修订", memory_replaced: "记忆已替换", importance_changed: "记忆强度已调整", profile_updated: "身份资料已更新", relation_added: "关系节点已加入", relation_updated: "关系节点已更新", settings_updated: "审阅模式已更新" })[type] || type;
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
  const archive = event.target.dataset.archive, restore = event.target.dataset.restore, ignore = event.target.dataset.ignore;
  try {
    if (archive) await api(`/api/memories/${archive}/archive`, { method: "POST", body: "{}" });
    if (restore) await api(`/api/memories/${restore}/restore`, { method: "POST", body: "{}" });
    if (ignore) await api(`/api/candidates/${ignore}/ignore`, { method: "POST", body: "{}" });
    if (archive || restore || ignore) { await load(); notice(archive ? "已移入可恢复归档" : restore ? "已恢复到记忆库" : "已忽略候选"); }
  } catch (error) { notice(error.message); }
});

$("#admit").addEventListener("click", async () => {
  const { ids, relations } = candidateSelection();
  if (!ids.length) return notice("请先选择候选");
  try { await api("/api/candidates/admit", { method: "POST", body: JSON.stringify({ candidate_ids: ids, relations }) }); await load(); notice("已按关系整理并写入记忆库"); } catch (error) { notice(error.message); }
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
$("#token-form").addEventListener("submit", event => { event.preventDefault(); const value = $("#token-input").value.trim(); if (value) sessionStorage.setItem("moraine_api_token", value); else sessionStorage.removeItem("moraine_api_token"); load().then(() => notice("令牌已保存到当前浏览器会话")).catch(error => notice(error.message)); });
$("#mode-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/settings", { method: "POST", body: JSON.stringify({ review_mode: $("#review-mode").value }) }); await load(); notice("审阅模式已保存"); } catch (error) { notice(error.message); } });
$("#edit-profile").addEventListener("click", () => { const form = $("#profile-form"); form.hidden = !form.hidden; if (!form.hidden) { $("#profile-name-input").value = state.profile.display_name || ""; $("#profile-summary-input").value = state.profile.summary || ""; $("#profile-core-input").value = (state.profile.self_core || []).join("\n"); } });
$("#profile-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/profile", { method: "POST", body: JSON.stringify({ display_name: $("#profile-name-input").value, summary: $("#profile-summary-input").value, self_core: $("#profile-core-input").value.split("\n") }) }); event.target.hidden = true; await load(); notice("身份资料已保存"); } catch (error) { notice(error.message); } });
$("#add-relation").addEventListener("click", () => { $("#relation-form").hidden = !$("#relation-form").hidden; });
$("#relation-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/relations", { method: "POST", body: JSON.stringify({ name: $("#relation-name").value, relation: $("#relation-type").value, note: $("#relation-note").value }) }); event.target.reset(); event.target.hidden = true; await load(); notice("关系节点已保存"); } catch (error) { notice(error.message); } });

activateView(new URLSearchParams(location.search).get("view") || "overview", false);
load().catch(error => notice(`无法载入：${error.message}`));
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(() => {});

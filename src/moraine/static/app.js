const guideStyle = document.createElement("link");
guideStyle.rel = "stylesheet";
guideStyle.href = "./connection-guide.css";
document.head.appendChild(guideStyle);
const state = { overview: null, memories: [], candidates: [], tiering: [], archived: [], events: [], calendar: [], rollbacks: [], snapshots: [], profile: {}, selfCore: [], userProfile: [], relations: [], layeredRecall: null, settings: {}, adviser: {} };
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
  adviserCard.insertAdjacentHTML("beforebegin", `<article class="card"><div class="card-head"><div><p class="eyebrow">CANDIDATE GOVERNANCE</p><h2>候选归位与保留</h2></div></div><form id="governance-form" class="stack-form"><label class="toggle-row"><input id="routing-enabled" type="checkbox"><span>开启身份与关系候选归位</span></label><label class="toggle-row"><input id="retention-enabled" type="checkbox"><span>到期后粉碎已结案候选正文</span></label><label>保留时间<select id="retention-hours"><option value="24">1天</option><option value="72">3天</option><option value="168">7天</option><option value="720">30天</option></select></label><div class="candidate-actions"><button type="button" class="secondary" id="run-shred">立即检查到期内容</button><button class="primary">保存设置</button></div></form><p class="muted">待审候选不会粉碎；结案后只留下不含正文的最小审计凭据。归位开启后，身份和关系候选可明确进入 self-core 或关系网。</p></article><article class="card"><div class="card-head"><div><p class="eyebrow">RECOVERY SNAPSHOTS</p><h2>安全快照</h2></div><button class="text-button" id="create-snapshot">保存当前状态</button></div><p class="muted">恢复前会再次保存当前实例，避免一次恢复堵住回来的路。</p><div id="snapshot-list" class="list"></div></article><article class="card"><div class="card-head"><div><p class="eyebrow">WAKEUP INTEGRATION</p><h2>自动唤醒接入说明</h2></div><span class="privacy-pill">预览能力</span></div><div class="integration-note"><p><strong>Moraine 不自带定时唤醒或行动执行器。</strong>它只生成有预算、无写入的唤醒预览。</p><ol><li>由部署者自配定时器或轮换器，决定何时唤醒。</li><li>由宿主 Agent／编排器读取预览、选择是否行动，并负责发送或执行。</li><li>Jev 完全可选；不配置也能生成预览。Jev 只能提供第二意见，不能执行、外发或写记忆。</li></ol></div></article>`);
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
  $("#service-status").textContent = invalid ? "连接待确认" : "等待连接";
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
    $("#service-status").textContent = "服务不可用";
    $("#connection-form").hidden = true;
    return;
  }
  if (health.auth_required && !sessionStorage.getItem("moraine_api_token")) {
    showConnectionGuide("这个实例启用了访问保护。填写部署时设置的工作台令牌，记忆才会在当前浏览器中加载。");
    return;
  }
  try { await load(); hideConnectionGuide(); $("#service-status").textContent = "服务正常"; }
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
  const [overview, memories, candidates, tiering, archived, events, calendar, rollbacks, snapshots, profile, selfCore, userProfile, relations, layeredRecall, settings, adviser] = await Promise.all([
    api("/api/overview"), api("/api/memories?state=active"), api("/api/candidates"), api("/api/candidates/tiering"),
    api("/api/memories?state=historical"), api("/api/events?limit=120"), api("/api/calendar"),
    api("/api/rollbacks"), api("/api/snapshots"), api("/api/profile"), api("/api/self-core"), api("/api/user-profile"), api("/api/relations"), api("/api/recall/layered?summary=1"), api("/api/settings"), api("/api/adviser"),
  ]);
  Object.assign(state, { overview, memories: memories.items, candidates: candidates.items, tiering: tiering.items || [], archived: archived.items, events: events.items, calendar: calendar.items, rollbacks: rollbacks.items, snapshots: snapshots.items, profile, selfCore: selfCore.items || [], userProfile: userProfile.items || [], relations: relations.items, layeredRecall, settings, adviser });
  render();
}

function render() {
  const o = state.overview;
  $("#stats").innerHTML = [[o.active, "当前有效"], [o.candidates, "待筛选"], [o.archived, "历史归档"], [o.total, "全部记忆"]].map(([n, label]) => `<div class="stat"><strong>${n}</strong><span>${label}</span></div>`).join("");
  $("#recent").innerHTML = o.recent.length ? o.recent.map(row => item(row)).join("") : '<p class="muted">还没有近期变化。</p>';
  renderMemories(state.memories);
  const pending = state.candidates.filter(row => row.state === "pending");
  const baskets = Object.groupBy ? Object.groupBy(pending, row => row.basket || "未分篮") : pending.reduce((groups, row) => { (groups[row.basket || "未分篮"] ||= []).push(row); return groups; }, {});
  const tierLabels = { recent: "建议近期", long_term: "建议长期", uncertain: "暂不确定" };
  $("#candidate-list").innerHTML = Object.entries(baskets).map(([basket, rows]) => `<section class="basket-group"><h3 class="basket-title">${esc(basket)}</h3>${rows.map(row => { const tier = state.tiering.find(item => item.candidate_id === row.id); return `<label class="item"><input type="checkbox" value="${esc(row.id)}"><span><button type="button" class="row-action" data-ignore="${esc(row.id)}">忽略</button><h3>${esc(row.title)}</h3><span class="item-meta">${date(row.occurred_at)} · ${esc(row.kind || "event")}${tier ? ` · ${esc(tierLabels[tier.suggested_tier] || tier.suggested_tier)}` : ""}</span><p>${esc(row.content)}</p>${tier ? `<p class="muted">依据：${tier.reasons.map(esc).join("、")}；仅供确认，尚未写入</p>` : ""}<select class="relation-select" data-relation="${esc(row.id)}"><option value="supplement">补充：汇入同一事件</option><option value="duplicate">重复：压缩硬重复</option><option value="evolution">更迭：发展线与当前状态</option><option value="conflict">冲突：并存为未决冲突</option><option value="related_only">仅相关：只建立关联</option></select>${state.settings.identity_relation_routing && row.kind === "identity" ? `<button type="button" class="secondary route-action" data-route-core="${esc(row.id)}">归入 self-core</button>` : ""}${state.settings.identity_relation_routing && ["preference", "boundary"].includes(row.kind) ? `<button type="button" class="secondary route-action" data-route-user="${esc(row.id)}">归入用户画像</button>` : ""}${state.settings.identity_relation_routing && row.kind === "relationship" ? `<button type="button" class="secondary route-action" data-route-relation="${esc(row.id)}">归入关系网</button>` : ""}</span></label>`; }).join("")}</section>`).join("") || '<p class="muted">候选箱是空的。</p>';
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
  $("#sidebar-name").textContent = profile.display_name || "个人空间";
  $("#sidebar-summary").textContent = profile.summary || "等待一起设定";
  $("#sidebar-avatar").textContent = (profile.display_name || "我").trim().slice(0, 1) || "我";
  $("#profile-avatar").textContent = (profile.display_name || "我").trim().slice(0, 1) || "我";
  $("#self-core-list").innerHTML = state.selfCore.length ? state.selfCore.map(row => `<div class="core-line"><span>${esc(row.text)}</span><small>${esc(row.reason || "身份认领")}</small></div>`).join("") : '<p class="muted">尚未设置带来源的 self-core。</p>';
  const sources = new Set(state.selfCore.flatMap(row => row.source_ids || [])).size;
  $("#self-core-meta").textContent = `self-core · ${state.selfCore.length} 条认领 · ${sources} 条来源`;
  const categoryNames = { preference: "稳定偏好", boundary: "重要边界", communication: "沟通习惯", context: "长期背景" };
  $("#user-profile-list").innerHTML = state.userProfile.length ? state.userProfile.map(row => `<article class="user-profile-row"><div><small>${esc(row.subject)} · ${esc(categoryNames[row.category] || row.category)}</small><p>${esc(row.text)}</p><span>${esc(row.reason)} · ${row.source_ids?.length || 0} 条来源</span></div><div><button class="text-button" type="button" data-edit-user="${esc(row.id)}">修订</button><button class="text-button" type="button" data-archive-user="${esc(row.id)}">归档</button></div></article>`).join("") : '<div class="user-profile-empty"><strong>尚未建立用户画像</strong><p>这里只保存有来源、允许修订的稳定偏好、边界、沟通习惯与长期背景，不由前端猜测或预填。</p></div>';
  $("#user-profile-meta").textContent = `独立于 self-core · ${state.userProfile.length} 条`;
  $("#relation-list").innerHTML = state.relations.length ? state.relations.map(row => `<article class="relation-node"><strong>${esc(row.name)}</strong><span>${esc(row.relation)}</span>${row.facts?.length ? `<p>${row.facts.map(esc).join(" · ")}</p>` : ""}</article>`).join("") : '<p class="muted">关系网还是空的。</p>';
  const recall = state.layeredRecall || { layers: [], used_chars: 0, total_budget: 0 };
  $("#recall-total").textContent = `${Number(recall.used_chars || 0).toLocaleString("zh-CN")} 字`;
  const labels = { self_core: ["身份核心", "始终少量带入"], user_profile: ["用户画像", "稳定偏好与边界"], relations: ["关系", "查询相关人物时"], recent: ["近期", "最近发生且仍有效"], long_term: ["长期", "语义或关键词相关时"], history: ["历史", "明确回看时"] };
  $("#recall-layers").innerHTML = (recall.layers || []).map(layer => { const label = labels[layer.name] || [layer.name, "按需召回"]; return `<div class="recall-layer"><div><strong>${esc(label[0])}</strong><span>${esc(label[1])}</span></div><div><b>${Number(layer.used || 0).toLocaleString("zh-CN")}</b><small>${Number(layer.item_count || 0)} 条 / 上限 ${Number(layer.budget || 0).toLocaleString("zh-CN")}</small></div></div>`; }).join("") || '<p class="muted">尚未生成召回预览。</p>';
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
  return ({ candidate_added: "候选已加入", candidates_admitted: "候选已整理入库", candidate_admission_rolled_back: "候选整合已撤回", candidate_ignored: "候选已忽略", candidate_restored: "候选已恢复", memory_archived: "记忆已归档", memory_restored: "记忆已恢复", memory_revised: "记忆已修订", memory_replaced: "记忆已替换", importance_changed: "记忆强度已调整", profile_updated: "身份资料已更新", user_profile_added: "用户画像已加入", user_profile_revised: "用户画像已修订", user_profile_archived: "用户画像已归档", user_profile_restored: "用户画像已恢复", relation_added: "关系节点已加入", relation_updated: "关系节点已更新", settings_updated: "审阅模式已更新" })[type] || type;
}

function activateView(name, updateUrl = true) {
  const button = document.querySelector(`.sidebar-nav [data-view="${CSS.escape(name)}"]`) || document.querySelector(`[data-view="${CSS.escape(name)}"]`);
  const view = document.getElementById(name);
  if (!button || !view) return;
  document.querySelectorAll("[data-view],.view").forEach(node => node.classList.remove("active"));
  button.classList.add("active");
  view.classList.add("active");
  if (updateUrl) history.replaceState(null, "", `?view=${encodeURIComponent(name)}`);
}

function setSidebar(open) {
  $("#sidebar").dataset.open = String(open);
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
  $("#menu-toggle").setAttribute("aria-label", open ? "关闭导航" : "打开导航");
  $("#nav-scrim").hidden = !open;
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
    setSidebar(false);
    return;
  }
  const archive = event.target.dataset.archive, restore = event.target.dataset.restore, ignore = event.target.dataset.ignore, rollback = event.target.dataset.rollback;
  const routeCore = event.target.dataset.routeCore, routeUser = event.target.dataset.routeUser, routeRelation = event.target.dataset.routeRelation, restoreSnapshot = event.target.dataset.restoreSnapshot;
  try {
    let rolledBack = false;
    let routed = false;
    let snapshotRestored = false;
    if (archive) await api(`/api/memories/${archive}/archive`, { method: "POST", body: "{}" });
    if (restore) await api(`/api/memories/${restore}/restore`, { method: "POST", body: "{}" });
    if (ignore) await api(`/api/candidates/${ignore}/ignore`, { method: "POST", body: "{}" });
    if (rollback && confirm("撤回这次整合，并恢复原来的来源候选吗？")) { await api(`/api/rollbacks/${rollback}`, { method: "POST", body: "{}" }); rolledBack = true; }
    if (routeCore) { const reason = prompt("为什么把这条内容认领为 self-core？"); if (reason?.trim()) { await api(`/api/candidates/${routeCore}/route`, { method: "POST", body: JSON.stringify({ destination: "self_core", reason: reason.trim() }) }); routed = true; } }
    if (routeUser) { const reason = prompt("这条用户画像的来源与记录理由是什么？"); if (reason?.trim()) { await api(`/api/candidates/${routeUser}/route`, { method: "POST", body: JSON.stringify({ destination: "user_profile", reason: reason.trim(), category: "preference" }) }); routed = true; } }
    if (routeRelation) { const relation = prompt("请填写关系，例如：朋友、协作者"); if (relation) { await api(`/api/candidates/${routeRelation}/route`, { method: "POST", body: JSON.stringify({ destination: "relation", relation }) }); routed = true; } }
    if (restoreSnapshot && confirm("恢复这个快照会替换当前实例；系统会先保存当前状态。继续吗？")) { await api(`/api/snapshots/${restoreSnapshot}`, { method: "POST", body: "{}" }); snapshotRestored = true; }
    if (archive || restore || ignore || rolledBack || routed || snapshotRestored) { await load(); notice(archive ? "已移入可恢复归档" : restore ? "已恢复到记忆库" : ignore ? "已忽略候选" : rolledBack ? "已撤回整合并恢复来源候选" : snapshotRestored ? "快照已恢复，恢复前状态也已保存" : "候选已完成归位"); }
  } catch (error) { notice(error.message); }
});

$("#admit").addEventListener("click", async () => {
  const { ids, relations } = candidateSelection();
  if (!ids.length) return notice("请先选择候选");
  const memoryTier = $("#memory-tier").value;
  const expiry = $("#memory-expiry").value;
  if (memoryTier === "recent" && !expiry) return notice("近期记忆需要设置失效时间");
  const payload = { candidate_ids: ids, relations, memory_tier: memoryTier || undefined, expires_at: memoryTier === "recent" ? new Date(expiry).toISOString() : undefined };
  try { await api("/api/candidates/admit", { method: "POST", body: JSON.stringify(payload) }); await load(); notice("已整理入库；48小时内可完整撤回"); } catch (error) { notice(error.message); }
});

$("#memory-tier").addEventListener("change", event => { $("#expiry-label").hidden = event.target.value !== "recent"; });

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
$("#menu-toggle").addEventListener("click", () => setSidebar($("#sidebar").dataset.open !== "true"));
$("#nav-scrim").addEventListener("click", () => setSidebar(false));
document.addEventListener("keydown", event => { if (event.key === "Escape") setSidebar(false); });
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
document.querySelectorAll("[data-flip-card]").forEach(button => button.addEventListener("click", () => $("#identity-card").classList.toggle("is-flipped")));
function openUserProfileForm(row = null) {
  const form = $("#user-profile-form");
  form.hidden = false;
  $("#user-profile-id").value = row?.id || "";
  $("#user-profile-subject").value = row?.subject || "user";
  $("#user-profile-category").value = row?.category || "preference";
  $("#user-profile-text").value = row?.text || "";
  $("#user-profile-sources").value = (row?.source_ids || []).join(", ");
  $("#user-profile-reason").value = "";
}
$("#add-user-profile").addEventListener("click", () => openUserProfileForm());
$("#user-profile-list").addEventListener("click", async event => {
  const editId = event.target.dataset.editUser, archiveId = event.target.dataset.archiveUser;
  if (editId) openUserProfileForm(state.userProfile.find(row => row.id === editId));
  if (archiveId) {
    const reason = prompt("为什么归档这条用户画像？");
    if (reason?.trim()) try {
      await api(`/api/user-profile/${archiveId}/archive`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      await load(); notice("用户画像已归档，可通过 API 恢复");
    } catch (error) { notice(error.message); }
  }
});
$("#user-profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const sourceIds = $("#user-profile-sources").value.split(",").map(value => value.trim()).filter(Boolean);
  try {
    await api("/api/user-profile", { method: "POST", body: JSON.stringify({ id: $("#user-profile-id").value || undefined, subject: $("#user-profile-subject").value, category: $("#user-profile-category").value, text: $("#user-profile-text").value, source_ids: sourceIds, reason: $("#user-profile-reason").value }) });
    event.target.reset(); event.target.hidden = true; await load(); notice("用户画像已保存，来源与旧版本均会保留");
  } catch (error) { notice(error.message); }
});
$("#edit-profile").addEventListener("click", () => { const form = $("#profile-form"); form.hidden = !form.hidden; if (!form.hidden) { $("#profile-name-input").value = state.profile.display_name || ""; $("#profile-summary-input").value = state.profile.summary || ""; } });
$("#profile-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/profile", { method: "POST", body: JSON.stringify({ display_name: $("#profile-name-input").value, summary: $("#profile-summary-input").value }) }); event.target.hidden = true; await load(); notice("显示资料已保存"); } catch (error) { notice(error.message); } });
$("#add-relation").addEventListener("click", () => { $("#relation-form").hidden = !$("#relation-form").hidden; });
$("#relation-form").addEventListener("submit", async event => { event.preventDefault(); try { await api("/api/relations", { method: "POST", body: JSON.stringify({ name: $("#relation-name").value, relation: $("#relation-type").value, note: $("#relation-note").value }) }); event.target.reset(); event.target.hidden = true; await load(); notice("关系节点已保存"); } catch (error) { notice(error.message); } });

activateView(new URLSearchParams(location.search).get("view") || "overview", false);
bootstrap();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(() => {});

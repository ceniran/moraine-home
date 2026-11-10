/* Topic routing shadow suggestions for the candidate inbox.
 *
 * The private capability token lives only in sessionStorage. It is never
 * echoed into the DOM, never written to the memory store, and never enters an
 * export. Hidden-group candidates are rendered without ever holding a
 * router_output in memory: the workbench endpoint omits it, and this module
 * refuses to read it unless the server marked the suggestion visible.
 */
(function (global) {
  "use strict";

  const TOKEN_KEY = "moraine.private-topic-token";
  const TOKEN_HEADER = "X-Moraine-Private-Token";

  /* ---------- pure logic (exported for tests) ---------- */

  const ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

  /** Collapse overlapping spans so one character is never wrapped twice. */
  function mergeSpans(spans) {
    const clean = (spans || [])
      .map((span) => ({
        start: Number(span.start),
        end: Number(span.end),
      }))
      .filter(
        (span) =>
          Number.isInteger(span.start) &&
          Number.isInteger(span.end) &&
          span.end > span.start &&
          span.start >= 0,
      )
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const span of clean) {
      const last = merged[merged.length - 1];
      if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
      else merged.push({ ...span });
    }
    return merged;
  }

  /**
   * Build highlighted markup from raw text plus normalized-to-raw spans.
   * Every text slice is escaped; no caller-supplied HTML is ever inserted.
   */
  function highlight(text, spans) {
    const raw = String(text ?? "");
    let cursor = 0;
    let output = "";
    for (const span of mergeSpans(spans)) {
      const start = Math.min(span.start, raw.length);
      const end = Math.min(span.end, raw.length);
      if (start < cursor || start >= end) continue;
      output += escapeHtml(raw.slice(cursor, start));
      output += `<mark class="topic-hit">${escapeHtml(raw.slice(start, end))}</mark>`;
      cursor = end;
    }
    return output + escapeHtml(raw.slice(cursor));
  }

  const EVIDENCE_LABELS = {
    exact: "精确词",
    alias: "别名",
    supporting: "辅助词",
  };

  const EVIDENCE_PRIORITY = { exact: 3, alias: 2, supporting: 1 };

  /** Keep the strongest evidence when topic vocabularies overlap. */
  function evidenceSpans(spans) {
    const clean = (spans || [])
      .filter((span) => EVIDENCE_PRIORITY[span.evidence])
      .map((span) => ({
        start: Number(span.start),
        end: Number(span.end),
        evidence: span.evidence,
        term: String(span.term || ""),
      }))
      .filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start)
      .sort((left, right) => left.start - right.start || right.end - left.end || EVIDENCE_PRIORITY[right.evidence] - EVIDENCE_PRIORITY[left.evidence]);
    const kept = [];
    for (const span of clean) {
      const overlap = kept.find((old) => span.start < old.end && span.end > old.start);
      if (!overlap) kept.push(span);
      else if (EVIDENCE_PRIORITY[span.evidence] > EVIDENCE_PRIORITY[overlap.evidence]) Object.assign(overlap, span);
    }
    return kept.sort((left, right) => left.start - right.start);
  }

  function highlightEvidence(text, spans, offset = 0) {
    const raw = String(text ?? "");
    const local = evidenceSpans(spans)
      .map((span) => ({ ...span, start: span.start - offset, end: span.end - offset }))
      .filter((span) => span.end > 0 && span.start < raw.length)
      .map((span) => ({ ...span, start: Math.max(0, span.start), end: Math.min(raw.length, span.end) }));
    let cursor = 0;
    let output = "";
    for (const span of local) {
      if (span.start < cursor || span.start >= span.end) continue;
      output += escapeHtml(raw.slice(cursor, span.start));
      output += `<mark class="topic-hit is-${escapeHtml(span.evidence)}" title="${escapeHtml(EVIDENCE_LABELS[span.evidence])}">${escapeHtml(raw.slice(span.start, span.end))}</mark>`;
      cursor = span.end;
    }
    return output + escapeHtml(raw.slice(cursor));
  }

  /**
   * The router scores `title + "\n" + content`, so matched_spans are offsets
   * into that exact string. Highlighting anything else shifts every span.
   */
  function routedText(candidate) {
    return `${candidate?.title ?? ""}\n${candidate?.content ?? ""}`;
  }

  /**
   * Classify a router output into exactly one display state.
   * primary_topic === null must never be resolved by picking a topic here.
   */
  function classify(output) {
    if (!output) return { state: "unavailable", topics: [], primary: null };
    const topics = (output.topics || []).filter(
      (topic) => !topic.vetoed && topic.evidence_level,
    );
    if (!topics.length) return { state: "no_match", topics: [], primary: null };
    if (output.is_ambiguous)
      return { state: "ambiguous", topics, primary: null };
    if (output.is_multi_topic)
      return { state: "multi", topics, primary: null };
    const primary = output.primary_topic || null;
    if (!primary) return { state: "ambiguous", topics, primary: null };
    return { state: "single", topics, primary };
  }

  const STATE_LABELS = {
    single: "建议 1 个主题",
    multi: "命中多个主题",
    ambiguous: "证据不明确，未归类",
    no_match: "未匹配到主题",
    unavailable: "主题建议不可用",
  };

  const STATE_NOTES = {
    single: "系统建议，尚未应用。你可以接受、改选或不选。",
    multi: "多个主题都被明确命中，可以同时选择。",
    ambiguous: "证据不足以确定主题，系统不替你选。",
    no_match: "没有主题被命中，按原有流程处理即可。",
    unavailable: "主题路由当前不可用，候选箱照常工作。",
  };

  /** A visible suggestion is one the server explicitly released. */
  function isVisible(entry) {
    return Boolean(entry && entry.suggestion_visible === true);
  }

  /* ---------- browser wiring ---------- */

  const logic = {
    escapeHtml,
    mergeSpans,
    routedText,
    highlight,
    classify,
    isVisible,
    STATE_LABELS,
    STATE_NOTES,
    EVIDENCE_LABELS,
    evidenceSpans,
    highlightEvidence,
    TOKEN_KEY,
    TOKEN_HEADER,
  };

  if (typeof module === "object" && module.exports) module.exports = logic;
  if (!global || !global.document) return;
  global.moraineTopicRouting = logic;

  const $ = (selector) => global.document.querySelector(selector);
  const readToken = () => {
    try {
      return global.sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (error) {
      return "";
    }
  };

  const view = {
    /** candidate_id -> workbench entry (never holds a hidden router_output) */
    entries: new Map(),
    topics: [],
    status: "idle",
    selections: new Map(),
    eventMatches: [],
  };

  async function privateRequest(path, options = {}) {
    const token = readToken();
    if (!token) {
      const error = new Error("missing_private_token");
      error.code = "missing_token";
      throw error;
    }
    const ownerToken = (() => {
      try {
        return global.sessionStorage.getItem("moraine_api_token") || "";
      } catch (error) {
        return "";
      }
    })();
    const apiRoot = global.location.pathname.startsWith("/moraine-beta/")
      ? "/moraine-beta"
      : "";
    const response = await fetch(`${apiRoot}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(ownerToken ? { Authorization: `Bearer ${ownerToken}` } : {}),
        [TOKEN_HEADER]: token,
        ...(options.headers || {}),
      },
    });
    if (response.status === 403) {
      const error = new Error("private_topic_capability_required");
      error.code = "forbidden";
      throw error;
    }
    if (response.status === 404) {
      const error = new Error("topic_suggestion_not_found");
      error.code = "not_found";
      throw error;
    }
    if (!response.ok) {
      const error = new Error("topic_routing_unavailable");
      error.code = "unavailable";
      throw error;
    }
    return response.json();
  }

  async function loadTopics() {
    const payload = await privateRequest("/api/private/topic-routing/topics");
    view.topics = payload.items || [];
    return view.topics;
  }

  async function loadSuggestion(candidateId) {
    try {
      const entry = await privateRequest(
        `/api/private/topic-routing/suggestion?candidate_id=${encodeURIComponent(candidateId)}`,
      );
      /* Defensive: never retain a router_output the server did not release. */
      if (!isVisible(entry)) delete entry.router_output;
      view.entries.set(candidateId, entry);
      return entry;
    } catch (error) {
      if (error.code === "not_found") {
        view.entries.set(candidateId, null);
        return null;
      }
      throw error;
    }
  }

  async function loadEventMatches() {
    const payload = await privateRequest("/api/private/topic-routing/event-matches");
    view.eventMatches = payload.items || [];
    return view.eventMatches;
  }

  function topicName(topicId) {
    const match = view.topics.find((topic) => topic.topic_id === topicId);
    return match ? match.name : topicId;
  }

  function visibleSpans(entry) {
    if (!isVisible(entry)) return [];
    return classify(entry.router_output).topics.flatMap((topic) => topic.matched_spans || []);
  }

  function decorateCandidate(candidateId, candidate, entry) {
    if (!candidate) return;
    const title = global.document.querySelector(`[data-candidate-title="${CSS.escape(candidateId)}"]`);
    const content = global.document.querySelector(`[data-candidate-content="${CSS.escape(candidateId)}"]`);
    const spans = visibleSpans(entry);
    if (title) title.innerHTML = highlightEvidence(candidate.title || "", spans, 0);
    if (content) content.innerHTML = highlightEvidence(candidate.content || "", spans, String(candidate.title || "").length + 1);
  }

  function renderEvidenceStrip(result) {
    const spans = evidenceSpans(result.topics.flatMap((topic) => topic.matched_spans || []));
    if (!spans.length) return "";
    return `<div class="topic-evidence-strip"><span class="topic-evidence-title">命中</span>${spans
      .map((span) => `<span class="topic-term is-${escapeHtml(span.evidence)}"><b>${escapeHtml(span.term)}</b><small>${escapeHtml(EVIDENCE_LABELS[span.evidence])}</small></span>`)
      .join("")}</div>`;
  }

  function renderChips(candidateId, chosen) {
    const picked = new Set(chosen || []);
    if (!view.topics.length)
      return '<p class="topic-empty">还没有私有主题，先在配置里添加一个。</p>';
    return `<div class="topic-chips" role="group" aria-label="选择主题">${view.topics
      .map(
        (topic) =>
          `<button type="button" class="topic-chip${picked.has(topic.topic_id) ? " is-picked" : ""}"
             data-topic-pick="${escapeHtml(topic.topic_id)}"
             data-candidate="${escapeHtml(candidateId)}"
             aria-pressed="${picked.has(topic.topic_id) ? "true" : "false"}">${escapeHtml(topic.name)}</button>`,
      )
      .join("")}</div>`;
  }

  function renderSuggestion(candidateId, content) {
    const entry = view.entries.get(candidateId);
    if (view.status !== "ready")
      return `<div class="topic-box is-quiet"><span class="topic-state">${escapeHtml(STATE_LABELS.unavailable)}</span><p class="topic-note">${escapeHtml(STATE_NOTES.unavailable)}</p></div>`;
    if (entry === null || entry === undefined) return "";

    const chosen = view.selections.get(candidateId) || entry.final_topic_ids || [];
    const decided = Array.isArray(entry.final_topic_ids);

    if (!isVisible(entry)) {
      /* Control group: no suggestion is requested, held, or shown. */
      return `<div class="topic-box is-control">
        <span class="topic-state">未显示建议</span>
        <p class="topic-note">这条候选属于对照组，请按你自己的判断选择主题。</p>
        ${renderChips(candidateId, chosen)}
        ${renderActions(candidateId, decided, chosen)}
      </div>`;
    }

    const result = classify(entry.router_output);
    const reasons = result.topics.flatMap((topic) =>
      (topic.reasons || []).map((reason) => ({ name: topic.name, reason })),
    );
    return `<div class="topic-box is-suggestion is-inline" data-state="${escapeHtml(result.state)}">
      ${renderEvidenceStrip(result)}
      <div class="topic-suggestion-line"><span class="topic-state">${escapeHtml(STATE_LABELS[result.state])}</span><span class="topic-pending">系统建议 · 尚未应用</span></div>
      ${
        result.state === "single"
          ? `<p class="topic-primary">建议检查：<strong>${escapeHtml(topicName(result.primary))}</strong></p>`
          : ""
      }
      ${
        reasons.length
          ? `<details class="topic-why"><summary>查看判断依据</summary><ul class="topic-reasons">${reasons
              .map(
                (item) =>
                  `<li><span class="topic-reason-name">${escapeHtml(item.name)}</span>${escapeHtml(item.reason)}</li>`,
              )
              .join("")}</ul><p class="topic-note">${escapeHtml(STATE_NOTES[result.state])}</p></details>`
          : ""
      }
      ${renderChips(candidateId, chosen)}
      ${renderActions(candidateId, decided, chosen, result)}
      ${renderEventMatches(candidateId)}
    </div>`;
  }

  function renderEventMatches(candidateId) {
    const matches = view.eventMatches.filter((item) => (item.member_ids || []).includes(candidateId));
    if (!matches.length) return "";
    return `<div class="event-match-box"><strong>可能属于同一事件</strong><p class="topic-note">关键词只负责召集比较；系统不会自动合篮。</p>${matches
      .map((item) => {
        const otherId = (item.member_ids || []).find((id) => id !== candidateId) || "";
        const candidate = global.moraineCandidateLookup?.(otherId);
        const blockers = (item.blockers || []).map((value) => ({
          object_identity_unconfirmed: "对象尚未确认",
          action_continuity_unconfirmed: "动作连续性尚未确认",
          protected_kind_requires_review: "保护类型必须人工复核",
        }[value] || value));
        return `<div class="event-match-row"><span><b>${escapeHtml(candidate?.title || otherId)}</b><small>间隔 ${escapeHtml(item.evidence?.time_gap_minutes ?? "?")} 分钟</small></span><em>${escapeHtml(blockers.length ? blockers.join(" · ") : "对象与动作连续")}</em></div>`;
      })
      .join("")}</div>`;
  }

  function renderActions(candidateId, decided, chosen, result) {
    const accept =
      result && result.state !== "no_match" && result.topics.length
        ? `<button type="button" class="topic-action" data-topic-accept="${escapeHtml(candidateId)}">接受建议</button>`
        : "";
    return `<div class="topic-actions">
      ${accept}
      <button type="button" class="topic-action" data-topic-submit="${escapeHtml(candidateId)}">提交所选</button>
      <button type="button" class="topic-action is-plain" data-topic-none="${escapeHtml(candidateId)}">不选主题</button>
      <span class="topic-decided" aria-live="polite">${
        decided
          ? escapeHtml(
              chosen.length
                ? `已记录：${chosen.map(topicName).join("、")}`
                : "已记录：未选择主题",
            )
          : ""
      }</span>
    </div>`;
  }

  global.moraineTopicRouting.renderSuggestion = renderSuggestion;
  global.moraineTopicRouting.view = view;
  global.moraineTopicRouting.loadTopics = loadTopics;
  global.moraineTopicRouting.loadSuggestion = loadSuggestion;
  global.moraineTopicRouting.loadEventMatches = loadEventMatches;
  global.moraineTopicRouting.privateRequest = privateRequest;
  global.moraineTopicRouting.readToken = readToken;
  global.moraineTopicRouting.decorateCandidate = decorateCandidate;
})(typeof globalThis === "undefined" ? this : globalThis);

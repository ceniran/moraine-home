import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ui = require("../src/moraine/static/topic-routing.js");

/* ---------- escaping and highlighting ---------- */

test("escapes every HTML-significant character", () => {
  assert.equal(ui.escapeHtml(`<img src=x onerror="a">&'`),
    "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
});

test("highlight never emits caller-supplied markup", () => {
  const text = '<script>alert(1)</script> Moraine';
  const out = ui.highlight(text, [{ start: 26, end: 33 }]);
  assert.ok(!out.includes("<script>"), "raw script tag must not survive");
  assert.ok(out.includes("<mark class=\"topic-hit\">Moraine</mark>"));
  assert.equal(out.replace(/<\/?mark[^>]*>/g, ""), ui.escapeHtml(text));
});

test("highlight keeps offsets aligned on width-changing text", () => {
  const text = "今天聊了 Ｍｏｒａｉｎｅ 的设计";
  const out = ui.highlight(text, [{ start: 5, end: 12 }]);
  assert.ok(out.includes("<mark class=\"topic-hit\">Ｍｏｒａｉｎｅ</mark>"));
});

test("overlapping spans are merged, never double-wrapped", () => {
  const out = ui.highlight("abcdef", [{ start: 1, end: 4 }, { start: 2, end: 5 }]);
  assert.equal(out, "a<mark class=\"topic-hit\">bcde</mark>f");
});

test("malformed spans are discarded rather than corrupting output", () => {
  const out = ui.highlight("abc", [{ start: 2, end: 1 }, { start: -3, end: 1 }, {}]);
  assert.equal(out, "abc");
});

/* ---------- state classification ---------- */

const topic = (id, level) => ({ topic_id: id, name: id, evidence_level: level, vetoed: false });

test("single topic", () => {
  const r = ui.classify({ topics: [topic("t1", "exact")], primary_topic: "t1" });
  assert.deepEqual([r.state, r.primary], ["single", "t1"]);
});

test("multi topic never collapses to one primary", () => {
  const r = ui.classify({
    topics: [topic("t1", "exact"), topic("t2", "exact")],
    is_multi_topic: true, primary_topic: "t1",
  });
  assert.equal(r.state, "multi");
  assert.equal(r.primary, null);
});

test("ambiguous output is not resolved by the client", () => {
  const r = ui.classify({
    topics: [topic("t1", "supporting")], is_ambiguous: true, primary_topic: null,
  });
  assert.deepEqual([r.state, r.primary], ["ambiguous", null]);
});

test("primary_topic null is never replaced by a guess", () => {
  const r = ui.classify({ topics: [topic("t1", "exact"), topic("t2", "exact")], primary_topic: null });
  assert.equal(r.primary, null);
  assert.notEqual(r.state, "single");
});

test("vetoed topics are excluded and can yield no_match", () => {
  const r = ui.classify({
    topics: [{ topic_id: "t1", name: "t1", evidence_level: null, vetoed: true }],
  });
  assert.equal(r.state, "no_match");
});

test("missing router output is unavailable, not empty", () => {
  assert.equal(ui.classify(undefined).state, "unavailable");
});

/* ---------- control group ---------- */

test("only a server-released suggestion counts as visible", () => {
  assert.equal(ui.isVisible({ suggestion_visible: true }), true);
  for (const entry of [{ suggestion_visible: false }, { assignment: "visible" }, {}, null])
    assert.equal(ui.isVisible(entry), false);
});

test("private requests retain both owner and private capability boundaries", () => {
  const source = require("node:fs").readFileSync(
    new URL("../src/moraine/static/topic-routing.js", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('getItem("moraine_api_token")'));
  assert.ok(source.includes("Authorization: `Bearer ${ownerToken}`"));
  assert.ok(source.includes('startsWith("/moraine-beta/")'));
  assert.ok(source.includes('"/moraine-beta"'));
});

/* ---------- regressions found by running against a live server ---------- */

test("highlight targets the exact string the router scored", () => {
  const candidate = { title: "Alpha 的里程碑", content: "今天把 Alpha 的里程碑和排期都定了。" };
  const text = ui.routedText(candidate);
  assert.equal(text, "Alpha 的里程碑\n今天把 Alpha 的里程碑和排期都定了。");
  // Offsets taken against title+\n+content must land on the term itself.
  const start = text.indexOf("Alpha", 10);
  const out = ui.highlight(text, [{ start, end: start + 5 }]);
  assert.ok(out.includes('<mark class="topic-hit">Alpha</mark>'));
});

test("routedText tolerates a missing candidate", () => {
  assert.equal(ui.routedText(undefined), "\n");
});

test("spans clamped past the end never emit an empty mark", () => {
  const out = ui.highlight("abc", [{ start: 3, end: 9 }, { start: 5, end: 7 }]);
  assert.equal(out, "abc");
  assert.ok(!out.includes("<mark"));
});

test("evidence highlighting keeps the strongest overlapping term", () => {
  const out = ui.highlightEvidence("安全回退", [
    { start: 0, end: 4, term: "安全回退", evidence: "alias" },
    { start: 2, end: 4, term: "回退", evidence: "supporting" },
  ]);
  assert.ok(out.includes('class="topic-hit is-alias"'));
  assert.ok(!out.includes("is-supporting"));
  assert.equal((out.match(/<mark/g) || []).length, 1);
});

test("content highlighting translates routed title offsets", () => {
  const title = "验收";
  const content = "本地检索支持回退";
  const start = title.length + 1;
  const out = ui.highlightEvidence(content, [
    { start, end: start + 4, term: "本地检索", evidence: "exact" },
  ], start);
  assert.ok(out.startsWith('<mark class="topic-hit is-exact"'));
});

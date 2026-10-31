import test from "node:test";
import assert from "node:assert/strict";
import { createUI } from "../dist/ui.js";
import { freshState } from "../dist/state.js";

function withMockDocument(run) {
  const priorDocument = globalThis.document;
  const makeNode = (tagName) => ({
    tagName, children: [], dataset: {}, attributes: {}, style: {},
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  });
  globalThis.document = { createElement: makeNode, createDocumentFragment: () => makeNode("#fragment") };
  try { run(); }
  finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
}

function find(node, className) {
  if (node?.className === className || node?.className?.split(/\s+/).includes(className)) return node;
  for (const child of node?.children || []) {
    const match = find(child, className);
    if (match) return match;
  }
  return null;
}

function allText(node) {
  return [node?.textContent || "", ...(node?.children || []).map(allText)].join(" ");
}

test("weekly focus UI exposes compact progress and an accessible numeric status", () => withMockDocument(() => {
  const state = freshState();
  state.weeklyFocus.progress = 9;
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const card = find(overview, "weekly-focus");
  const progress = find(card, "weekly-focus-track");
  assert.ok(card);
  assert.equal(progress.attributes.role, "progressbar");
  assert.equal(progress.attributes["aria-valuemax"], "18");
  assert.equal(progress.attributes["aria-valuenow"], "9");
  assert.ok(find(card, "weekly-focus-copy"));
  assert.match(find(card, "weekly-focus-status").textContent, /已過半/);
}));

test("overview shows the prior-night cashbook and food-safety recovery countdown", () => withMockDocument(() => {
  const state = freshState();
  state.day = 3;
  state.outbreakRecoveryUntilDay = 4;
  state.journal = [{ day: 2, net: 90, guests: ["熟客"], goodGuests: 1, cashbook: {
    day: 2, income: 420, expenses: 330, net: 90, available: true,
    sales: 300, tips: 70, activity: 50, guestCount: 1, satisfiedCount: 1,
    focus: { title: "讓巷口記住夜嵐", progress: 4, target: 18, resolved: false }
  } }];
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const recap = find(overview, "night-recap");
  const recovery = find(overview, "recovery-notice");
  assert.ok(recap);
  assert.equal(recap.attributes["aria-label"], "前一夜現金簿摘要");
  assert.ok(find(recap, "night-recap-metrics"));
  assert.match(recovery.textContent, /接下來 2 夜客流各少 1 桌/);
  assert.match(recovery.textContent, /第 5 夜起恢復/);
}));

test("period recap and investment preview keep accounting context and a clear non-guarantee caveat", () => withMockDocument(() => {
  const state = freshState();
  state.day = 31;
  state.phase = "decision";
  state.accounting.monthlyReports = [{ endDay: 30, outcomeId: "steady-lantern",
    outcome: { title: "穩穩亮著的小店" }, totals: { profit: 420 } }];
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const period = find(overview, "period-opening-recap");
  assert.ok(period);
  const reportLink = find(period, "period-opening-report");
  assert.equal(reportLink.dataset.action, "open-report");
  assert.equal(reportLink.dataset.id, "monthly");
  const previews = [];
  const collect = (node) => {
    if (node.className?.startsWith("decision-preview")) previews.push(node);
    (node.children || []).forEach(collect);
  };
  collect(overview);
  assert.ok(previews.length > 0);
  const previewText = previews.map(allText).join(" ");
  assert.match(previewText, /投資後每夜固定承諾/);
  assert.match(previewText, /接下來 7 夜約增加/);
  assert.match(previewText, /新增同額每夜貢獻/);
  assert.match(previewText, /本週焦點預覽/);
  assert.match(previewText, /估算非保證：只計固定支出，未含備料、事件／事故與分店營運變動/);
}));

test("weekly risk details are collapsed by default and appear only at the weekly decision", () => withMockDocument(() => {
  const state = freshState();
  state.day = 31;
  state.phase = "decision";
  state.outlets[0].tier = "fixed";
  state.outlets[0].accidentCoverage = true;
  state.insuranceSnapshot = { periodStartDay: 31, outlets: [{ outletId: "main", employees: 3,
    perEmployee: { accident: 24, labor: 0, health: 0 }, covered: { accident: true, product: true, public: false } }] };
  state.journal = [{ day: 30, safetyIncident: { title: "切菜備料意外", claim: 58 } }];
  state.insuranceClaims = [{ incidentId: "knife-cut", description: "切菜備料意外", amount: 58, payoutDay: 33, status: "receivable" }];
  const ui = createUI({ state, saveState() {} });
  const overview = ui.renderOverview();
  const risk = find(overview, "risk-chain-card");
  assert.ok(risk);
  assert.equal(risk.tagName, "details");
  assert.equal(risk.children[0].tagName, "summary");
  assert.equal(risk.open, undefined);
  assert.equal(risk.attributes.open, undefined);
  const text = allText(risk);
  assert.match(text, /切菜備料意外/);
  assert.match(text, /待收/);
  assert.match(text, /第 33 夜/);
  assert.match(text, /本期已生效 2 \/ 2 項適用保障/);
  assert.match(text, /下期保費估算/);
  assert.match(text, /展開查看保障與保費/);
  state.phase = "prep";
  assert.equal(find(ui.renderOverview(), "risk-chain-card"), null);
}));

test("near-complete weekly focus recap says how little remained without a failure penalty", () => withMockDocument(() => {
  const state = freshState();
  state.day = 31;
  state.phase = "decision";
  state.weeklyFocus = { id: "expand", startDay: 22, progress: 22, target: 24, resolved: true,
    result: { title: "讓新桌區熱鬧起來", progress: 22, target: 24, success: false, startDay: 22,
      resolvedDay: 28, message: "未完成，沒有額外扣款。" } };
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const recap = find(overview, "weekly-focus");
  const copy = find(recap, "weekly-focus-copy");
  assert.match(copy.textContent, /只差 2 桌/);
  assert.match(copy.textContent, /沒有扣款/);
}));

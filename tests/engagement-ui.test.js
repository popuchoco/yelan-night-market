import test from "node:test";
import assert from "node:assert/strict";
import { createUI } from "../dist/ui.js";
import { canShowPreviousNightCashbook } from "../dist/ui/engagement.js";
import { freshState } from "../dist/state.js";

function withMockDocument(run) {
  const priorDocument = globalThis.document;
  const makeNode = (tagName) => ({
    tagName, children: [], dataset: {}, attributes: {}, style: {}, disabled: false,
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

test("prior-night cashbook only appears in preparation when an actual previous-night summary exists", () => {
  const summary = { day: 1, available: true };
  assert.equal(canShowPreviousNightCashbook({ day: 1, phase: "prep" }, { day: 0, available: false }), false,
    "the first night has no prior cashbook and should not reserve map space");
  assert.equal(canShowPreviousNightCashbook({ day: 2, phase: "prep" }, summary), true);
  assert.equal(canShowPreviousNightCashbook({ day: 2, phase: "service" }, summary), false);
  assert.equal(canShowPreviousNightCashbook({ day: 2, phase: "prep" }, summary, 2), false,
    "a dismissed cashbook stays closed for this night");
});

test("nightly priority exposes the current focus with an accessible numeric progress status", () => withMockDocument(() => {
  const state = freshState();
  state.weeklyFocus.progress = 9;
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const card = find(overview, "tonight-priority");
  const progress = find(card, "tonight-priority-track");
  assert.ok(card);
  assert.equal(progress.attributes.role, "progressbar");
  assert.equal(progress.attributes["aria-valuemax"], "18");
  assert.equal(progress.attributes["aria-valuenow"], "9");
  assert.match(find(card, "tonight-priority-focus-copy").textContent, /還差 9 桌/);
}));

test("preparation overview highlights one nightly action and progressively folds first-week accounting detail", () => withMockDocument(() => {
  const state = freshState();
  state.day = 1;
  state.phase = "prep";
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const priority = find(overview, "tonight-priority");
  const details = find(overview, "onboarding-detail");
  assert.ok(priority);
  assert.equal(priority.attributes["aria-label"], "今晚一件事");
  assert.ok(find(priority, "tonight-priority-title"));
  assert.ok(find(priority, "tonight-priority-onboarding"));
  assert.equal(find(overview, "weekly-focus"), null, "the old second focus card is replaced by the single priority card");
  assert.ok(details);
  assert.equal(details.tagName, "details");
  assert.equal(details.attributes.open, undefined);
  assert.match(allText(find(details, "onboarding-detail-summary")), /預估淨額/);
  assert.ok(find(details, "ledger-card"), "full accounting detail remains available inside the disclosure");
}));

test("opening-week priority card merges event and stock guidance into one compact context row", () => withMockDocument(() => {
  const state = freshState();
  state.day = 3;
  state.phase = "prep";
  state.stock.chicken = 0;
  const overview = createUI({ state, saveState() {} }).renderOverview();
  const priority = find(overview, "tonight-priority");
  const context = find(priority, "tonight-priority-context");
  assert.ok(context);
  assert.equal(context.attributes["aria-label"], "今晚事件與備料提醒");
  assert.match(context.textContent, /客訴/);
  assert.match(context.textContent, /雞腿與白胡椒缺貨/);
  assert.equal(find(overview, "event-card") !== null, true, "the full event description remains available below the guidance card");
}));

test("service overview keeps customer service visible while folding detailed bookkeeping in onboarding", () => withMockDocument(() => {
  const state = freshState();
  state.phase = "service";
  state.ledger = { sales: 125, tips: 10, bonus: 0, food: 35 };
  const overview = createUI({ state, saveState() {} }).renderOverview();
  assert.ok(find(overview, "tonight-priority"));
  assert.ok(find(overview, "guest-list"));
  assert.match(allText(find(overview, "onboarding-detail-summary")), /收入/);
  assert.match(allText(find(overview, "onboarding-detail-summary")), /食材耗用/);
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
  assert.match(allText(recap), /差一點點/);
}));

test("stockout dishes remain selectable for feedback but are clearly unavailable, while recalls stay disabled", () => withMockDocument(() => {
  const state = freshState();
  Object.keys(state.stock).forEach((key) => { state.stock[key] = 0; });
  const ui = createUI({ state, saveState() {} });
  const choices = ui.renderOrderChoices({ difficult: false, need: "seafood" });
  const stockout = [];
  const walk = (node) => {
    if (node.dataset?.action === "stockout-dish") stockout.push(node);
    (node.children || []).forEach(walk);
  };
  walk(choices);
  assert.ok(stockout.length > 0);
  assert.equal(stockout[0].disabled, false);
  assert.ok(stockout[0].className.includes("stockout"));
}));

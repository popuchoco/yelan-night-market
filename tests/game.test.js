import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readStyles } from "./style-support.js";
import { DATA, getOutletSpecialty, outletRetailPrice } from "../dist/data.js";
import { CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, ENDINGS, MARKET_CARDS, MARKET_CARD_SCHEDULE, WEEKLY_DECISION_DAYS, campaignCycleDay, campaignEntry, marketCardForDay, selectEnding } from "../dist/campaign.js";
import { closeDepreciation, CHART_OF_ACCOUNTS, getDailyCashbookSummary, postJournal } from "../dist/accounting.js";
import { boot, createGameEngine } from "../dist/game.js";
import { createGameAudio } from "../dist/audio.js";
import { createUI } from "../dist/ui.js";
import { applyCameraAction, getFootprintDepth } from "../dist/scene.js";
import { getStallVisualProfile, splitStallSupportPosts } from "../dist/scene/objects.js";
import { createRevenueRenderer, getRevenueBreakdown } from "../dist/scene/revenue.js";
import { INSURANCE_RATES, isInsuranceBillingDay } from "../dist/safety.js";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS, evaluateAchievements, normalizeAchievementState } from "../dist/achievements.js";
import { WEEKLY_FOCUSES, createWeeklyFocus, getLegacyWeeklyFocus, getWeeklyFocusIdForDecision, normalizeWeeklyFocus, recordWeeklyFocusProgress, resolveWeeklyFocus } from "../dist/progression.js";
import {
  createLedger, fixedOperatingCost, forecast, freshState, getPurchasePrice, getTonightGuests, hasBrandAlliance,
  captureStateSnapshot, loadState, loadStateResult, normalizeState, restoreStateSnapshot,
  saveState, saveStateResult, clearSavedProgress, SAVE_SCHEMA_VERSION,
  todayEvent, todayMarketCard, todayStory, ledgerIncome, ledgerNet
} from "../dist/state.js";

function serviceState(day = 3) {
  const state = freshState();
  state.day = day;
  state.phase = "service";
  state.ledger = createLedger(state);
  return state;
}

test("three complaint responses apply their distinct costs and reputation effects", () => {
  const calm = serviceState(3);
  calm.customerIndex = 3;
  const calmCoins = calm.coins;
  const calmFame = calm.fame;
  assert.equal(createGameEngine(calm).resolveComplaint("calm").ok, true);
  assert.equal(calm.coins, calmCoins);
  assert.equal(calm.fame, calmFame - 1);

  const snack = serviceState(3);
  snack.customerIndex = 3;
  assert.equal(createGameEngine(snack).resolveComplaint("snack").ok, true);
  assert.equal(snack.coins, 1480 - DATA.economy.complaintSnackCost);
  assert.equal(snack.ledger.compensation, DATA.economy.complaintSnackCost);
  assert.equal(snack.fame, 39);

  const refund = serviceState(3);
  refund.customerIndex = 3;
  assert.equal(createGameEngine(refund).resolveComplaint("refund").ok, true);
  assert.equal(refund.coins, 1480 - DATA.economy.complaintRefund);
  assert.equal(refund.ledger.refunds, DATA.economy.complaintRefund);
});

test("out-of-stock dishes do not advance the queue or affect revenue", () => {
  const state = serviceState();
  state.stock.chicken = 0;
  const before = { coins: state.coins, revenue: state.revenue, customerIndex: state.customerIndex };
  const result = createGameEngine(state).serveDish("pepper-soup");
  assert.equal(result.ok, false);
  assert.deepEqual({ coins: state.coins, revenue: state.revenue, customerIndex: state.customerIndex }, before);
});

test("service consumes one ingredient and applies featured-dish and street-music bonuses", () => {
  const state = serviceState(5);
  const startingCoins = state.coins;
  const result = createGameEngine(state).serveDish("pepper-soup");
  assert.equal(result.ok, true);
  assert.equal(state.stock.chicken, 3);
  assert.equal(state.ledger.sales, 120);
  assert.equal(state.ledger.tips, DATA.economy.standardTip + DATA.economy.featuredDishBonus + DATA.economy.streetMusicTip);
  assert.equal(state.coins - startingCoins, state.ledger.sales + state.ledger.tips);
});

test("hood upgrade changes the next ledger's utility costs", () => {
  const state = freshState();
  const before = createLedger(state);
  const engine = createGameEngine(state);
  assert.equal(engine.upgradeEquipment("hood").ok, true);
  const after = createLedger(state);
  assert.equal(after.electricity, before.electricity - DATA.economy.hoodElectricitySavings);
  assert.equal(after.gas, before.gas - DATA.economy.hoodGasSavings);
  assert.equal(after.water, DATA.economy.water);
});

test("opening deducts rent, payroll, water, power, and gas from working cash", () => {
  const state = freshState();
  const ledger = createLedger(state);
  const fixed = ledger.rent + ledger.expansionRent + ledger.acquisitionRent + ledger.labor + ledger.water + ledger.electricity + ledger.gas + ledger.fees;
  assert.equal(createGameEngine(state).openDoors().ok, true);
  assert.equal(state.coins, 1480 - fixed);
  assert.equal(state.ledger.water, 18);
});

test("save and load round-trip progress, while invalid saves fall back safely", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = freshState();
  state.day = 12;
  state.coins = 3210;
  state.equipment.hood = 2;
  assert.equal(saveState(state, storage), true);
  assert.deepEqual(loadState(storage), state);
  assert.equal(JSON.parse(values.get(DATA.saveKey)).schemaVersion, SAVE_SCHEMA_VERSION);

  values.set(DATA.saveKey, "not-json");
  assert.equal(loadState(storage).phase, "prep");
  assert.equal(values.get(DATA.saveKey + ".corrupt-backup"), "not-json");
});

test("save status reports migration, quota errors, and future versions without overwriting them", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  values.set(DATA.saveKey, JSON.stringify({ day: 9, coins: 700 }));
  const migrated = loadStateResult(storage);
  assert.equal(migrated.status, "migrated");
  assert.equal(migrated.state.day, 9);
  assert.equal(migrated.state.schemaVersion, SAVE_SCHEMA_VERSION);

  const fullStorage = { getItem: () => null, setItem() { const error = new Error("full"); error.name = "QuotaExceededError"; throw error; } };
  assert.deepEqual(saveStateResult(freshState(), fullStorage), { ok: false, reason: "quota" });

  const futureSave = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION + 1, day: 74, coins: 1200 });
  values.set(DATA.saveKey, futureSave);
  assert.deepEqual(loadStateResult(storage), {
    state: freshState(), status: "unsupported-version", sourceVersion: SAVE_SCHEMA_VERSION + 1
  });
  assert.equal(values.get(DATA.saveKey), futureSave);
});

test("mutable game actions can restore the same state object after an exception", () => {
  const state = freshState();
  const stateReference = state;
  const before = JSON.parse(JSON.stringify(state));
  const snapshot = captureStateSnapshot(state);
  state.coins = 0;
  state.accounting.balances["1000"] = -1200;
  state.outlets[0].active = false;
  restoreStateSnapshot(state, snapshot);
  assert.equal(state, stateReference);
  assert.deepEqual(state, before);
});

test("clearSavedProgress removes current, legacy, and corrupt-backup keys", () => {
  const values = new Map([
    [DATA.saveKey, "current"],
    [DATA.legacyKey, "legacy"],
    [DATA.saveKey + ".corrupt-backup", "backup"]
  ]);
  const attempted = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => { attempted.push(key); values.delete(key); }
  };
  assert.deepEqual(clearSavedProgress(storage), { ok: true, reason: "cleared" });
  assert.equal(values.size, 0);
  assert.deepEqual(attempted, [DATA.saveKey, DATA.legacyKey, DATA.saveKey + ".corrupt-backup"]);

  const failedAttempts = [];
  const partialStorage = {
    removeItem: (key) => { failedAttempts.push(key); if (key === DATA.legacyKey) throw new Error("blocked"); }
  };
  assert.deepEqual(clearSavedProgress(partialStorage), { ok: false, reason: "failed" });
  assert.deepEqual(failedAttempts, [DATA.saveKey, DATA.legacyKey, DATA.saveKey + ".corrupt-backup"]);
  assert.deepEqual(clearSavedProgress(null), { ok: false, reason: "unavailable" });

  const protectedValues = new Map([[DATA.saveKey, JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION + 1 })]]);
  const protectedStorage = { removeItem: (key) => protectedValues.delete(key) };
  assert.deepEqual(clearSavedProgress(protectedStorage, { preserveNewerSave: true }), { ok: false, reason: "unsupported-version" });
  assert.equal(protectedValues.has(DATA.saveKey), true);
});

test("restartCampaign resets live state to day 1 without keeping progress fields", () => {
  const state = freshState();
  state.day = 18;
  state.coins = 5200;
  state.phase = "service";
  state.expansions = 2;
  state.acquisitions = 1;
  state.outlets.push({ id: "branch-1", name: "港口炸物", type: "food", tier: "mobile", active: true });
  state.journal.push({ day: 7, event: "節慶", net: 40 });
  const stateReference = state;
  const result = createGameEngine(state).restartCampaign();
  assert.equal(result.ok, true);
  assert.equal(state, stateReference);
  assert.equal(state.day, 1);
  assert.equal(state.phase, "prep");
  assert.equal(state.coins, 1480);
  assert.equal(state.expansions, 0);
  assert.equal(state.acquisitions, 0);
  assert.equal(state.outlets.length, 1);
  assert.equal(state.outlets[0].id, "main");
  assert.equal(state.journal.length, 0);
  assert.equal(state.schemaVersion, SAVE_SCHEMA_VERSION);
});

test("extreme or oversized legacy progress normalizes to bounded outlet and event collections", () => {
  const migrated = normalizeState({
    day: -4, coins: -800, acquisitions: 999, expansions: 999,
    outlets: Array.from({ length: 200 }, (_, index) => ({ id: "branch-" + index, type: "food", active: true })),
    journal: Array.from({ length: 9000 }, (_, day) => ({ day, event: "legacy" }))
  });
  assert.equal(migrated.day, 1);
  assert.equal(migrated.coins, -800);
  assert.equal(migrated.acquisitions, 4);
  assert.equal(migrated.expansions, 9);
  assert.equal(migrated.outlets.length, 5);
  assert.equal(migrated.journal.length, 8000);
});

test("browser boot is an explicit export for future startup integration tests", () => {
  assert.equal(typeof boot, "function");
});

test("legacy saves keep progress and receive the first unresolved weekly decision", () => {
  const migrated = normalizeState({
    day: 8, coins: 990, phase: "prep", fame: 48, regulars: 10,
    journal: [{ day: 7, event: "節慶", title: "一盞燈", choice: "紙船", net: 50, guests: [] }]
  });
  assert.equal(migrated.day, 8);
  assert.equal(migrated.coins, 990);
  assert.equal(migrated.phase, "decision");
  assert.equal(migrated.expansions, 0);
  assert.deepEqual(migrated.decisions, []);
});

test("legacy acquired stalls receive a compatible category for new alliance progression", () => {
  const migrated = normalizeState({ day: 16, expansions: 1, acquisitions: 2 });
  assert.deepEqual(migrated.acquisitionTypes, ["food", "food"]);
  assert.equal(hasBrandAlliance(migrated), true);
});

test("campaign calendar covers 30 distinct story nights and has four weekly turns", () => {
  assert.equal(CAMPAIGN_CALENDAR.length, CAMPAIGN_DAYS);
  assert.equal(new Set(CAMPAIGN_CALENDAR.map((night) => night.title)).size, CAMPAIGN_DAYS);
  assert.deepEqual(WEEKLY_DECISION_DAYS, [8, 15, 22, 29]);
  assert.equal(todayEvent({ day: 1 }).id, "festival");
  assert.equal(todayEvent({ day: 8 }).id, "inspection");
  assert.equal(todayEvent({ day: 30 }).name, CAMPAIGN_CALENDAR[29].name);
  assert.equal(campaignEntry(31).title, campaignEntry(1).title);
  assert.equal(campaignCycleDay(61), 1);
});

test("new 30-night chapter opening reflects the previous ending and last weekly decision", () => {
  const legacy = freshState();
  legacy.day = 31;
  assert.equal(todayStory(legacy).title, campaignEntry(1).title);

  const thriving = freshState();
  thriving.day = 31;
  thriving.accounting.monthlyReports.push({ endDay: 30, outcomeId: "harbor-icon", outcome: { title: "港灣夜市名店" } });
  thriving.decisions.push({ day: 29, id: "expand" });
  const thrivingOpening = todayStory(thriving);
  assert.equal(thrivingOpening.chapter, 2);
  assert.match(thrivingOpening.title, /第 2 期/);
  assert.match(thrivingOpening.story, /港灣夜市名店/);
  assert.match(thrivingOpening.story, /添上的座位/);
  assert.notEqual(thrivingOpening.title, campaignEntry(1).title);

  const rebuilding = freshState();
  rebuilding.day = 61;
  rebuilding.accounting.monthlyReports.push({ endDay: 60, outcomeId: "quiet-lantern", outcome: { title: "巷口漸漸安靜" } });
  rebuilding.decisions.push({ day: 59, id: "hold" });
  const rebuildingOpening = todayStory(rebuilding);
  assert.equal(rebuildingOpening.chapter, 3);
  assert.match(rebuildingOpening.title, /重新聚起燈火/);
  assert.match(rebuildingOpening.story, /保留的現金/);
});

test("optional harbor ambience is lazy, user-controlled, and stops when muted", () => {
  const makeParam = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeNode {
    constructor() { this.gain = makeParam(); this.frequency = makeParam(); this.Q = makeParam(); this.started = 0; this.stopped = 0; this.connections = []; }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.disconnected = true; }
    start() { this.started += 1; }
    stop() { this.stopped += 1; }
  }
  class FakeAudioContext {
    constructor() { this.sampleRate = 8000; this.currentTime = 1; this.state = "suspended"; this.destination = {}; this.nodes = []; }
    createBuffer(_channels, length, rate) {
      this.bufferArgs = [length, rate];
      return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() { const node = new FakeNode(); this.nodes.push(node); return node; }
    createBiquadFilter() { const node = new FakeNode(); this.nodes.push(node); return node; }
    createGain() { const node = new FakeNode(); this.nodes.push(node); return node; }
    createOscillator() { const node = new FakeNode(); this.nodes.push(node); return node; }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; this.suspendCalls = (this.suspendCalls || 0) + 1; return Promise.resolve(); }
  }
  const context = new FakeAudioContext();
  let factoryCalls = 0;
  const audio = createGameAudio({ contextFactory: () => { factoryCalls += 1; return context; }, random: () => 0.6 });
  assert.equal(audio.playTone("success"), false);
  assert.equal(factoryCalls, 0);
  audio.setEnabled(true);
  assert.equal(factoryCalls, 0);
  assert.equal(audio.playTone("success"), true);
  assert.deepEqual(context.bufferArgs, [32000, 8000]);
  assert.equal(context.nodes.filter((node) => node.started).length, 3);
  audio.suspend();
  assert.equal(context.suspendCalls, 1);
  const ambientSource = context.nodes[0];
  audio.setEnabled(false);
  assert.equal(ambientSource.stopped, 1);
  assert.equal(ambientSource.disconnected, true);
  assert.equal(audio.isEnabled(), false);
});

test("default audio factory safely handles browsers without Web Audio", () => {
  const audio = createGameAudio();
  audio.setEnabled(true);
  assert.equal(audio.playTone("tap"), false);
});

test("legacy 30-night ending saves resume at night 31 with a live world", () => {
  const migrated = normalizeState({ day: 30, phase: "ending", endingId: "harbor-icon", coins: 700 });
  assert.equal(migrated.day, 31);
  assert.equal(migrated.phase, "prep");
  assert.equal(migrated.endingId, null);
  assert.equal(migrated.coins, 700);
  assert.equal(todayEvent(migrated).id, todayEvent({ day: 1 }).id);
});

test("event pricing modifiers distinguish supplier shortage and market sale", () => {
  const chicken = DATA.ingredients.find((item) => item.id === "chicken");
  assert.equal(getPurchasePrice({ day: 6 }, chicken), Math.round(chicken.cost * DATA.economy.supplierMarkup));
  assert.equal(getPurchasePrice({ day: 9 }, chicken), Math.round(chicken.cost * DATA.economy.marketDiscount));
});

test("market cards require a pre-opening choice and apply tourist costs and guest capacity once", () => {
  const state = freshState();
  state.day = 2;
  const engine = createGameEngine(state);
  const startingCoins = state.coins;
  assert.equal(todayMarketCard(state).id, "tourist-surge");
  assert.equal(engine.openDoors().ok, false);
  assert.equal(engine.chooseMarketCard("promote").ok, true);
  assert.equal(getTonightGuests(state).length, 5);
  assert.equal(createLedger(state).marketing, DATA.economy.touristPromotionCost);
  assert.equal(engine.chooseMarketCard("pass").ok, false);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.coins, startingCoins - fixedOperatingCost(state.ledger));
  assert.equal(state.fame, 39);
});

test("working capital is one-time, accrues nightly interest, and can be repaid at a weekly turn", () => {
  const state = freshState();
  state.day = 15;
  state.phase = "decision";
  const engine = createGameEngine(state);
  const cash = state.coins;
  assert.equal(engine.borrowWorkingCapital().ok, true);
  assert.equal(state.coins, cash + DATA.economy.loanPrincipal);
  assert.equal(engine.borrowWorkingCapital().ok, false);
  assert.equal(engine.chooseWeeklyDecision("hold").ok, true);
  assert.equal(createLedger(state).interest, Math.max(1, Math.round(DATA.economy.loanPrincipal * DATA.economy.loanWeeklyRate / 7)));
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.ledger.interest, 2);
  state.phase = "decision";
  assert.equal(engine.repayWorkingCapital().ok, false);
  state.day = 22;
  assert.equal(createLedger(state).interest, 3);

  const beforeRepayment = state.coins;
  assert.equal(engine.repayWorkingCapital().ok, true);
  assert.equal(state.coins, beforeRepayment - DATA.economy.loanPrincipal);
  assert.equal(state.loanPrincipal, 0);
  assert.equal(engine.borrowWorkingCapital().ok, false);
});

test("same-category acquisitions plus expansion unlock continuing alliance benefits", () => {
  const mixed = freshState();
  mixed.day = 8;
  mixed.phase = "decision";
  mixed.coins = 3000;
  mixed.expansions = 1;
  mixed.acquisitions = 1;
  mixed.acquisitionTypes = ["food"];
  const mixedEngine = createGameEngine(mixed);
  assert.equal(mixedEngine.chooseWeeklyDecision("acquire", "leisure").ok, true);
  assert.equal(hasBrandAlliance(mixed), false);

  const state = freshState();
  state.day = 8;
  state.phase = "decision";
  state.coins = 3000;
  state.expansions = 1;
  state.acquisitions = 1;
  state.acquisitionTypes = ["food"];
  const engine = createGameEngine(state);
  const guestsBefore = getTonightGuests(state).length;
  const fish = DATA.ingredients.find((item) => item.id === "seafood");
  assert.equal(engine.chooseWeeklyDecision("acquire", "food").ok, true);
  assert.equal(hasBrandAlliance(state), true);
  assert.equal(getTonightGuests(state).length, guestsBefore + 2);
  state.day = 1;
  assert.equal(getPurchasePrice(state, fish), Math.round(fish.cost * DATA.economy.alliancePurchaseMultiplier));
});

test("camera operations clamp tilt and zoom and support reset", () => {
  const initial = { yaw: 0, elevation: DATA.camera.defaultElevation, zoom: 1, panX: 0, panY: 0 };
  const turned = applyCameraAction(initial, "orbit-left");
  assert.equal(turned.yaw, -DATA.camera.orbitStep);
  let low = initial;
  for (let i = 0; i < 20; i++) low = applyCameraAction(low, "tilt-down");
  assert.equal(low.elevation, DATA.camera.minElevation);
  let zoomed = initial;
  for (let i = 0; i < 20; i++) zoomed = applyCameraAction(zoomed, "zoom-in");
  assert.equal(zoomed.zoom, DATA.camera.maxZoom);
  assert.deepEqual(applyCameraAction(zoomed, "camera-reset"), initial);
});

test("scene depth sorting uses camera-facing footprint edges and reorders stall supports after orbit", () => {
  const depthBySum = (x, z) => x + z;
  assert.equal(getFootprintDepth({ x: 10, z: 20, w: 30, d: 40 }, depthBySum), 100);

  const stall = { x: 100, z: 200, w: 120, d: 90 };
  const northView = splitStallSupportPosts(stall, (x, z) => z);
  assert.deepEqual(northView.rear.map((post) => post.index), [0, 1]);
  assert.deepEqual(northView.front.map((post) => post.index), [2, 3]);

  const eastView = splitStallSupportPosts(stall, (x) => x);
  assert.deepEqual(eastView.rear.map((post) => post.index), [0, 2]);
  assert.deepEqual(eastView.front.map((post) => post.index), [1, 3]);
});

test("scene revenue summary keeps sales, tips, activity, other income, and cash adjustments separate", () => {
  const breakdown = getRevenueBreakdown({
    sales: 420, tips: 95, bonus: 35, storyBonus: 80,
    subsidies: 60, insuranceClaimRevenue: 110, cashOver: 25,
    cashShort: 45, refunds: 30
  });
  assert.deepEqual(breakdown, {
    sales: 420, tips: 95, activity: 115, subsidies: 60,
    insuranceClaimRevenue: 110, cashOver: 25, other: 195,
    adjustments: 75, total: 630
  });
  assert.equal(breakdown.total, breakdown.sales + breakdown.tips + breakdown.activity);
  assert.notEqual(breakdown.total, breakdown.total + breakdown.other);
});

test("scene revenue tracker animates branch receipts and resets when a new night starts", () => {
  const state = freshState();
  const renderer = createRevenueRenderer({
    state, ctx: {}, view: { w: 900, h: 600 },
    drawRoundRect() {}, eventAnchor: () => ({ x: 450, y: 280 })
  });
  assert.equal(renderer.getDisplay().total, 0);

  state.phase = "service";
  state.ledger = {
    sales: 200, tips: 40, bonus: 30, storyBonus: 0,
    subsidies: 60, insuranceClaimRevenue: 0, cashOver: 0,
    cashShort: 0, refunds: 0
  };
  state.outlets.push({ id: "branch-fish", name: "港口炸物", lastResult: { day: state.day, sales: 100 } });
  renderer.update(1000);
  assert.ok(renderer.getDisplay().total > 0);
  assert.ok(renderer.getDisplay().total < 270);
  assert.deepEqual(renderer.drainAnnouncements(), [
    "港口炸物・自動營運，+新台幣 100 元。",
    "商品銷售＋小費＋活動／手記收入，+新台幣 170 元。",
    "補助收入，+新台幣 60 元；另列其他收入，不併入今晚營業收入。"
  ]);

  renderer.update(1200, true);
  assert.equal(renderer.getDisplay().total, 270);
  assert.equal(renderer.getDisplay().other, 60);
  assert.equal(renderer.drainAnnouncements().length, 0);

  state.day += 1;
  state.phase = "prep";
  state.ledger = null;
  renderer.update(1400);
  assert.deepEqual(renderer.getDisplay(), {
    sales: 0, tips: 0, activity: 0, subsidies: 0, insuranceClaimRevenue: 0,
    cashOver: 0, other: 0, adjustments: 0, total: 0, day: 2, settled: false
  });
  renderer.showNotice(-45, "昨夜・收銀短溢損失");
  renderer.update(1450);
  assert.equal(renderer.getDisplay().total, 0);
  assert.deepEqual(renderer.drainAnnouncements(), [
    "昨夜・收銀短溢損失，−新台幣 45 元；作為收銀差異或退款另列，不列為營收。"
  ]);
});

test("main stall visual profile reflects tier and expansion growth without saving scene coordinates", () => {
  const mainStall = DATA.stalls.find((stall) => stall.main);
  const state = freshState();
  const mobile = getStallVisualProfile(mainStall, state);
  assert.equal(mobile.w, mainStall.w);
  assert.equal(mobile.h, mainStall.h);

  state.outlets[0].tier = "fixed";
  const fixed = getStallVisualProfile(mainStall, state);
  assert.ok(fixed.w > mobile.w);
  assert.ok(fixed.h > mobile.h);
  assert.equal(fixed.lanternCount, mobile.lanternCount + 2);

  state.outlets[0].tier = "dapaidang";
  state.expansions = 3;
  const large = getStallVisualProfile(mainStall, state);
  assert.ok(large.w > fixed.w);
  assert.ok(large.d > fixed.d);
  assert.ok(large.h > fixed.h);
  assert.equal(large.expansions, 3);
  assert.equal(large.lanternCount, 7);
  assert.equal(large.smokeCount, 6);
  assert.equal(large.x + large.w / 2, mainStall.x + mainStall.w / 2);
  assert.equal(large.z + large.d / 2, mainStall.z + mainStall.d / 2);

  state.expansions = 99;
  assert.equal(getStallVisualProfile(mainStall, state).expansions, 9);
  const neighbor = DATA.stalls.find((stall) => !stall.main);
  assert.equal(getStallVisualProfile(neighbor, state).w, neighbor.w);
});

test("night transitions keep the operating cycle valid", () => {
  const state = serviceState();
  state.phase = "report";
  state.reportChoice = "paperboat";
  state.results = [{ name: "阿琴" }];
  const result = createGameEngine(state).nextNight();
  assert.equal(result.ok, true);
  assert.equal(state.day, 4);
  assert.equal(state.phase, "prep");
  assert.equal(state.ledger, null);
  assert.equal(state.journal[0].day, 3);
});

test("a night cannot be archived before choosing its story branch", () => {
  const state = serviceState(3);
  state.phase = "report";
  state.results = [{ name: "阿琴" }];
  const engine = createGameEngine(state);
  const fame = state.fame;
  assert.equal(engine.nextNight().ok, false);
  assert.equal(state.day, 3);
  assert.equal(engine.chooseStory("paperboat").ok, true);
  assert.equal(state.fame, fame + 2);
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.day, 4);
  assert.equal(state.phase, "prep");
});

test("hiring improves tips while acquiring a stall adds rent, visitors, and reputation", () => {
  const hired = freshState();
  hired.day = 8;
  hired.phase = "decision";
  hired.coins = 3000;
  const hiredEngine = createGameEngine(hired);
  const wageBefore = hiredEngine.getStaffCost();
  assert.equal(hiredEngine.chooseWeeklyDecision("hire").ok, true);
  assert.equal(hired.hiredCrew, 1);
  assert.equal(hiredEngine.getStaffCost(), wageBefore + 90);

  const acquired = freshState();
  acquired.day = 8;
  acquired.phase = "decision";
  acquired.coins = 3000;
  const engine = createGameEngine(acquired);
  const peopleBefore = getTonightGuests(acquired).length;
  const rentBefore = createLedger(acquired).rent + createLedger(acquired).acquisitionRent;
  assert.equal(engine.chooseWeeklyDecision("acquire").ok, true);
  assert.equal(getTonightGuests(acquired).length, peopleBefore + 1);
  assert.equal(createLedger(acquired).rent + createLedger(acquired).acquisitionRent, rentBefore + 38);
  assert.equal(acquired.fame, 43);
});

test("acquired stalls can be stocked, opened, upgraded, and staffed with a manager after reaching two operating locations", () => {
  const state = freshState();
  state.coins = 2600;
  postJournal(state, "測試開業注資", [{ account: "1000", debit: 1120 }, { account: "3000", credit: 1120 }]);
  state.day = 8;
  state.phase = "decision";
  const engine = createGameEngine(state);
  assert.equal(engine.chooseWeeklyDecision("acquire", "food").ok, true);
  const branch = state.outlets.find((outlet) => outlet.id === "acquired-1");
  assert.equal(branch.active, false);
  assert.equal(engine.buyOutletStock(branch.id, "chicken").ok, true);
  assert.equal(engine.buyOutletStock(branch.id, "chicken").ok, true);
  assert.equal(branch.stock.chicken, 2);
  assert.equal(engine.toggleOutlet(branch.id).ok, true);
  assert.equal(branch.active, true);
  assert.equal(engine.upgradeOutletEquipment(branch.id).ok, true);
  assert.equal(branch.equipmentLevel, 1);

  state.day = 15;
  state.phase = "decision";
  assert.equal(engine.hireOutletManager(branch.id).ok, true);
  assert.equal(branch.manager, true);
  assert.equal(state.phase, "prep");
  assert.equal(state.accounting.journal.some((entry) => entry.description.includes("店長")), true);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(branch.stock.chicken, 0);
  assert.equal(branch.lastResult.units, 2);
  assert.equal(branch.active, false);
  assert.equal(branch.autoPaused, true);
  assert.equal(state.ledger.sales >= DATA.economy.outletMealPrice * 2, true);
  assert.equal(state.ledger.managerPayroll, DATA.economy.managerWage);
  assert.equal(state.accounting.journal.some((entry) => entry.description.includes("熟食同業・分店 1")), true);
  assert.equal(state.accounting.balances["1000"], state.coins);
  state.phase = "prep";
  assert.equal(engine.dismissOutletManager(branch.id).ok, true);
  assert.equal(branch.manager, false);
  assert.equal(createLedger(state).managerPayroll, 0);
});

test("each acquired storefront sells its trade-specific product with its own price and stock", () => {
  const types = ["fish", "fruit", "sweet", "toy"];
  const products = types.map((type) => DATA.outletProducts[type]);
  assert.equal(new Set(products.map((product) => product.productName)).size, types.length);
  assert.equal(new Set(products.map((product) => product.stockId)).size, types.length);
  assert.equal(new Set(products.map((product) => product.price)).size, types.length);

  types.forEach((type) => {
    const product = DATA.outletProducts[type];
    const state = freshState();
    state.day = 8;
    state.phase = "decision";
    const engine = createGameEngine(state);
    assert.equal(engine.chooseWeeklyDecision("acquire", type).ok, true);
    const branch = state.outlets.find((outlet) => outlet.id === "acquired-1");
    assert.equal(branch.type, type);
    assert.equal(branch.stock[product.stockId], 0);
    const wrongStockId = product.stockId === "fish" ? "fruit" : "fish";
    assert.equal(engine.buyOutletStock(branch.id, wrongStockId).ok, false);
    const stocking = engine.buyOutletStock(branch.id, product.stockId);
    assert.equal(stocking.ok, true);
    assert.match(stocking.message, new RegExp(product.productName));
    assert.doesNotMatch(stocking.message, /undefined/i);
    assert.equal(state.accounting.journal.at(-1).description.includes(product.productName), true);
    assert.equal(engine.toggleOutlet(branch.id).ok, true);
    assert.equal(forecast(state).outletSales, product.price);
    assert.equal(engine.chooseMarketCard("self-check").ok, true);
    assert.equal(engine.openDoors().ok, true);
    assert.equal(branch.lastResult.units, 1);
    assert.equal(branch.lastResult.sales, product.price);
    assert.equal(branch.lastResult.food, product.cost);
    assert.equal(branch.stock[product.stockId], 0);
    assert.equal(branch.autoPaused, true);
    assert.equal(state.accounting.journal.some((entry) => entry.description.includes(product.productName)), true);
  });
});

test("different food storefronts count toward the same culinary alliance without sharing products", () => {
  const state = freshState();
  state.day = 8;
  state.phase = "decision";
  state.expansions = 1;
  state.acquisitions = 1;
  state.acquisitionTypes = ["fish"];
  const engine = createGameEngine(state);
  assert.equal(engine.chooseWeeklyDecision("acquire", "fruit").ok, true);
  assert.equal(hasBrandAlliance(state), true);
  assert.deepEqual(state.acquisitionTypes, ["fish", "fruit"]);
  assert.equal(state.outlets[1].type, "fruit");
  assert.notEqual(DATA.outletProducts.fish.stockId, DATA.outletProducts.fruit.stockId);
  state.campaignNet = 400;
  state.fame = 55;
  assert.equal(selectEnding(state), "night-market-alliance");
});

test("store managers surface weekly major decisions while keeping routine operations automated", () => {
  const state = freshState();
  const branch = {
    id: "acquired-1", name: "熟食同業・分店 1", type: "food", active: true, manager: true,
    equipmentLevel: 0, stock: { chicken: 0, seafood: 0, tea: 0, leisure: 0 },
    stockCost: { chicken: 42, seafood: 78, tea: 25, leisure: 32 }, nextNightBonus: 0,
    efficiencyPenalty: 0, reputation: 50, lastResult: null
  };
  state.acquisitions = 1;
  state.acquisitionTypes = ["food"];
  state.outlets.push(branch);
  state.day = 7;
  state.phase = "report";
  state.ledger = createLedger(state);
  state.reportChoice = "paperboat";
  const engine = createGameEngine(state);
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.day, 8);
  assert.equal(state.phase, "decision");
  assert.equal(state.managerEvent.type, "equipment");
  assert.equal(engine.chooseWeeklyDecision("hold").ok, false);
  assert.equal(engine.resolveManagerEvent("defer").ok, true);
  assert.equal(branch.efficiencyPenalty, 1);
  assert.equal(engine.chooseWeeklyDecision("hold").ok, true);
  assert.equal(engine.chooseMarketCard("self-check").ok, true);
  assert.equal(state.phase, "prep");
  assert.equal(engine.openDoors().ok, true);
  assert.equal(branch.lastResult.units, 0);
});

test("branch incidents expose their own world-map marker and follow-up state", () => {
  const state = freshState();
  const makeBranch = (id, name, extra = {}) => ({ id, name, type: "food", active: true, manager: false,
    equipmentLevel: 0, stock: {}, stockCost: {}, nextNightBonus: 0, efficiencyPenalty: 0,
    reputation: 50, autoPaused: false, lastResult: null, ...extra });
  state.outlets.push(
    makeBranch("acquired-1", "港口炸物・分店 1", { manager: true }),
    makeBranch("acquired-2", "山海果物・分店 2", { active: false, autoPaused: true }),
    makeBranch("acquired-3", "花生糖舖・分店 3", { efficiencyPenalty: 1 }),
    makeBranch("acquired-4", "彈珠小屋・分店 4", { nextNightBonus: 130 })
  );
  state.managerEvent = { outletId: "acquired-1", title: "設備開始異音", description: "店長回報。", choices: [] };
  const ui = createUI({ state, saveState() {} });
  const events = ui.getOutletWorldEvents();
  assert.equal(ui.getWorldEventInfo().anchorOutletId, "main", "market news stays with the main stall while branch events get their own pins");
  assert.deepEqual(events.map((event) => [event.kind, event.outletId]), [
    ["manager", "acquired-1"], ["stockout", "acquired-2"],
    ["equipment", "acquired-3"], ["bonus", "acquired-4"]
  ]);
  assert.match(events[1].description, /重新開店/);
  assert.match(events[2].description, /降載/);
  assert.match(events[3].description, /130/);
});

test("legacy acquisition counts migrate into individually manageable outlets", () => {
  const migrated = normalizeState({ acquisitions: 2, acquisitionTypes: ["food", "leisure"] });
  assert.equal(migrated.outlets.length, 3);
  assert.deepEqual(migrated.outlets.slice(1).map((outlet) => outlet.type), ["food", "leisure"]);
  assert.equal(migrated.outlets.slice(1).every((outlet) => !outlet.active && !outlet.manager), true);
});

test("inspection events charge for missing equipment and reward a prepared stall", () => {
  const unprepared = freshState();
  unprepared.day = 8;
  assert.equal(createLedger(unprepared).fees, 75);
  const fameBefore = unprepared.fame;
  const unpreparedEngine = createGameEngine(unprepared);
  assert.equal(unpreparedEngine.openDoors().ok, false);
  assert.equal(unpreparedEngine.chooseMarketCard("self-check").ok, true);
  assert.equal(unpreparedEngine.openDoors().ok, true);
  assert.equal(unprepared.fame, fameBefore - 2);

  const ready = freshState();
  ready.day = 8;
  ready.marketChoiceDay = 8;
  ready.marketCardChoice = "self-check";
  ready.equipment.hood = 1;
  assert.equal(createLedger(ready).fees, 0);
  assert.equal(createGameEngine(ready).openDoors().ok, true);
  assert.equal(ready.fame, 39);
});

test("ending rules represent successful and adverse business outcomes", () => {
  const thriving = freshState();
  thriving.fame = 80;
  thriving.regulars = 18;
  thriving.campaignNet = 900;
  assert.equal(selectEnding(thriving), "harbor-icon");
  const distressed = freshState();
  distressed.campaignNet = -300;
  assert.equal(selectEnding(distressed), "harbor-debt");
  const alliance = freshState();
  alliance.expansions = 1;
  alliance.acquisitions = 2;
  alliance.acquisitionTypes = ["food", "food"];
  alliance.campaignNet = 400;
  alliance.fame = 55;
  assert.equal(selectEnding(alliance), "night-market-alliance");
  alliance.loanPrincipal = 1;
  assert.equal(selectEnding(alliance), "harbor-debt");
  const choices = Object.values(ENDINGS).map((ending) => ending.tone);
  assert.ok(choices.includes("positive"));
  assert.ok(choices.includes("negative"));
});

test("DOM helpers, modular engine and scene renderers remain in place", async () => {
  const [ui, reports, preparation, scene, objects, effects, revenue, html, app, gameSource, audio, engine, branches, engineEvents] = await Promise.all([
    readFile(new URL("../dist/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/ui/reports.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/ui/preparation.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/objects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/effects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/revenue.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/app.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/game.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/audio.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/engine.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/engine/branches.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/engine/events.js", import.meta.url), "utf8")
  ]);
  assert.match(ui, /function el\(/);
  assert.match(ui, /function append\(/);
  assert.match(ui, /function fragment\(/);
  assert.match(app, /import \{ boot \} from "\.\/game\.js"/);
  assert.match(app, /boot\(\)/);
  assert.match(ui, /replaceChildren\(/);
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
  assert.match(ui, /createPreparationRenderer/);
  assert.match(preparation, /function renderStock\(/);
  assert.match(preparation, /function renderEquipment\(/);
  assert.match(preparation, /function renderStaff\(/);
  assert.match(engine, /createBranchActions/);
  assert.match(branches, /function simulateOutletOperations\(/);
  assert.match(engine, /createEventActions/);
  assert.match(engineEvents, /function resolveClosingSurprises\(/);
  assert.match(scene, /createObjectRenderer/);
  assert.match(scene, /createEffectRenderer/);
  assert.match(scene, /createRevenueRenderer/);
  assert.match(scene, /revenueRenderer\.draw\(time, paused \|\| motionReduced\)/);
  assert.match(objects, /drawStall/);
  assert.match(effects, /createEffectRenderer/);
  assert.match(revenue, /getRevenueBreakdown/);
  assert.match(revenue, /eventAnchor\(pulse\.outletId\)/);
  assert.match(html, /id="worldCanvas" tabindex="0"/);
  assert.match(html, /class="revenue-plaque cashbook-plaque" id="revenuePlaque"/);
  assert.match(html, /昨夜現金簿/);
  assert.match(html, /現金收入 <b id="revenueIncome">/);
  assert.match(html, /現金支出 <b id="revenueExpenses">/);
  assert.match(html, /id="revenueClose"[^>]*aria-label="關閉昨夜現金簿，下一夜會再次顯示"/);
  assert.match(html, /id="revenueLive" role="status" aria-live="polite"/);
  assert.match(html, /id="worldEventTrigger"[^>]*data-action="open-world-event"/);
  assert.match(html, /id="outletEventTriggers"/);
  assert.match(html, /data-action="toggle-camera-tools"[^>]*aria-expanded="false"[^>]*aria-controls="cameraTools"/);
  assert.match(html, /data-action="toggle-world-ui"[^>]*aria-pressed="false"/);
  assert.match(html, /class="eye-icon eye-visible"/);
  assert.match(html, /data-action="open-main-stock">◈ 店面備料/);
  assert.match(html, /data-action="toggle-sound"[^>]*aria-label="開啟夜市音景與音效"/);
  assert.match(gameSource, /createGameAudio/);
  assert.match(gameSource, /time - lastIdleDraw >= 100/);
  assert.match(gameSource, /if \(document\.hidden\) audio\.suspend\(\)/);
  assert.match(audio, /export function createGameAudio/);
  assert.match(html, /data-action="toggle-pause"[^>]*aria-label="暫停場景動畫"/);
  assert.match(html, /<dialog class="world-event-dialog" id="worldEventDialog"/);
  assert.match(html, /<dialog class="story-choice-dialog" id="storyChoiceDialog"/);
  assert.match(html, /<span class="guide-index">08｜收銀與宣傳事件<\/span>/);
  assert.match(html, /<span class="guide-index">09｜重啟<\/span>/);
  assert.match(html, /data-action="request-restart-campaign">重新開始遊戲<\/button>/);
  assert.match(html, /<dialog class="restart-confirm-dialog" id="restartConfirmDialog"/);
  assert.match(html, /data-action="confirm-restart-campaign">清空進度並重啟<\/button>/);
  assert.match(html, /此操作無法復原/);
  const worldFrameStart = html.indexOf('<section class="world-frame');
  const mainEnd = html.indexOf("</main>", worldFrameStart);
  const toastIndex = html.indexOf('id="toast"');
  assert.ok(worldFrameStart >= 0 && mainEnd > worldFrameStart && toastIndex > worldFrameStart && toastIndex < mainEnd);
  const css = await readStyles();
  const game = await readFile(new URL("../dist/game.js", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.revenue-plaque/);
  assert.match(css, /\.revenue-plaque\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.revenue-close[^\n]*width:\s*44px/);
  assert.match(game, /getDailyCashbookSummary\(state, Number\(state\.day\) - 1\)/);
  assert.match(game, /function syncCashbookHud\(/);
  assert.match(game, /state\.phase !== "prep" \|\| revenueDismissedDay === state\.day/);
  assert.match(game, /scene\.showRevenueNotice/);
  assert.match(css, /\.world-frame\.camera-collapsed \.camera-tools\s*\{\s*display:\s*none/);
  assert.match(css, /\.world-frame\.world-ui-hidden \.world-actions/);
  assert.match(scene, /motionReduced/);
  assert.match(game, /action === "toggle-camera-tools"/);
  assert.match(game, /action === "toggle-world-ui"/);
  assert.match(game, /action === "open-main-stock"\) \{ ui\.setTab\("stock"\)/);
  assert.match(game, /button\.querySelector\("#pauseIcon"\)/);
  assert.match(game, /orderModal\.addEventListener\("keydown"/);
  assert.match(game, /orderReturnFocus/);
  assert.match(reports, /function renderJournalReport\(/);
  assert.match(reports, /button\("", "open-report"/);
  assert.match(game, /reportDialog\.showModal\(\)/);
  assert.match(game, /reportDialog\.addEventListener\("close"/);
  assert.match(html, /<dialog class="report-dialog" id="reportDialog"/);
  assert.match(game, /function openStoryChoice\(/);
  assert.match(game, /else if \(state\.phase === "report"\) openStoryChoice\(\)/);
  assert.match(game, /storyChoiceDialog\.showModal\(\)/);
  assert.match(css, /\.toast\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.report-dialog\[open\]/);
  assert.match(css, /\.report-launch-grid/);
  assert.match(reports, /accounting-mobile-list/);
  assert.match(css, /\.accounting-mobile-record/);
  assert.match(ui, /function getWorldEventInfo\(/);
  assert.match(ui, /function renderWorldEventContent\(/);
  assert.match(scene, /function eventAnchor\(/);
  assert.match(scene, /function drawOutletEventBeacons\(/);
  assert.match(scene, /return \{ type: "outlet-event", outletId: eventHit\.outletId, kind: eventHit\.kind \}/);
  assert.match(game, /function openWorldEvent\(/);
  assert.match(game, /scene\.eventAnchor\(info\.anchorOutletId\)/);
  assert.match(game, /hit\.type === "outlet-event"/);
  assert.match(game, /button\.dataset\.action = "open-outlet-event"/);
  assert.match(ui, /function getOutletWorldEvents\(/);
  assert.match(game, /worldEventDialog\.addEventListener\("close"/);
  assert.match(css, /\.world-event-trigger:focus-visible/);
  assert.match(css, /\.world-event-trigger\[data-pending="true"\]/);
  assert.match(css, /\.outlet-event-trigger:focus-visible/);
  assert.match(css, /\.outlet-event-trigger[^\n]*min-height: 52px/);
});

test("weekly focus UI exposes compact progress and an accessible numeric status", () => {
  const priorDocument = globalThis.document;
  const makeNode = (tagName) => ({
    tagName, children: [], dataset: {}, attributes: {},
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  });
  globalThis.document = { createElement: makeNode, createDocumentFragment: () => makeNode("#fragment") };
  try {
    const state = freshState();
    state.weeklyFocus.progress = 4;
    const ui = createUI({ state, saveState() {} });
    const overview = ui.renderOverview();
    const find = (node, className) => {
      if (node.className === className) return node;
      for (const child of node.children || []) {
        const match = find(child, className);
        if (match) return match;
      }
      return null;
    };
    const card = find(overview, "weekly-focus");
    const progress = find(card, "weekly-focus-track");
    assert.ok(card);
    assert.equal(progress.attributes.role, "progressbar");
    assert.equal(progress.attributes["aria-valuemax"], "18");
    assert.equal(progress.attributes["aria-valuenow"], "4");
    assert.ok(find(card, "weekly-focus-copy"));
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test("extracted journal renderer builds DOM nodes for daily and monthly views", () => {
  const priorDocument = globalThis.document;
  const makeNode = (tagName) => ({
    tagName, children: [], dataset: {}, attributes: {},
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  });
  globalThis.document = {
    createElement: makeNode,
    createDocumentFragment: () => makeNode("#fragment")
  };
  try {
    const ui = createUI({ state: freshState(), saveState() { return true; } });
    const daily = ui.renderJournalReport();
    assert.equal(daily.children[0].children[0].textContent, "前一日・日記簿");
    ui.setJournalView("monthly");
    const monthly = ui.renderJournalReport();
    assert.equal(monthly.children[0].children[0].textContent, "每三十夜・綜合財務報表");
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test("tier upgrades unlock free main-store dishes, while each acquired trade gets its own tier specialty", () => {
  const state = freshState();
  state.coins = 10000;
  state.accounting.balances["1000"] = state.coins;
  state.equipment.fire = 1;
  state.equipment.hood = 1;
  state.equipment.awning = 1;
  state.equipment.cooler = 1;
  const engine = createGameEngine(state);
  assert.equal(engine.upgradeStallTier("main").ok, true);
  assert.ok(state.unlockedRecipes.includes("harbor-oyster-cake"));
  assert.equal(state.recipeLog.at(-1).acquisitionCost, 0);
  assert.equal(engine.selectDish(DATA.dishes.findIndex((dish) => dish.id === "pepper-seafood-pot")).ok, false);

  state.equipment.fire = 2;
  state.equipment.hood = 2;
  state.equipment.grill = 2;
  state.equipment.cooler = 2;
  state.expansions = 2;
  state.hiredCrew = 1;
  assert.equal(engine.upgradeStallTier("main").ok, true);
  assert.ok(state.unlockedRecipes.includes("pepper-seafood-pot"));
  assert.equal(state.recipeLog.at(-1).acquisitionCost, 0);

  const mobileFish = { id: "acquired-1", type: "fish", tier: "mobile", equipmentLevel: 0 };
  const fixedFish = { ...mobileFish, tier: "fixed" };
  const largeFish = { ...mobileFish, tier: "dapaidang" };
  assert.equal(getOutletSpecialty(mobileFish).name, "現炸海味拼盤");
  assert.equal(getOutletSpecialty(fixedFish).name, "港灣雙拼套餐");
  assert.equal(getOutletSpecialty(largeFish).name, "船長海味盛宴");
  assert.ok(outletRetailPrice(largeFish) > outletRetailPrice(fixedFish));
});

test("satisfied returning regulars may share a free hometown recipe that can be sold at its menu price", () => {
  const state = serviceState(3);
  state.recipeGoodVisits.aqin = 1;
  const engine = createGameEngine(state, { random: () => 0 });
  const discovery = engine.serveDish("pepper-soup");
  assert.equal(discovery.ok, true);
  assert.ok(state.unlockedRecipes.includes("ferry-chicken-rice"));
  assert.equal(state.recipeLog.at(-1).acquisitionCost, 0);
  assert.match(discovery.message, /家鄉食譜秘笈/);
  assert.equal(engine.serveDish("ferry-chicken-rice").ok, true);
  assert.equal(state.ledger.sales, 120 + 176);
});

test("save migration initializes recipe, incident, and claim fields without trusting unknown recipe ids", () => {
  const state = normalizeState({ day: 5, unlockedRecipes: ["pepper-soup", "injected-dish"], insuranceClaims: [{ amount: 40, status: "receivable" }] });
  assert.deepEqual(state.unlockedRecipes, ["pepper-soup", "tide-platter", "osmanthus-pear"]);
  assert.deepEqual(state.recalledDishIds, []);
  assert.equal(state.safetyIncident, null);
  assert.equal(state.insuranceClaims.length, 1);
});

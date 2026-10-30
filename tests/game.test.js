import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("new equipment purchases create asset records and straight-line depreciation entries", () => {
  const state = freshState();
  const engine = createGameEngine(state);
  assert.equal(engine.upgradeEquipment("grill").ok, true);
  assert.equal(state.accounting.assets.length, 1);
  assert.equal(state.accounting.assets[0].name, "銅火爐 Lv.1");
  assert.equal(state.accounting.assets[0].cost, 320);
  closeDepreciation(state, 31);
  assert.equal(state.accounting.assets[0].accumulatedDepreciation, 24);
  assert.equal(state.accounting.balances["5600"], 24);
  assert.equal(state.accounting.balances["1590"], -24);
  const imbalance = Object.values(state.accounting.balances).reduce((sum, value) => sum + value, 0);
  assert.equal(imbalance, 0);
});

test("invalid journal posts fail before changing balances, sequence, or journal", () => {
  const state = freshState();
  const before = JSON.parse(JSON.stringify(state.accounting));
  assert.throws(() => postJournal(state, "未知科目", [
    { account: "1000", debit: 25 },
    { account: "9999", credit: 25 }
  ]), /Unknown account 9999/);
  assert.deepEqual(state.accounting, before);
  assert.throws(() => postJournal(state, "借貸不平", [
    { account: "1000", debit: 25 },
    { account: "3000", credit: 24 }
  ]), /Unbalanced journal entry/);
  assert.deepEqual(state.accounting, before);
  assert.throws(() => postJournal(state, "同列雙邊", [
    { account: "1000", debit: 25, credit: 25 }
  ]), /cannot debit and credit/);
  assert.deepEqual(state.accounting, before);

  const entry = postJournal(state, "有效分錄", [
    { account: "1000", debit: 25 },
    { account: "3000", credit: 25 }
  ]);
  assert.equal(entry.id, "je-1");
  assert.equal(state.accounting.balances["1000"], before.balances["1000"] + 25);
  assert.equal(state.accounting.entrySequence, before.entrySequence + 1);
});

test("daily cashbook summarizes the previous day's actual cash receipts and payments", () => {
  const state = freshState();
  postJournal(state, "Opening balance", [{ account: "1000", debit: 900 }, { account: "3000", credit: 900 }], null, 0);
  postJournal(state, "Night sales", [{ account: "1000", debit: 420 }, { account: "4000", credit: 420 }], { category: "operating", amount: 420 }, 6);
  postJournal(state, "Night expense", [{ account: "5400", debit: 90 }, { account: "1000", credit: 90 }], { category: "operating", amount: -90 }, 6);
  postJournal(state, "Combined subsidy and operating close", [
    { account: "1000", debit: 60 }, { account: "4020", credit: 60 },
    { account: "5200", debit: 140 }, { account: "1000", credit: 140 }
  ], { category: "operating", amount: -80 }, 6);

  assert.deepEqual(getDailyCashbookSummary(state, 6), {
    day: 6, income: 480, expenses: 230, net: 250, available: true, entryCount: 3
  });
  assert.deepEqual(getDailyCashbookSummary(state, 5), {
    day: 5, income: 0, expenses: 0, net: 0, available: false, entryCount: 0
  });
});

test("cash and working-capital balances stay aligned across borrow, close, and repayment", () => {
  const state = freshState();
  state.phase = "decision";
  state.day = 8;
  const engine = createGameEngine(state);
  assert.equal(engine.borrowWorkingCapital().ok, true);
  assert.equal(state.accounting.balances["1000"], state.coins);
  assert.equal(state.accounting.balances["2100"], -state.loanPrincipal);

  state.phase = "prep";
  state.day = 9;
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.accounting.balances["1000"], state.coins);
  assert.equal(state.accounting.balances["2100"], -state.loanPrincipal);

  state.phase = "decision";
  state.day = 15;
  assert.equal(engine.repayWorkingCapital().ok, true);
  assert.equal(state.accounting.balances["1000"], state.coins);
  assert.equal(Math.abs(state.accounting.balances["2100"]), state.loanPrincipal);
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

test("market-card decisions survive save/load and are written into the campaign journal", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = freshState();
  state.day = 4;
  const engine = createGameEngine(state);
  assert.equal(engine.chooseMarketCard("claim").ok, true);
  saveState(state, storage);
  const restored = loadState(storage);
  assert.equal(restored.marketCardChoice, "claim");
  assert.equal(createGameEngine(restored).openDoors().ok, true);
  restored.phase = "report";
  restored.reportChoice = "paperboat";
  restored.ledger = createLedger(restored);
  assert.equal(createGameEngine(restored).nextNight().ok, true);
  assert.equal(restored.journal[0].marketCard, "雨天能源補助");
  assert.equal(restored.journal[0].marketChoice, "申請補助");
});

test("rain subsidy is recorded as income while hygiene choice can avoid an inspection fee", () => {
  const rainy = freshState();
  rainy.day = 4;
  const rainyEngine = createGameEngine(rainy);
  assert.equal(rainyEngine.chooseMarketCard("claim").ok, true);
  const before = rainy.coins;
  assert.equal(createLedger(rainy).subsidies, DATA.economy.rainSubsidy);
  assert.equal(rainyEngine.openDoors().ok, true);
  assert.equal(rainy.coins, before - fixedOperatingCost(rainy.ledger) + DATA.economy.rainSubsidy);
  assert.equal(ledgerIncome(rainy.ledger), DATA.economy.rainSubsidy);
  assert.equal(ledgerNet(rainy.ledger), DATA.economy.rainSubsidy - fixedOperatingCost(rainy.ledger));

  const audited = freshState();
  audited.day = 8;
  const auditEngine = createGameEngine(audited);
  assert.equal(auditEngine.chooseMarketCard("deep-clean").ok, true);
  assert.equal(createLedger(audited).preparation, DATA.economy.hygieneQuickCleanCost);
  assert.equal(createLedger(audited).fees, 0);
  assert.equal(auditEngine.openDoors().ok, true);
});

test("marketing announcements charge the selected placement and apply a seeded outcome", () => {
  assert.equal(marketCardForDay(6).id, "media-interview");
  assert.equal(marketCardForDay(17).id, "celebrity-visit");
  assert.equal(marketCardForDay(27).id, "paid-promotion");
  assert.equal(MARKET_CARDS["paid-promotion"].choices.find((choice) => choice.id === "buy-placement").cost,
    DATA.economy.productPlacementCost);
  assert.deepEqual([MARKET_CARD_SCHEDULE[6], MARKET_CARD_SCHEDULE[17], MARKET_CARD_SCHEDULE[27]],
    ["media-interview", "celebrity-visit", "paid-promotion"]);

  const state = freshState();
  state.day = 27;
  const rolls = [0.9, 0.99, 0.99, 0.99];
  const engine = createGameEngine(state, { random: () => rolls.shift() ?? 0.99 });
  const cashBefore = state.coins;
  assert.equal(engine.chooseMarketCard("buy-placement").ok, true);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.coins, cashBefore - fixedOperatingCost(state.ledger));
  assert.equal(state.ledger.marketing, DATA.economy.productPlacementCost);
  assert.equal(state.accounting.journal.some((entry) =>
    entry.lines.some((line) => line.account === "5410" && line.debit === DATA.economy.productPlacementCost)), true);
  assert.equal(state.marketCardOutcome.cardId, "paid-promotion");
  assert.equal(state.marketCardOutcome.guestBonus, 3);
  assert.equal(state.marketCardOutcome.fameChange, 4);
  assert.equal(getTonightGuests(state).length, 7);
});

test("counterfeit and undercharged add-ons become cash shortfall losses", () => {
  for (const scenario of [
    { chance: 0.01, amount: 80, kind: "counterfeit", account: "5510" },
    { chance: 0.06, amount: 35, kind: "undercharge", account: "5510" }
  ]) {
    const state = freshState();
    state.phase = "report";
    state.reportChoice = "paperboat";
    state.ledger = createLedger(state);
    const rolls = [scenario.chance, 0.01, 0.99, 0.99];
    const engine = createGameEngine(state, { random: () => rolls.shift() ?? 0.99 });
    const cashBefore = state.coins;
    assert.equal(engine.nextNight().ok, true);
    assert.equal(state.coins, cashBefore - scenario.amount);
    assert.equal(state.journal[0].closingEvents[0].kind, scenario.kind);
    assert.equal(state.ledger, null);
    const variance = state.accounting.journal.find((entry) => entry.description.startsWith("現金短溢｜"));
    assert.ok(variance);
    assert.equal(variance.lines.some((line) => line.account === scenario.account && line.debit === scenario.amount), true);
    assert.equal(variance.lines.some((line) => line.account === "1000" && line.credit === scenario.amount), true);
  }
});

test("unidentified cash overage is income; identifiable customer overcharge is refunded as a sales allowance", () => {
  const overage = freshState();
  overage.phase = "report";
  overage.reportChoice = "paperboat";
  overage.ledger = createLedger(overage);
  const overageRolls = [0.10, 0.01, 0.99, 0.99];
  const overageEngine = createGameEngine(overage, { random: () => overageRolls.shift() ?? 0.99 });
  const cashBefore = overage.coins;
  assert.equal(overageEngine.nextNight().ok, true);
  assert.equal(overage.coins, cashBefore + 20);
  assert.equal(overage.journal[0].closingEvents[0].kind, "cash-over");
  const gain = overage.accounting.journal.find((entry) => entry.description.includes("未能辨認來源的溢收"));
  assert.equal(gain.lines.some((line) => line.account === "4040" && line.credit === 20), true);

  const refund = freshState();
  refund.phase = "report";
  refund.reportChoice = "paperboat";
  refund.ledger = createLedger(refund);
  const refundRolls = [0.12, 0.01, 0.99, 0.99];
  const refundEngine = createGameEngine(refund, { random: () => refundRolls.shift() ?? 0.99 });
  const refundCashBefore = refund.coins;
  assert.equal(refundEngine.nextNight().ok, true);
  assert.equal(refund.coins, refundCashBefore);
  assert.equal(refund.journal[0].closingEvents[0].kind, "customer-overcharge");
  assert.equal(refund.accounting.journal.some((entry) => entry.description === "客訴退款／銷貨折讓" &&
    entry.lines.some((line) => line.account === "4090" && line.debit === 40)), true);
});

test("secret shopper and hygiene inspection produce balanced reputation and accounting outcomes", () => {
  const shopper = freshState();
  shopper.phase = "report";
  shopper.reportChoice = "paperboat";
  shopper.ledger = createLedger(shopper);
  const shopperRolls = [0.5, 0.01, 0.01, 0.99];
  assert.equal(createGameEngine(shopper, { random: () => shopperRolls.shift() ?? 0.99 }).nextNight().ok, true);
  assert.equal(shopper.journal[0].closingEvents.some((event) => event.kind === "secret-shopper" && event.outcome === "positive"), true);
  assert.equal(shopper.fame, 41);

  const inspector = freshState();
  inspector.phase = "report";
  inspector.reportChoice = "paperboat";
  inspector.ledger = createLedger(inspector);
  const inspectionRolls = [0.5, 0.99, 0.01, 0.01];
  const inspectorEngine = createGameEngine(inspector, { random: () => inspectionRolls.shift() ?? 0.99 });
  const cashBefore = inspector.coins;
  assert.equal(inspectorEngine.nextNight().ok, true);
  assert.equal(inspector.coins, cashBefore + 50);
  assert.equal(inspector.journal[0].closingEvents.some((event) => event.kind === "secret-inspection" && event.outcome === "pass"), true);
  assert.equal(inspector.accounting.journal.some((entry) => entry.description === "秘密衛生稽查通過獎勵" &&
    entry.lines.some((line) => line.account === "4020" && line.credit === 50)), true);
});

test("negative secret shopper and failed hygiene inspection apply their distinct adjustments", () => {
  const shopper = freshState();
  shopper.phase = "report";
  shopper.reportChoice = "paperboat";
  shopper.ledger = createLedger(shopper);
  const shopperRolls = [0.5, 0.01, 0.99, 0.99];
  assert.equal(createGameEngine(shopper, { random: () => shopperRolls.shift() ?? 0.99 }).nextNight().ok, true);
  assert.equal(shopper.journal[0].closingEvents.some((event) => event.kind === "secret-shopper" && event.outcome === "negative"), true);
  assert.equal(shopper.fame, 36);

  const inspector = freshState();
  inspector.phase = "report";
  inspector.reportChoice = "paperboat";
  inspector.ledger = createLedger(inspector);
  const inspectionRolls = [0.5, 0.99, 0.01, 0.99];
  const engine = createGameEngine(inspector, { random: () => inspectionRolls.shift() ?? 0.99 });
  const cashBefore = inspector.coins;
  assert.equal(engine.nextNight().ok, true);
  assert.equal(inspector.coins, cashBefore - 85);
  assert.equal(inspector.fame, 36);
  assert.equal(inspector.journal[0].closingEvents.some((event) => event.kind === "secret-inspection" && event.outcome === "fail"), true);
  assert.equal(inspector.accounting.journal.some((entry) => entry.description.includes("限期改善罰款") &&
    entry.lines.some((line) => line.account === "5400" && line.debit === 85)), true);
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

test("weekly focus maps strategic choices to bounded, save-safe objectives", () => {
  assert.equal(getWeeklyFocusIdForDecision("expand"), "expand");
  assert.equal(getWeeklyFocusIdForDecision("hire"), "hire");
  assert.equal(getWeeklyFocusIdForDecision("acquire"), "acquire");
  assert.equal(getWeeklyFocusIdForDecision("hold"), "hold");
  assert.equal(getLegacyWeeklyFocus(8, []), null, "legacy saves wait for a decision at the new-week boundary");
  assert.equal(getLegacyWeeklyFocus(10, [{ day: 8, id: "expand" }]).id, "expand");
  assert.equal(normalizeWeeklyFocus({ id: "unknown", target: 999 }), null);
  assert.equal(normalizeWeeklyFocus({ id: "hire", target: 999, progress: 999 }).target, WEEKLY_FOCUSES.hire.target);
});

test("weekly focus progress only counts matching activities and resolves without a failure penalty", () => {
  const focus = createWeeklyFocus("hire", 8);
  recordWeeklyFocusProgress(focus, "served");
  assert.equal(focus.progress, 0);
  recordWeeklyFocusProgress(focus, "good-service");
  assert.equal(focus.progress, 1);
  focus.progress = focus.target;
  const result = resolveWeeklyFocus(focus, { closingDay: 14, coins: 900, loanTakenDay: 0 });
  assert.equal(result.success, true);
  assert.equal(result.resolvedDay, 14);
  assert.match(result.message, /口碑 \+2/);

  const missed = createWeeklyFocus("hold", 15);
  missed.progress = missed.target;
  const failed = resolveWeeklyFocus(missed, { closingDay: 21, coins: 900, loanTakenDay: 15 });
  assert.equal(failed.success, false, "borrowing during the focus week blocks the no-new-loan goal");
  assert.match(failed.message, /沒有額外扣款/);
});

test("weekly focus closes into the diary and worksheet, rewarding completion only", () => {
  const state = serviceState(7);
  state.phase = "report";
  state.reportChoice = "paperboat";
  state.weeklyFocus = createWeeklyFocus("opening", 1);
  state.weeklyFocus.progress = state.weeklyFocus.target;
  const beforeFame = state.fame;
  const beforeRegulars = state.regulars;
  const engine = createGameEngine(state, { random: () => 1 });
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.weeklyFocus.result.success, true);
  assert.equal(state.journal[0].weeklyFocus.success, true);
  assert.equal(state.accounting.weeklyReports.at(-1).weeklyFocus.success, true);
  assert.equal(state.fame, beforeFame + 2);
  assert.equal(state.regulars, beforeRegulars + 1);
  assert.match(state.journal[0].weeklyFocus.message, /口碑 \+2/);
});

test("engine backfills a missing legacy focus when the current week is already underway", () => {
  const state = freshState();
  state.day = 7;
  delete state.weeklyFocus;
  createGameEngine(state);
  assert.equal(state.weeklyFocus.id, "opening");
  assert.equal(state.weeklyFocus.startDay, 7);
  assert.equal(state.weeklyFocus.target, 3);

  const boundary = freshState();
  boundary.day = 8;
  boundary.phase = "decision";
  delete boundary.weeklyFocus;
  createGameEngine(boundary);
  assert.equal(boundary.weeklyFocus, null, "a legacy save at a decision prompt waits for the chosen direction");
});

test("schema-five saves migrate into the current week's decision-matched focus", () => {
  const migrated = normalizeState({ schemaVersion: 5, day: 10, decisions: [{ day: 8, id: "expand" }] });
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.deepEqual(migrated.weeklyFocus, {
    id: "expand", startDay: 10, progress: 0, target: 18, resolved: false, success: false, result: null
  });
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

test("weekly decisions change guest capacity, recurring costs, and lead into the next prep phase", () => {
  const state = serviceState(7);
  state.phase = "report";
  state.reportChoice = "paperboat";
  const engine = createGameEngine(state);
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.day, 8);
  assert.equal(state.phase, "decision");
  const guestsBefore = getTonightGuests(state).length;
  const rentBefore = createLedger(state).rent + createLedger(state).expansionRent;
  const fundsBefore = state.coins;
  assert.equal(engine.chooseWeeklyDecision("expand").ok, true);
  assert.equal(state.phase, "prep");
  assert.equal(state.expansions, 1);
  assert.equal(getTonightGuests(state).length, guestsBefore + 1);
  assert.equal(createLedger(state).rent + createLedger(state).expansionRent, rentBefore + 24);
  assert.equal(state.coins, fundsBefore - 460);
  assert.equal(state.weeklyFocus.id, "expand");
  assert.equal(state.weeklyFocus.progress, 0);
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

test("the world continues across many 30-night periods and produces weekly and monthly statements", () => {
  const state = freshState();
  const engine = createGameEngine(state);
  let finishedNights = 0;
  while (finishedNights < 217) {
    if (state.phase === "decision") {
      assert.equal(engine.chooseWeeklyDecision("hold").ok, true);
      continue;
    }
    const card = todayMarketCard(state);
    if (card) {
      const freeChoice = card.choices.find((choice) => choice.cost === 0);
      assert.ok(freeChoice);
      assert.equal(engine.chooseMarketCard(freeChoice.id).ok, true);
    }
    assert.equal(engine.openDoors().ok, true);
    state.phase = "report";
    state.reportChoice = "paperboat";
    assert.equal(engine.nextNight().ok, true);
    finishedNights += 1;
  }
  assert.equal(state.day, 218);
  assert.equal(state.phase, "decision");
  assert.equal(state.journal.length, 30);
  assert.equal(state.accounting.monthlyReports.length, 7);
  assert.equal(state.accounting.monthlyReports[0].period, 1);
  assert.ok(state.accounting.monthlyReports.every((report) =>
    report.financialPosition.balanced && report.cashFlow.reconciles && report.outcome?.title));
  assert.deepEqual(state.accounting.weeklyReports.map((report) => report.endDay).slice(-4), [196, 203, 210, 217]);
  assert.ok(state.accounting.weeklyReports.every((report) => report.balanced));
  assert.ok(state.accounting.weeklyReports.find((report) => report.endDay === 210).balanced);
  assert.ok(CHART_OF_ACCOUNTS.some((account) => account.name === "租金及攤位使用費"));
  assert.ok(state.accounting.journal.every((entry) =>
    entry.lines.reduce((sum, line) => sum + line.debit, 0) === entry.lines.reduce((sum, line) => sum + line.credit, 0)));
  assert.equal(state.accounting.balances["4000"] + state.accounting.balances["4090"], 0,
    "a discovered overcharge is fully offset by its sales allowance until period close");
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

test("DOM helpers, sound layer, and split scene renderers remain in place", async () => {
  const [ui, reports, scene, objects, effects, revenue, html, app, gameSource, audio] = await Promise.all([
    readFile(new URL("../dist/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/ui/reports.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/objects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/effects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/revenue.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/app.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/game.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/audio.js", import.meta.url), "utf8")
  ]);
  assert.match(ui, /function el\(/);
  assert.match(ui, /function append\(/);
  assert.match(ui, /function fragment\(/);
  assert.match(app, /import \{ boot \} from "\.\/game\.js"/);
  assert.match(app, /boot\(\)/);
  assert.match(ui, /replaceChildren\(/);
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
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
  const css = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
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

test("insurance premiums are charged only on the first night of each 30-night period", () => {
  assert.equal(isInsuranceBillingDay(1), true);
  assert.equal(isInsuranceBillingDay(30), false);
  assert.equal(isInsuranceBillingDay(31), true);
  assert.equal(isInsuranceBillingDay(61), true);
  assert.equal(isInsuranceBillingDay(0), false);

  const state = freshState();
  const main = state.outlets[0];
  main.tier = "dapaidang";
  state.equipment.fire = 2;
  state.equipment.hood = 2;
  state.equipment.grill = 2;
  state.equipment.cooler = 2;
  state.expansions = 2;
  state.hiredCrew = 1;
  const firstNight = createLedger(state);
  assert.equal(firstNight.insuranceAccident, 3 * INSURANCE_RATES.accidentPerEmployee);
  assert.equal(firstNight.insuranceLabor, 3 * INSURANCE_RATES.laborPerEmployee);
  assert.equal(firstNight.insuranceHealth, 3 * INSURANCE_RATES.healthPerEmployee);
  assert.equal(firstNight.insuranceProduct, INSURANCE_RATES.productLiabilityPerFoodOutlet);
  assert.equal(firstNight.insurancePublic, INSURANCE_RATES.publicLiabilityPerOutlet);

  state.day = 2;
  const ordinaryNight = createLedger(state);
  assert.equal(ordinaryNight.insuranceAccident + ordinaryNight.insuranceLabor + ordinaryNight.insuranceHealth + ordinaryNight.insuranceProduct + ordinaryNight.insurancePublic, 0);
  state.day = 31;
  assert.equal(createLedger(state).insuranceAccident, firstNight.insuranceAccident);
});

test("stall tier progression is gated by safety equipment and capitalizes the improvements", () => {
  const state = freshState();
  state.coins = 5000;
  const engine = createGameEngine(state);
  const blocked = engine.upgradeStallTier("main");
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /瓦斯遮斷/);

  state.equipment.fire = 1;
  state.equipment.hood = 1;
  state.equipment.awning = 1;
  state.equipment.cooler = 1;
  assert.equal(engine.upgradeStallTier("main").ok, true);
  assert.equal(state.outlets[0].tier, "fixed");
  assert.equal(state.accounting.assets.at(-1).name, "夜嵐攤號｜固定攤販整修");

  state.equipment.fire = 2;
  state.equipment.hood = 2;
  state.equipment.grill = 2;
  state.equipment.cooler = 2;
  state.expansions = 2;
  state.hiredCrew = 1;
  assert.equal(engine.upgradeStallTier("main").ok, true);
  assert.equal(state.outlets[0].tier, "dapaidang");
  assert.ok(state.accounting.assets.some((asset) => asset.name === "夜嵐攤號｜大排檔整修"));
});

test("employee departure records an orphan-policy receivable adjustment at period end and collects it next period", () => {
  const state = freshState();
  state.coins = 5000;
  state.accounting.balances["1000"] = state.coins;
  state.hiredCrew = 2;
  const main = state.outlets[0];
  main.tier = "dapaidang";
  state.equipment.fire = 2;
  state.equipment.hood = 2;
  state.equipment.grill = 2;
  state.equipment.cooler = 2;
  state.expansions = 2;
  const engine = createGameEngine(state);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.accounting.balances["5450"], 4 * INSURANCE_RATES.accidentPerEmployee);
  assert.equal(state.accounting.balances["5460"], 4 * INSURANCE_RATES.laborPerEmployee);
  assert.equal(state.accounting.balances["5461"], 4 * INSURANCE_RATES.healthPerEmployee);

  state.day = 15;
  state.phase = "prep";
  const departure = engine.releaseCrewMember();
  assert.equal(departure.ok, true);
  assert.equal(state.hiredCrew, 1);
  const policy = state.orphanPolicies[0];
  assert.equal(policy.status, "pending-adjustment");
  assert.equal(policy.remainingDays, 15);
  assert.equal(policy.refundAmount, Math.round((INSURANCE_RATES.accidentPerEmployee + INSURANCE_RATES.laborPerEmployee + INSURANCE_RATES.healthPerEmployee) / 2));

  state.day = 30;
  state.phase = "report";
  state.reportChoice = "paperboat";
  state.ledger = createLedger(state);
  assert.equal(engine.nextNight().ok, true);
  assert.equal(policy.status, "receivable");
  assert.equal(state.accounting.balances["1200"], policy.refundAmount);
  assert.equal(state.accounting.monthlyReports[0].financialPosition.assets.insuranceReceivables, policy.refundAmount);
  assert.equal(state.accounting.monthEndWorksheets[0].insuranceAdjustment.amount, policy.refundAmount);
  assert.equal(state.accounting.monthEndWorksheets[0].balanced, true);

  assert.equal(state.day, 31);
  assert.equal(createLedger(state).insuranceRecovery, policy.refundAmount);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(policy.status, "collected");
  assert.equal(state.accounting.balances["1200"], 0);
  assert.equal(state.accounting.balances["1000"], state.coins);
});

test("insured workplace accidents pause service, book treatment and receivable, then collect two nights later", () => {
  const state = freshState();
  state.outlets[0].accidentCoverage = true;
  const engine = createGameEngine(state, { random: () => 0 });
  const card = todayMarketCard(state);
  if (card) assert.equal(engine.chooseMarketCard(card.choices[0].id).ok, true);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.safetyIncident.id, "knife-cut");
  assert.equal(state.safetyIncident.status, "pending");
  assert.equal(engine.serveDish("pepper-soup").ok, false);

  const cashAfterOpening = state.coins;
  const handled = engine.resolveSafetyIncident("claim");
  assert.equal(handled.ok, true);
  assert.equal(state.coins, cashAfterOpening - state.safetyIncident.expense);
  assert.equal(state.ledger.safetyCosts, DATA.safetyIncidents.find((item) => item.id === "knife-cut").expense);
  assert.equal(state.ledger.insuranceClaimRevenue, 58);
  assert.equal(state.accounting.balances["1210"], 58);
  assert.equal(state.accounting.balances["4030"], -58);
  assert.equal(state.accounting.balances["5520"], 72);
  assert.equal(state.insuranceClaims[0].status, "receivable");

  state.day = 3;
  state.phase = "prep";
  state.ledger = null;
  const nextCard = todayMarketCard(state);
  if (nextCard) engine.chooseMarketCard(nextCard.choices[0].id);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.insuranceClaims[0].status, "collected");
  assert.equal(state.ledger.insuranceClaimReceipts, 58);
  assert.equal(state.accounting.balances["1210"], 0);
  assert.equal(state.accounting.balances["1000"], state.coins);
});

test("fixed food outlet contamination recalls the affected dish and records a product claim", () => {
  const values = [0, 0.76, 0];
  let cursor = 0;
  const state = freshState();
  state.outlets[0].tier = "fixed";
  state.equipment.fire = 1;
  state.equipment.hood = 1;
  state.equipment.awning = 1;
  state.equipment.cooler = 1;
  const engine = createGameEngine(state, { random: () => values[cursor++] ?? 0 });
  const card = todayMarketCard(state);
  if (card) engine.chooseMarketCard(card.choices[0].id);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.safetyIncident.id, "food-hair");
  assert.equal(state.insuranceSnapshot.outlets[0].covered.product, true);
  assert.equal(engine.resolveSafetyIncident("claim").ok, true);
  assert.equal(state.recalledDishIds.length, 1);
  assert.equal(state.accounting.balances["5540"], 124);
  assert.equal(state.accounting.balances["1210"], 96);
  assert.equal(engine.serveDish(state.recalledDishIds[0]).ok, false);
});

test("suspected norovirus stops service, lowers reputation and regulars, and leaves a product claim receivable", () => {
  const values = [0, 0.99, 0];
  let cursor = 0;
  const state = freshState();
  state.outlets[0].tier = "fixed";
  state.equipment.fire = 1;
  state.equipment.hood = 1;
  state.equipment.awning = 1;
  state.equipment.cooler = 1;
  const engine = createGameEngine(state, { random: () => values[cursor++] ?? 0 });
  const card = todayMarketCard(state);
  if (card) engine.chooseMarketCard(card.choices[0].id);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(state.safetyIncident.id, "norovirus");
  assert.equal(engine.resolveSafetyIncident("claim").ok, true);
  assert.equal(state.phase, "report");
  assert.equal(state.fame, 26);
  assert.equal(state.regulars, 5);
  assert.equal(state.outbreakRecoveryUntilDay, 3);
  assert.equal(state.accounting.balances["1210"], 320);
  assert.equal(state.accounting.balances["5540"], 420);
  state.day = 30;
  state.reportChoice = "paperboat";
  assert.equal(engine.nextNight().ok, true);
  assert.equal(state.accounting.monthlyReports[0].financialPosition.assets.insuranceClaimReceivables, 320);
  assert.equal(state.accounting.monthlyReports[0].financialPosition.balanced, true);
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

test("achievement catalogue is thematic, bounded, and never changes the economy", async () => {
  assert.equal(ACHIEVEMENTS.length, 26);
  assert.deepEqual(ACHIEVEMENT_CATEGORIES.map((item) => item.id), ["all", "growth", "operations", "risk", "branches", "menu", "story", "accounting"]);
  assert.ok(ACHIEVEMENTS.every((item) => item.id && item.title && item.description && item.hint && !("reward" in item)));
  const css = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /id="achievementTrigger"[^>]*data-action="open-achievements"/);
  assert.match(html, /<dialog class="achievement-dialog" id="achievementsDialog"/);
  assert.match(css, /\.achievement-card\.is-unlocked/);
  assert.match(css, /\.achievement-card\.is-locked\s*\{[^}]*filter:\s*grayscale\(1\)/);
});

test("achievement state normalization filters unknown ids and legacy backfill is silent", () => {
  const normalized = normalizeAchievementState({
    unlocked: { first_open: { day: 8, period: 1 }, injected: { day: 1 } },
    pending: ["first_open", "injected"], viewedStatements: ["income", "forged"]
  });
  assert.deepEqual(normalized.unlocked, { first_open: { day: 8, period: 1 } });
  assert.deepEqual(normalized.pending, ["first_open"]);
  assert.deepEqual(normalized.viewedStatements, ["income"]);

  const migrated = normalizeState({ schemaVersion: 3, day: 2, phase: "service", results: [] });
  const awards = evaluateAchievements(migrated, { silent: true });
  assert.deepEqual(awards, []);
  assert.deepEqual(migrated.achievements.unlocked.first_open, { day: 0, period: 0 });
  assert.deepEqual(migrated.achievements.pending, []);
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
});

test("first successful opening records a milestone without granting money", () => {
  const state = freshState();
  const engine = createGameEngine(state, { random: () => 0.999 });
  const startingCash = state.coins;
  assert.equal(engine.openDoors().ok, true);
  assert.deepEqual(state.achievements.unlocked.first_open, { day: 1, period: 1 });
  assert.deepEqual(engine.drainAchievementAwards(), ["first_open"]);
  assert.equal(state.coins, startingCash - fixedOperatingCost(state.ledger));
});

test("period achievements record the actual close night rather than the next night", () => {
  const state = freshState();
  state.day = 31;
  state.accounting.monthlyReports.push({ period: 1, endDay: 30, outcomeId: "harbor-icon", totals: { profit: 40 } });
  evaluateAchievements(state);
  assert.deepEqual(state.achievements.unlocked.period_close, { day: 30, period: 1 });
  assert.deepEqual(state.achievements.unlocked.positive_period, { day: 30, period: 1 });
  assert.deepEqual(state.achievements.unlocked.harbor_icon, { day: 30, period: 1 });
});

test("journal and statement reading achievements persist, while restarting clears them and pending awards", () => {
  const state = freshState();
  const engine = createGameEngine(state);
  engine.markJournalViewed();
  assert.deepEqual(engine.drainAchievementAwards(), ["read_journal"]);
  state.accounting.monthlyReports.push({ id: "period-1", totals: { profit: 10 } });
  evaluateAchievements(state, { silent: true });
  for (const id of ["income", "equity", "position", "cashflow"]) engine.markStatementViewed(id);
  assert.deepEqual(engine.drainAchievementAwards(), ["read_statements"]);
  assert.equal(state.achievements.viewedStatements.length, 4);
  assert.equal(engine.openDoors().ok, true);
  assert.equal(engine.restartCampaign().ok, true);
  assert.deepEqual(state.achievements.unlocked, {});
  assert.deepEqual(state.achievements.pending, []);
  assert.deepEqual(engine.drainAchievementAwards(), []);
});

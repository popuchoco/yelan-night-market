import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DATA, getOutletSpecialty, outletRetailPrice } from "../dist/data.js";
import { CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, ENDINGS, WEEKLY_DECISION_DAYS, campaignCycleDay, campaignEntry, selectEnding } from "../dist/campaign.js";
import { closeDepreciation, CHART_OF_ACCOUNTS, postJournal } from "../dist/accounting.js";
import { boot, createGameEngine } from "../dist/game.js";
import { createUI } from "../dist/ui.js";
import { applyCameraAction } from "../dist/scene.js";
import { getStallVisualProfile } from "../dist/scene/objects.js";
import { INSURANCE_RATES, isInsuranceBillingDay } from "../dist/safety.js";
import {
  createLedger, fixedOperatingCost, forecast, freshState, getPurchasePrice, getTonightGuests, hasBrandAlliance,
  captureStateSnapshot, loadState, loadStateResult, normalizeState, restoreStateSnapshot,
  saveState, saveStateResult, clearSavedProgress, SAVE_SCHEMA_VERSION,
  todayEvent, todayMarketCard, ledgerIncome, ledgerNet
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
    assert.equal(engine.buyOutletStock(branch.id, product.stockId).ok, true);
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
  assert.equal(state.accounting.balances["4000"], 0);
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

test("DOM helpers and split scene renderers remain in place without HTML injection", async () => {
  const [ui, reports, scene, objects, effects, html, app] = await Promise.all([
    readFile(new URL("../dist/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/ui/reports.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/objects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/effects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/app.js", import.meta.url), "utf8")
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
  assert.match(objects, /drawStall/);
  assert.match(effects, /createEffectRenderer/);
  assert.match(html, /id="worldCanvas" tabindex="0"/);
  assert.match(html, /id="worldEventTrigger"[^>]*data-action="open-world-event"/);
  assert.match(html, /id="outletEventTriggers"/);
  assert.match(html, /data-action="toggle-camera-tools"[^>]*aria-expanded="false"[^>]*aria-controls="cameraTools"/);
  assert.match(html, /data-action="toggle-world-ui"[^>]*aria-pressed="false"/);
  assert.match(html, /class="eye-icon eye-visible"/);
  assert.match(html, /data-action="open-main-stock">◈ 店面備料/);
  assert.match(html, /data-action="toggle-sound"[^>]*aria-label="開啟音效"/);
  assert.match(html, /data-action="toggle-pause"[^>]*aria-label="暫停場景動畫"/);
  assert.match(html, /<dialog class="world-event-dialog" id="worldEventDialog"/);
  assert.match(html, /<dialog class="story-choice-dialog" id="storyChoiceDialog"/);
  assert.match(html, /<span class="guide-index">08｜重啟<\/span>/);
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
  assert.equal(state.accounting.assets.at(-1).name, "夜嵐攤號｜固定攤販改建");

  state.equipment.fire = 2;
  state.equipment.hood = 2;
  state.equipment.grill = 2;
  state.equipment.cooler = 2;
  state.expansions = 2;
  state.hiredCrew = 1;
  assert.equal(engine.upgradeStallTier("main").ok, true);
  assert.equal(state.outlets[0].tier, "dapaidang");
  assert.ok(state.accounting.assets.some((asset) => asset.name === "夜嵐攤號｜大排檔改建"));
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

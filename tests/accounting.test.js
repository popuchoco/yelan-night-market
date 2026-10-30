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

import test from "node:test";
import assert from "node:assert/strict";
import { DATA, getOutletProduct } from "../dist/data.js";
import { createGameEngine } from "../dist/engine.js";
import { freshState, todayMarketCard } from "../dist/state.js";
import { hasCurrentCoverage } from "../dist/safety.js";

const SEEDS = [17, 83, 2026];
const NIGHTS = 60;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function simulateStrategy(strategy, seed, nightTarget = NIGHTS) {
  const state = freshState();
  const engine = createGameEngine(state, { random: seededRandom(seed) });
  const cashAtClose = [];
  let branchSales = 0;
  let safetyClaims = 0;
  let completedNights = 0;

  for (let step = 0; completedNights < nightTarget && step < 2000; step += 1) {
    if (state.phase === "decision") {
      if (state.managerEvent) {
        const choice = state.managerEvent.type === "equipment" ? "defer"
          : state.managerEvent.type === "complaint" ? "explain" : "decline";
        assert.equal(engine.resolveManagerEvent(choice).ok, true);
      }

      const managedOutlet = state.outlets.find((outlet) => outlet.id !== "main");
      if (strategy === "managed-branch" && managedOutlet && !managedOutlet.manager) {
        const hired = engine.hireOutletManager(managedOutlet.id);
        if (hired.ok) continue;
      }

      let decision = "hold";
      if (strategy === "growth" && state.expansions < 2 && state.coins > 1300) decision = "expand";
      else if (strategy === "growth" && state.hiredCrew < 1 && state.coins > 1100) decision = "hire";
      else if (strategy === "managed-branch" && state.acquisitions < 1 && state.coins > 1200) decision = "acquire";
      assert.equal(engine.chooseWeeklyDecision(decision, "fruit").ok, true);
      continue;
    }

    assert.equal(state.phase, "prep", `unexpected phase on night ${state.day}`);
    const card = todayMarketCard(state);
    if (card) {
      const noCostChoice = card.choices.find((choice) => choice.cost === 0) || card.choices.at(-1);
      assert.equal(engine.chooseMarketCard(noCostChoice.id).ok, true);
    }

    const expectedStock = new Map();
    for (const guest of engine.getGuests()) {
      if (guest.difficult) continue;
      const dish = DATA.dishes.find((item) => state.unlockedRecipes.includes(item.id) &&
        !state.recalledDishIds.includes(item.id) && item.need.includes(guest.need)) ||
        DATA.dishes.find((item) => state.unlockedRecipes.includes(item.id) && !state.recalledDishIds.includes(item.id));
      if (dish) expectedStock.set(dish.ingredient, (expectedStock.get(dish.ingredient) || 0) + 1);
    }
    for (const [ingredientId, demand] of expectedStock) {
      const target = demand + 1;
      while ((Number(state.stock[ingredientId]) || 0) < target) {
        const purchase = engine.buyStock(ingredientId);
        if (!purchase.ok) break;
      }
    }

    for (const outlet of state.outlets.filter((item) => item.id !== "main")) {
      const product = getOutletProduct(outlet.type);
      const capacity = outlet.manager ? 2 : 1;
      const targetStock = capacity + 1;
      while ((Number(outlet.stock[product.stockId]) || 0) < targetStock) {
        const purchase = engine.buyOutletStock(outlet.id, product.stockId);
        if (!purchase.ok) break;
      }
      if (!outlet.active && (Number(outlet.stock[product.stockId]) || 0) > 0) {
        engine.toggleOutlet(outlet.id);
      }
    }

    if (strategy === "managed-branch" && state.day === 1) {
      assert.equal(engine.toggleAccidentCoverage("main").ok, true);
    }
    assert.equal(engine.openDoors().ok, true, `could not open on night ${state.day}`);

    if (state.safetyIncident?.status === "pending") {
      const choice = hasCurrentCoverage(state, state.safetyIncident.outletId, state.safetyIncident.policy)
        ? "claim" : "self";
      assert.equal(engine.resolveSafetyIncident(choice).ok, true);
    }

    let serviceSteps = 0;
    while (state.phase === "service" && serviceSteps < 30) {
      serviceSteps += 1;
      const guest = engine.getGuests()[state.customerIndex];
      assert.ok(guest, `missing guest on night ${state.day}`);
      if (guest.difficult) {
        const response = engine.resolveComplaint(state.coins > 80 ? "snack" : "calm");
        assert.equal(response.ok, true);
        continue;
      }
      const dish = DATA.dishes.find((item) => state.unlockedRecipes.includes(item.id) &&
        !state.recalledDishIds.includes(item.id) && item.need.includes(guest.need) &&
        (Number(state.stock[item.ingredient]) || 0) > 0) ||
        DATA.dishes.find((item) => state.unlockedRecipes.includes(item.id) &&
          !state.recalledDishIds.includes(item.id) && (Number(state.stock[item.ingredient]) || 0) > 0);
      assert.ok(dish, `no prepared dish for ${guest.name} on night ${state.day}`);
      assert.equal(engine.serveDish(dish.id).ok, true);
    }

    assert.notEqual(state.phase, "service", `service did not resolve on night ${state.day}`);
    assert.equal(state.phase, "report", `no closing report on night ${state.day}`);
    assert.equal(engine.chooseStory("paperboat").ok, true);
    assert.equal(engine.nextNight().ok, true);
    branchSales += state.accounting.journal.filter((entry) => entry.day === state.day - 1 &&
      entry.description?.includes("分店")).length;
    safetyClaims += state.insuranceClaims.filter((claim) => claim.status === "collected").length;
    cashAtClose.push(state.coins);
    completedNights += 1;
  }

  return { state, engine, completedNights, minimumCash: Math.min(...cashAtClose), branchSales, safetyClaims };
}

test("fresh-save opening-week route reaches the first weekly decision after seven playable nights", () => {
  const { state, engine, completedNights } = simulateStrategy("hold", 17, 7);
  assert.equal(completedNights, 7);
  assert.equal(state.day, 8);
  assert.equal(state.phase, "decision");
  assert.equal(state.journal.length, 7, "all seven nights should be archived in the diary");
  assert.equal(state.weeklyFocus.result?.resolvedDay, 7);
  assert.equal(engine.chooseWeeklyDecision("hold").ok, true, "the first weekly choice remains reachable");
  assert.equal(state.phase, "prep");
  assert.equal(state.day, 8);
});

test("60-night seeded hold, growth, and insured manager-branch routes stay operable and reconcile", () => {
  for (const strategy of ["hold", "growth", "managed-branch"]) {
    for (const seed of SEEDS) {
      const { state, completedNights, minimumCash, branchSales, safetyClaims } = simulateStrategy(strategy, seed);
      assert.equal(completedNights, NIGHTS, `${strategy} seed ${seed} should keep the world running`);
      assert.equal(state.day, NIGHTS + 1);
      assert.ok(minimumCash > 0, `${strategy} seed ${seed} should retain positive cash at each close`);
      assert.ok(state.accounting.weeklyReports.every((report) => report.balanced));
      assert.ok(state.accounting.monthlyReports.every((report) =>
        report.financialPosition.balanced && report.cashFlow.reconciles));
      assert.ok(state.accounting.journal.every((entry) =>
        entry.lines.reduce((sum, line) => sum + line.debit, 0) ===
        entry.lines.reduce((sum, line) => sum + line.credit, 0)));
      if (strategy === "growth") assert.ok(state.expansions >= 1 || state.hiredCrew >= 1);
      if (strategy === "managed-branch") {
        assert.equal(state.outlets.find((outlet) => outlet.id !== "main")?.manager, true);
        assert.ok(branchSales > 0, "managed branch should produce continuing sales");
        assert.ok(safetyClaims > 0, "the insured route should exercise deferred claim receipts");
        assert.ok(state.journal.some((entry) => entry.claimSettlements?.length),
          "collected claims should leave a dated incident follow-up in the diary");
      }
    }
  }
});

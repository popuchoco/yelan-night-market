import test from "node:test";
import assert from "node:assert/strict";
import { DATA } from "../dist/data.js";
import { postJournal } from "../dist/accounting.js";
import { createGameEngine } from "../dist/engine.js";
import { freshState, todayMarketCard, getTonightGuests } from "../dist/state.js";
import { hasCurrentCoverage } from "../dist/safety.js";

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test("optional 60-night promotion and incident pressure route keeps journals balanced", () => {
  const state = freshState();
  state.coins += 12000;
  postJournal(state, "壓力測試開業資金", [
    { account: "1000", debit: 12000 }, { account: "3000", credit: 12000 }
  ], { category: "financing", amount: 12000 });
  const engine = createGameEngine(state, { random: seededRandom(83) });
  let completedNights = 0;
  let paidPromotionNights = 0;
  let incidentNights = 0;

  while (completedNights < 60) {
    if (state.phase === "decision") {
      assert.equal(engine.chooseWeeklyDecision("hold").ok, true);
      continue;
    }
    assert.equal(state.phase, "prep");
    const card = todayMarketCard(state);
    if (card) {
      const preferred = ({
        "tourist-surge": "promote",
        "hygiene-audit": "deep-clean",
        "rain-subsidy": "claim",
        "media-interview": "accept-interview",
        "celebrity-visit": "host-visit",
        "paid-promotion": "buy-placement"
      })[card.id];
      const result = engine.chooseMarketCard(preferred);
      assert.equal(result.ok, true, `market card ${card.id} on night ${state.day}`);
      if (card.id === "paid-promotion") paidPromotionNights += 1;
    }

    const demand = new Map();
    for (const guest of getTonightGuests(state)) {
      if (guest.difficult) continue;
      const dish = DATA.dishes.find((item) => state.unlockedRecipes.includes(item.id) &&
        !state.recalledDishIds.includes(item.id) && item.need.includes(guest.need)) ||
        DATA.dishes.find((item) => state.unlockedRecipes.includes(item.id) && !state.recalledDishIds.includes(item.id));
      if (dish) demand.set(dish.ingredient, (demand.get(dish.ingredient) || 0) + 1);
    }
    for (const ingredient of DATA.ingredients) {
      const target = (demand.get(ingredient.id) || 0) + 5;
      while ((Number(state.stock[ingredient.id]) || 0) < target) {
        const purchase = engine.buyStock(ingredient.id);
        if (!purchase.ok) break;
      }
    }

    if (state.day === 1) assert.equal(engine.toggleAccidentCoverage("main").ok, true);
    assert.equal(engine.openDoors().ok, true, `could not open on night ${state.day}`);
    if (state.safetyIncident?.status === "pending") {
      incidentNights += 1;
      const choice = hasCurrentCoverage(state, state.safetyIncident.outletId, state.safetyIncident.policy) ? "claim" : "self";
      assert.equal(engine.resolveSafetyIncident(choice).ok, true);
    }
    let serviceSteps = 0;
    while (state.phase === "service" && serviceSteps < 30) {
      serviceSteps += 1;
      const guest = engine.getGuests()[state.customerIndex];
      assert.ok(guest, `missing guest on night ${state.day}`);
      if (guest.difficult) {
        assert.equal(engine.resolveComplaint("calm").ok, true);
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
    assert.notEqual(state.phase, "service");
    assert.equal(state.phase, "report", `no closing report on night ${state.day}`);
    assert.equal(engine.chooseStory("paperboat").ok, true);
    assert.equal(engine.nextNight().ok, true);
    completedNights += 1;
  }

  assert.equal(state.day, 61);
  assert.equal(paidPromotionNights, 2, "one paid-placement card is scheduled per 30-night period");
  assert.ok(incidentNights > 0, "fixed seed should exercise the incident path");
  assert.ok(state.accounting.weeklyReports.every((report) => report.balanced));
  const failedReports = state.accounting.monthlyReports.filter((report) =>
    !report.financialPosition.balanced || !report.cashFlow.reconciles);
  assert.deepEqual(failedReports.map((report) => ({ endDay: report.endDay,
    financialPosition: report.financialPosition, cashFlow: report.cashFlow })), []);
  assert.ok(state.accounting.journal.every((entry) =>
    entry.lines.reduce((sum, line) => sum + line.debit, 0) ===
    entry.lines.reduce((sum, line) => sum + line.credit, 0)));
});

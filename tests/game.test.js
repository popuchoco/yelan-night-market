import test from "node:test";
import assert from "node:assert/strict";
import { DATA } from "../dist/data.js";
import { createGameEngine } from "../dist/game.js";
import { applyCameraAction } from "../dist/scene.js";
import {
  createLedger, freshState, getPurchasePrice, loadState, saveState, todayEvent
} from "../dist/state.js";

function serviceState(day = 3) {
  const state = freshState();
  state.day = day;
  state.phase = "service";
  state.ledger = createLedger(state);
  return state;
}

test("three complaint responses apply their distinct costs and reputation effects", () => {
  const calm = serviceState(4);
  calm.customerIndex = 3;
  const calmCoins = calm.coins;
  const calmFame = calm.fame;
  assert.equal(createGameEngine(calm).resolveComplaint("calm").ok, true);
  assert.equal(calm.coins, calmCoins);
  assert.equal(calm.fame, calmFame - 1);

  const snack = serviceState(4);
  snack.customerIndex = 3;
  assert.equal(createGameEngine(snack).resolveComplaint("snack").ok, true);
  assert.equal(snack.coins, 1480 - DATA.economy.complaintSnackCost);
  assert.equal(snack.ledger.compensation, DATA.economy.complaintSnackCost);
  assert.equal(snack.fame, 39);

  const refund = serviceState(4);
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
  const state = serviceState(7);
  const startingCoins = state.coins;
  const result = createGameEngine(state).serveDish("pepper-soup");
  assert.equal(result.ok, true);
  assert.equal(state.stock.chicken, 3);
  assert.equal(state.ledger.sales, 120);
  assert.equal(state.ledger.tips, DATA.economy.goodMatchTip + DATA.economy.featuredDishBonus + DATA.economy.streetMusicTip);
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

  values.set(DATA.saveKey, "not-json");
  assert.equal(loadState(storage).phase, "prep");
});

test("event schedule covers seven nights before looping", () => {
  const ids = Array.from({ length: DATA.events.length }, (_, index) => todayEvent({ day: index + 3 }).id);
  assert.deepEqual(ids, ["festival", "complaint", "rain", "supplier", "street-music", "market-sale", "blackout"]);
  assert.equal(todayEvent({ day: DATA.events.length + 3 }).id, ids[0]);
});

test("event pricing modifiers distinguish supplier shortage and market sale", () => {
  const chicken = DATA.ingredients.find((item) => item.id === "chicken");
  assert.equal(getPurchasePrice({ day: 6 }, chicken), Math.round(chicken.cost * DATA.economy.supplierMarkup));
  assert.equal(getPurchasePrice({ day: 8 }, chicken), Math.round(chicken.cost * DATA.economy.marketDiscount));
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DATA } from "../dist/data.js";
import { CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, ENDINGS, WEEKLY_DECISION_DAYS, selectEnding } from "../dist/campaign.js";
import { createGameEngine } from "../dist/game.js";
import { applyCameraAction } from "../dist/scene.js";
import {
  createLedger, freshState, getPurchasePrice, getTonightGuests, loadState, normalizeState, saveState, todayEvent
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

  values.set(DATA.saveKey, "not-json");
  assert.equal(loadState(storage).phase, "prep");
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

test("campaign calendar covers 30 distinct story nights and has four weekly turns", () => {
  assert.equal(CAMPAIGN_CALENDAR.length, CAMPAIGN_DAYS);
  assert.equal(new Set(CAMPAIGN_CALENDAR.map((night) => night.title)).size, CAMPAIGN_DAYS);
  assert.deepEqual(WEEKLY_DECISION_DAYS, [8, 15, 22, 29]);
  assert.equal(todayEvent({ day: 1 }).id, "festival");
  assert.equal(todayEvent({ day: 8 }).id, "inspection");
  assert.equal(todayEvent({ day: 30 }).name, CAMPAIGN_CALENDAR[29].name);
});

test("event pricing modifiers distinguish supplier shortage and market sale", () => {
  const chicken = DATA.ingredients.find((item) => item.id === "chicken");
  assert.equal(getPurchasePrice({ day: 6 }, chicken), Math.round(chicken.cost * DATA.economy.supplierMarkup));
  assert.equal(getPurchasePrice({ day: 9 }, chicken), Math.round(chicken.cost * DATA.economy.marketDiscount));
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

test("inspection events charge for missing equipment and reward a prepared stall", () => {
  const unprepared = freshState();
  unprepared.day = 8;
  assert.equal(createLedger(unprepared).fees, 75);
  const fameBefore = unprepared.fame;
  assert.equal(createGameEngine(unprepared).openDoors().ok, true);
  assert.equal(unprepared.fame, fameBefore - 2);

  const ready = freshState();
  ready.day = 8;
  ready.equipment.hood = 1;
  assert.equal(createLedger(ready).fees, 0);
  assert.equal(createGameEngine(ready).openDoors().ok, true);
  assert.equal(ready.fame, 39);
});

test("all 30 nights can be completed, with campaign ending and replay support", () => {
  const state = freshState();
  const engine = createGameEngine(state);
  while (state.phase !== "ending") {
    if (state.phase === "decision") {
      assert.equal(engine.chooseWeeklyDecision("hold").ok, true);
      continue;
    }
    state.phase = "report";
    state.reportChoice = "paperboat";
    state.ledger = createLedger(state);
    assert.equal(engine.nextNight().ok, true);
  }
  assert.equal(state.day, 30);
  assert.ok(ENDINGS[state.endingId]);
  assert.equal(state.journal.length, 30);
  assert.equal(engine.restartCampaign().ok, true);
  assert.equal(state.day, 1);
  assert.equal(state.phase, "prep");
  assert.equal(state.journal.length, 0);
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
  const choices = Object.values(ENDINGS).map((ending) => ending.tone);
  assert.ok(choices.includes("positive"));
  assert.ok(choices.includes("negative"));
});

test("DOM helpers and split scene renderers remain in place without HTML injection", async () => {
  const [ui, scene, objects, effects, html] = await Promise.all([
    readFile(new URL("../dist/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/objects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/scene/effects.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.html", import.meta.url), "utf8")
  ]);
  assert.match(ui, /function el\(/);
  assert.match(ui, /function append\(/);
  assert.match(ui, /function fragment\(/);
  assert.match(ui, /replaceChildren\(/);
  assert.doesNotMatch(ui, /\.innerHTML\s*=/);
  assert.match(scene, /createObjectRenderer/);
  assert.match(scene, /createEffectRenderer/);
  assert.match(objects, /drawStall/);
  assert.match(effects, /createEffectRenderer/);
  assert.match(html, /id="worldCanvas" tabindex="0"/);
  const css = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
  const game = await readFile(new URL("../dist/game.js", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(scene, /motionReduced/);
  assert.match(game, /orderModal\.addEventListener\("keydown"/);
  assert.match(game, /orderReturnFocus/);
});

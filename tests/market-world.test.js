import test from "node:test";
import assert from "node:assert/strict";
import { DATA, getMarketStalls, getUnlockedMarketBlocks } from "../dist/data.js";
import { isAcquisitionTypeAvailable, weeklyOptionCost, ACQUISITION_TYPES } from "../dist/campaign.js";
import { createGameEngine } from "../dist/engine.js";
import { getCameraProfile, getMarketStaffWaypoints, getOutletCrowdRoutes, isProjectedBoundsVisible } from "../dist/scene.js";
import { postJournal } from "../dist/accounting.js";
import { freshState, forecast, knownRecurringOperatingCost, normalizeState, SAVE_SCHEMA_VERSION } from "../dist/state.js";

test("projected scene bounds cull offscreen objects but retain partial visibility", () => {
  const project = (x, y) => ({ x, y });
  const viewport = { width: 100, height: 100 };
  assert.equal(isProjectedBoundsVisible({ x: 20, z: 20, w: 30, d: 30, h: 15 }, project, viewport, 0), true);
  assert.equal(isProjectedBoundsVisible({ x: 150, z: 20, w: 30, d: 30, h: 15 }, project, viewport, 0), false);
  assert.equal(isProjectedBoundsVisible({ x: 105, z: 20, w: 30, d: 30, h: 15 }, project, viewport, 8), true);
});

test("M11 unlocks a data-defined, operable east-pier market block through a fifth unique storefront", () => {
  const state = freshState();
  assert.deepEqual(getUnlockedMarketBlocks(state).map((block) => block.id), ["harbor-core"]);
  assert.equal(getMarketStalls(state).some((stall) => stall.id === "noodle"), false);
  assert.equal(isAcquisitionTypeAvailable(state, "noodle"), false);
  assert.equal(DATA.outletProducts.noodle.productName, "蚵仔魚丸麵線");
  assert.equal(DATA.outletProducts.noodle.price, 172);

  state.day = 29;
  state.phase = "decision";
  state.coins += 10000;
  postJournal(state, "M11測試開業資金", [{ account: "1000", debit: 10000 }, { account: "3000", credit: 10000 }]);
  state.acquisitions = 4;
  state.acquisitionTypes = ["fish", "fruit", "sweet", "toy"];
  state.outlets.push(...state.acquisitionTypes.map((type, index) => ({
    id: "acquired-" + (index + 1), name: ACQUISITION_TYPES[type].name + "・分店 " + (index + 1), type,
    tier: "mobile", active: false, manager: false, equipmentLevel: 0, stock: {}, stockCost: {},
    safety: { fire: 0, ventilation: 0, coldStorage: 0 }, nextNightBonus: 0, efficiencyPenalty: 0,
    reputation: 50, autoPaused: false, lastResult: null
  })));
  const recurringBeforeNoodleShop = knownRecurringOperatingCost(state);
  assert.equal(isAcquisitionTypeAvailable(state, "noodle"), true);
  assert.equal(isAcquisitionTypeAvailable(state, "fruit"), false, "the final acquisition slot must remain available for the district unlock");
  assert.equal(weeklyOptionCost(state, "acquire"), 1480);

  const engine = createGameEngine(state);
  const rejectedOptionalAcquisition = engine.chooseWeeklyDecision("acquire", "fruit");
  assert.equal(rejectedOptionalAcquisition.ok, false);
  assert.match(rejectedOptionalAcquisition.message, /第五次接手限定船埠麵線/);
  assert.equal(state.acquisitions, 4, "a different fifth storefront cannot consume the district unlock slot");
  const acquired = engine.chooseWeeklyDecision("acquire", "noodle");
  assert.equal(acquired.ok, true);
  assert.match(acquired.message, /東堤小巷/);
  const branch = state.outlets.find((outlet) => outlet.type === "noodle");
  assert.ok(branch);
  assert.equal(branch.stock.noodle, 0);
  assert.equal(knownRecurringOperatingCost(state), recurringBeforeNoodleShop + 38);
  assert.deepEqual(getUnlockedMarketBlocks(state).map((block) => block.id), ["harbor-core", "east-pier"]);
  const eastPier = getUnlockedMarketBlocks(state).find((block) => block.id === "east-pier");
  assert.equal(eastPier.queueRoutes.length, 2);
  assert.ok(eastPier.staffRoute.length >= 4);
  assert.equal(getMarketStalls(state).some((stall) => stall.id === "noodle"), true);
  assert.equal(getMarketStalls(state).length, 6);
  assert.equal(getCameraProfile(state, { width: 1100, height: 720 }).level, 3);
  assert.equal(weeklyOptionCost(state, "acquire"), null);
  assert.equal(getOutletCrowdRoutes(state).length, 0, "inactive storefronts should not spawn queue visitors");
  assert.equal(getMarketStaffWaypoints(state).some((point) => point.x === 1240 && point.z === 682), false,
    "inactive storefronts should not add staff routes");

  assert.equal(engine.buyOutletStock(branch.id, "noodle").ok, true);
  assert.equal(engine.toggleOutlet(branch.id).ok, true);
  assert.equal(branch.active, true);
  assert.equal(knownRecurringOperatingCost(state), recurringBeforeNoodleShop + 38 + DATA.economy.outletUtilities);
  assert.ok(getMarketStaffWaypoints(state).some((point) => point.x === 1240 && point.z === 682));
  const crowdRoutes = getOutletCrowdRoutes(state);
  assert.equal(crowdRoutes.length, 2);
  assert.ok(crowdRoutes.every((item) => item.outletId === branch.id && item.route.length >= 6));
  assert.equal(forecast(state).outletSales, DATA.outletProducts.noodle.price);

  const migrated = normalizeState({ ...state, schemaVersion: SAVE_SCHEMA_VERSION - 1 });
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.ok(getUnlockedMarketBlocks(migrated).some((block) => block.id === "east-pier"));
  assert.equal(migrated.marketBlocks, undefined, "world layout is derived from acquired outlets, not persisted as duplicate map state");
});

test("schema v6 saves retain legacy storefronts while the new district remains derived and opening-week camera stays local", () => {
  const previous = freshState();
  previous.schemaVersion = 6;
  previous.day = 7;
  previous.acquisitions = 4;
  previous.acquisitionTypes = ["fish", "fruit", "sweet", "toy"];
  previous.outlets.push(...previous.acquisitionTypes.map((type, index) => ({
    id: "legacy-" + (index + 1), type, name: ACQUISITION_TYPES[type].name,
    active: false, stock: {}, stockCost: {}
  })));

  const migrated = normalizeState(previous);
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(migrated.acquisitions, 4);
  assert.deepEqual(migrated.outlets.slice(1).map((outlet) => outlet.type), previous.acquisitionTypes);
  assert.deepEqual(getUnlockedMarketBlocks(migrated).map((block) => block.id), ["harbor-core"]);
  assert.equal(Object.hasOwn(migrated, "marketBlocks"), false);
  assert.equal(Object.hasOwn(migrated, "camera"), false);

  migrated.expansions = 3;
  const openingCamera = getCameraProfile(migrated, { width: 390, height: 844 });
  assert.equal(openingCamera.level, 0, "the opening seven nights keep the camera range at its local starting level");
  assert.equal(openingCamera.minZoom, 1, "the opening view cannot zoom out to reveal the larger world");
  assert.equal(openingCamera.panX, 0);
  assert.equal(openingCamera.panY, 0);
  migrated.day = 8;
  assert.ok(getCameraProfile(migrated, { width: 390, height: 844 }).level > 0,
    "earned growth becomes visible once the opening week is complete");
});

import { DATA, createOutletInventory, getOutletProduct, outletAvailableStock, outletRetailPrice } from "./data.js";
import { ACQUISITION_TYPES, CAMPAIGN_DAYS, acquisitionGroupCounts, campaignEntry, campaignCycleDay, isWeeklyDecisionDay, marketCardForDay } from "./campaign.js";
import { createAccountingState, ensureAccounting } from "./accounting.js";
import { getMonthlyInsurance, getOutletCapacity, getOutletTier, getTierDailyUtilities, getTierReadiness, isInsuranceBillingDay, monthlyInsuranceTotals } from "./safety.js";
import { createAchievementState, normalizeAchievementState } from "./achievements.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const SAVE_SCHEMA_VERSION = 5;

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function freshState() {
  const state = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    day: 1,
    coins: 1480,
    fame: 38,
    regulars: 8,
    cozy: 56,
    phase: "prep",
    selectedDish: 0,
    customerIndex: 0,
    revenue: 0,
    results: [],
    reportChoice: null,
    upgrades: {},
    journal: [],
    staff: { cook: true, server: true },
    ledger: null,
    stock: { chicken: 4, seafood: 4, tea: 5 },
    stockCost: { chicken: 42, seafood: 78, tea: 25 },
    shiftPurchases: 0,
    unlockedRecipes: DATA.dishes.filter((dish) => !dish.unlockTier && !dish.secretFor).map((dish) => dish.id),
    recipeGoodVisits: {},
    recipeLog: [],
    safetyIncident: null,
    recalledDishIds: [],
    insuranceClaims: [],
    outbreakRecoveryUntilDay: 0,
    equipment: { grill: 0, hood: 0, awning: 0, fire: 0, cooler: 0 },
    expansions: 0,
    hiredCrew: 0,
    acquisitions: 0,
    acquisitionTypes: [],
    outlets: [{ id: "main", name: "夜嵐攤號", type: "main", tier: "mobile", accidentCoverage: false, active: true, manager: false,
      equipmentLevel: 0, stock: {}, stockCost: {}, nextNightBonus: 0, efficiencyPenalty: 0,
      reputation: 50, autoPaused: false, lastResult: null }],
    insuranceSnapshot: null,
    orphanPolicies: [],
    managerEvent: null,
    loanUsed: false,
    loanPrincipal: 0,
    loanTakenDay: 0,
    loanNights: 0,
    achievements: createAchievementState(),
    marketChoiceDay: 0,
    marketCardChoice: null,
    marketCardOutcome: null,
    decisions: [],
    campaignNet: 0,
    endingId: null
  };
  const inventoryValue = DATA.ingredients.reduce((sum, item) => sum + (state.stock[item.id] || 0) * (state.stockCost[item.id] || item.cost), 0);
  state.accounting = createAccountingState({ day: state.day, cash: state.coins, inventory: inventoryValue });
  return state;
}

/** @typedef {ReturnType<typeof freshState>} GameState */

/** @param {unknown} data @returns {GameState} */
export function normalizeState(data) {
  const fresh = freshState();
  if (!data || typeof data !== "object" || Array.isArray(data)) return fresh;
  Object.keys(fresh).forEach((key) => {
    if (hasOwn(data, key)) fresh[key] = data[key];
  });
  // Older saves are migrated in place to the current known shape. The version
  // is written back on the next successful save.
  fresh.schemaVersion = SAVE_SCHEMA_VERSION;
  fresh.staff = Object.assign({ cook: true, server: true }, fresh.staff || {});
  fresh.achievements = normalizeAchievementState(data.achievements);
  const validRecipeIds = new Set(DATA.dishes.map((dish) => dish.id));
  fresh.unlockedRecipes = Array.from(new Set([
    ...DATA.dishes.filter((dish) => !dish.unlockTier && !dish.secretFor).map((dish) => dish.id),
    ...(Array.isArray(data.unlockedRecipes) ? data.unlockedRecipes : [])
  ].filter((id) => validRecipeIds.has(id))));
  fresh.recipeGoodVisits = data.recipeGoodVisits && typeof data.recipeGoodVisits === "object" && !Array.isArray(data.recipeGoodVisits)
    ? Object.fromEntries(Object.entries(data.recipeGoodVisits).map(([id, visits]) => [String(id), Math.max(0, Math.floor(Number(visits) || 0))])) : {};
  fresh.recipeLog = Array.isArray(data.recipeLog) ? data.recipeLog.filter((entry) => entry && validRecipeIds.has(entry.recipeId)).slice(-100) : [];
  const incidentIds = new Set(DATA.safetyIncidents.map((incident) => incident.id));
  fresh.safetyIncident = data.safetyIncident && incidentIds.has(data.safetyIncident.id) && ["pending", "resolved"].includes(data.safetyIncident.status)
    ? { ...data.safetyIncident, day: Math.max(1, Math.floor(Number(data.safetyIncident.day) || Number(data.day) || 1)) } : null;
  fresh.recalledDishIds = Array.isArray(data.recalledDishIds) ? data.recalledDishIds.filter((id) => validRecipeIds.has(id)) : [];
  fresh.insuranceClaims = Array.isArray(data.insuranceClaims) ? data.insuranceClaims.filter((claim) => claim && typeof claim === "object" && Number(claim.amount) > 0 && ["receivable", "collected"].includes(claim.status)).slice(-100) : [];
  fresh.outbreakRecoveryUntilDay = Math.max(0, Math.floor(Number(data.outbreakRecoveryUntilDay) || 0));
  fresh.stock = Object.assign(fresh.stock, data.stock || {});
  fresh.stockCost = Object.assign(fresh.stockCost, data.stockCost || {});
  fresh.equipment = Object.assign(fresh.equipment, data.equipment || {});
  fresh.expansions = Math.max(0, Math.min(9, Number(fresh.expansions) || 0));
  fresh.hiredCrew = Math.max(0, Math.min(6, Number(fresh.hiredCrew) || 0));
  fresh.acquisitions = Math.max(0, Math.min(4, Number(fresh.acquisitions) || 0));
  const validAcquisitionTypes = new Set(Object.keys(DATA.outletProducts));
  fresh.acquisitionTypes = Array.isArray(data.acquisitionTypes)
    ? data.acquisitionTypes.filter((type) => validAcquisitionTypes.has(type)).slice(0, fresh.acquisitions)
    : [];
  // Older saves counted acquired stalls without recording their category.
  // Treat those legacy purchases as food stalls so the new alliance can still
  // be reached instead of permanently locking out the feature.
  while (fresh.acquisitionTypes.length < fresh.acquisitions) fresh.acquisitionTypes.push("food");
  const sourceOutlets = Array.isArray(data.outlets) ? data.outlets : [];
  const storedMain = sourceOutlets.find((outlet) => outlet && outlet.id === "main");
  const mainOutlet = {
    id: "main", name: "夜嵐攤號", type: "main", tier: "mobile", accidentCoverage: false, active: true, manager: false,
    equipmentLevel: 0, stock: {}, stockCost: {}, nextNightBonus: 0, efficiencyPenalty: 0,
    reputation: 50, autoPaused: false, lastResult: null,
    ...(storedMain && typeof storedMain === "object" ? storedMain : {})
  };
  mainOutlet.id = "main";
  mainOutlet.name = "夜嵐攤號";
  if (!["mobile", "fixed", "dapaidang"].includes(mainOutlet.tier)) mainOutlet.tier = "mobile";
  mainOutlet.accidentCoverage = !!mainOutlet.accidentCoverage;
  const storedBranches = sourceOutlets.filter((outlet) => outlet && outlet.id !== "main").slice(0, fresh.acquisitions);
  const outletNames = Object.fromEntries(Object.entries(ACQUISITION_TYPES).map(([type, details]) => [type, details.name]));
  fresh.outlets = [mainOutlet, ...storedBranches.map((outlet, index) => {
    const type = hasOwn(DATA.outletProducts, outlet.type) ? outlet.type : fresh.acquisitionTypes[index] || "food";
    const inventory = createOutletInventory(outlet.stock, outlet.stockCost);
    return {
      id: String(outlet.id || "acquired-" + (index + 1)),
      name: String(outlet.name || outletNames[type] + "・分店 " + (index + 1)),
      type, tier: ["mobile", "fixed", "dapaidang"].includes(outlet.tier) ? outlet.tier : "mobile",
      accidentCoverage: !!outlet.accidentCoverage,
      safety: Object.assign({ fire: 0, ventilation: 0, coldStorage: 0 }, outlet.safety || {}),
      active: !!outlet.active, manager: !!outlet.manager,
      equipmentLevel: Math.max(0, Math.min(DATA.economy.outletEquipmentCosts.length, Number(outlet.equipmentLevel) || 0)),
      stock: inventory.stock, stockCost: inventory.stockCost,
      nextNightBonus: Math.max(0, Math.round(Number(outlet.nextNightBonus) || 0)),
      efficiencyPenalty: Math.max(0, Math.min(1, Number(outlet.efficiencyPenalty) || 0)),
      reputation: Math.max(0, Math.min(100, Number(outlet.reputation) || 50)),
      autoPaused: !!outlet.autoPaused,
      lastResult: outlet.lastResult && typeof outlet.lastResult === "object" ? outlet.lastResult : null
    };
  })];
  while (fresh.outlets.length <= fresh.acquisitions) {
    const index = fresh.outlets.length - 1;
    const type = fresh.acquisitionTypes[index] || "food";
    const inventory = createOutletInventory();
    fresh.outlets.push({ id: "acquired-" + (index + 1), name: outletNames[type] + "・分店 " + (index + 1), type,
      tier: "mobile", accidentCoverage: false, safety: { fire: 0, ventilation: 0, coldStorage: 0 },
      active: false, manager: false, equipmentLevel: 0, stock: inventory.stock, stockCost: inventory.stockCost, nextNightBonus: 0, efficiencyPenalty: 0,
      reputation: 50, autoPaused: false, lastResult: null });
  }
  fresh.managerEvent = data.managerEvent && typeof data.managerEvent === "object" ? data.managerEvent : null;
  fresh.insuranceSnapshot = data.insuranceSnapshot && typeof data.insuranceSnapshot === "object" ? data.insuranceSnapshot : null;
  fresh.orphanPolicies = Array.isArray(data.orphanPolicies)
    ? data.orphanPolicies.filter((policy) => policy && typeof policy === "object" && !Array.isArray(policy)).slice(-100) : [];
  fresh.loanPrincipal = Math.max(0, Math.round(Number(fresh.loanPrincipal) || 0));
  fresh.loanUsed = !!fresh.loanUsed || fresh.loanPrincipal > 0;
  fresh.loanTakenDay = Math.max(0, Math.floor(Number(fresh.loanTakenDay) || 0));
  fresh.loanNights = Math.max(0, Math.floor(Number(fresh.loanNights) || 0));
  fresh.marketChoiceDay = Math.max(0, Math.floor(Number(fresh.marketChoiceDay) || 0));
  const currentMarketCard = marketCardForDay(fresh.day);
  if (fresh.marketChoiceDay !== fresh.day || !currentMarketCard ||
      !currentMarketCard.choices.some((choice) => choice.id === fresh.marketCardChoice)) {
    fresh.marketChoiceDay = 0;
    fresh.marketCardChoice = null;
    fresh.marketCardOutcome = null;
  } else if (data.marketCardOutcome && Number(data.marketCardOutcome.day) === Number(fresh.day) &&
      data.marketCardOutcome.cardId === currentMarketCard.id && typeof data.marketCardOutcome.summary === "string") {
    fresh.marketCardOutcome = {
      day: fresh.day,
      cardId: String(data.marketCardOutcome.cardId || "").slice(0, 40),
      summary: data.marketCardOutcome.summary.slice(0, 220),
      guestBonus: Math.max(0, Math.min(3, Math.floor(Number(data.marketCardOutcome.guestBonus) || 0))),
      fameChange: Math.max(-5, Math.min(5, Math.round(Number(data.marketCardOutcome.fameChange) || 0)))
    };
  } else {
    fresh.marketCardOutcome = null;
  }
  fresh.decisions = Array.isArray(data.decisions)
    ? data.decisions.filter((decision) => decision && typeof decision === "object" && !Array.isArray(decision)).slice(-104) : [];
  fresh.journal = Array.isArray(data.journal)
    ? data.journal.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).slice(-8000) : [];
  if (!Number.isFinite(Number(fresh.campaignNet))) fresh.campaignNet = 0;
  fresh.day = Math.max(1, Math.floor(Number(fresh.day) || 1));
  if (!fresh.unlockedRecipes.includes(DATA.dishes[fresh.selectedDish]?.id)) {
    fresh.selectedDish = Math.max(0, DATA.dishes.findIndex((dish) => fresh.unlockedRecipes.includes(dish.id)));
  }
  // Saves from the old finite 30-night build keep their progress and simply
  // continue into night 31 instead of stopping on a terminal ending screen.
  if (fresh.phase === "ending") {
    if (fresh.day >= CAMPAIGN_DAYS) fresh.day += 1;
    fresh.phase = "prep";
    fresh.endingId = null;
  }
  if (fresh.phase === "prep" && isWeeklyDecisionDay(fresh.day) &&
      fresh.journal.some((entry) => entry && entry.day === fresh.day - 1) &&
      !fresh.decisions.some((decision) => decision && decision.day === fresh.day)) {
    fresh.phase = "decision";
  }
  if (!Array.isArray(fresh.results)) fresh.results = [];
  if (!fresh.upgrades || typeof fresh.upgrades !== "object") fresh.upgrades = {};
  if (!Number.isFinite(Number(fresh.shiftPurchases))) fresh.shiftPurchases = 0;
  if (fresh.ledger && typeof fresh.ledger === "object") {
    const defaults = createLedger(fresh);
    // Old in-progress saves never paid a period-start premium; adding a
    // projected fee to that historical ledger would desynchronise cash/books.
    ["insuranceAccident", "insuranceLabor", "insuranceHealth", "insuranceProduct", "insurancePublic"].forEach((key) => { defaults[key] = 0; });
    fresh.ledger = { ...defaults, ...fresh.ledger };
    Object.keys(defaults).forEach((key) => {
      if (!Number.isFinite(Number(fresh.ledger[key]))) fresh.ledger[key] = defaults[key];
    });
  }
  if ((fresh.phase === "service" || fresh.phase === "report") && !fresh.ledger) {
    fresh.phase = "prep";
    fresh.customerIndex = 0;
    fresh.revenue = 0;
    fresh.results = [];
    fresh.reportChoice = null;
  }
  if (data.accounting && typeof data.accounting === "object") {
    fresh.accounting = data.accounting;
    ensureAccounting(fresh);
  } else {
    const stockValue = DATA.ingredients.reduce((sum, item) => sum +
      Math.max(0, Number(fresh.stock[item.id]) || 0) * Math.max(0, Number(fresh.stockCost[item.id]) || item.cost), 0);
    const assets = [];
    DATA.equipment.forEach((item) => {
      const level = Math.max(0, Math.min(item.costs.length, Number(fresh.equipment[item.id]) || 0));
      item.costs.slice(0, level).forEach((cost, index) => assets.push({
        id: "legacy-" + item.id + "-" + (index + 1), name: item.name + " Lv." + (index + 1), cost,
        usefulLifeDays: DATA.accounting.equipmentUsefulLifeDays, residualValue: 0, availableDay: fresh.day
      }));
    });
    DATA.upgrades.forEach((item) => {
      if (fresh.upgrades[item.id]) assets.push({ id: "legacy-upgrade-" + item.id, name: item.name, cost: item.cost,
        usefulLifeDays: DATA.accounting.improvementUsefulLifeDays, residualValue: 0, availableDay: fresh.day });
    });
    for (let index = 0; index < fresh.expansions; index++) assets.push({
      id: "legacy-expansion-" + (index + 1), name: "戶外桌區裝修 " + (index + 1),
      cost: 460 + 90 * index, usefulLifeDays: DATA.accounting.improvementUsefulLifeDays, residualValue: 0, availableDay: fresh.day
    });
    for (let index = 0; index < fresh.acquisitions; index++) assets.push({
      id: "legacy-acquisition-" + (index + 1), name: "鄰攤經營權 " + (index + 1),
      cost: 760 + 180 * index, usefulLifeDays: DATA.accounting.concessionUsefulLifeDays, residualValue: 0, category: "intangible", availableDay: fresh.day
    });
    fresh.accounting = createAccountingState({
      day: fresh.day, cash: fresh.coins, inventory: stockValue, debt: fresh.loanPrincipal, assets
    });
  }
  return fresh;
}

/** @param {GameState} state @returns {string} */
export function captureStateSnapshot(state) {
  return JSON.stringify(state);
}

/**
 * Restore the stable root object so engine and scene closures keep their
 * reference while every nested mutable record returns to the saved snapshot.
 * @param {GameState} state
 * @param {string} snapshot
 * @returns {GameState}
 */
export function restoreStateSnapshot(state, snapshot) {
  const restored = JSON.parse(snapshot);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, restored);
  return state;
}

/** @typedef {{ state: ReturnType<typeof freshState>, status: "empty"|"loaded"|"migrated"|"corrupt"|"unavailable"|"unsupported-version", sourceVersion?: number }} SaveLoadResult */

/**
 * Read and normalize a save without hiding whether recovery or migration was
 * needed. Mutable state stays plain JSON so existing save files remain portable.
 * @param {Storage|undefined|null} [storage]
 * @returns {SaveLoadResult}
 */
export function loadStateResult(storage) {
  const fresh = freshState();
  storage = resolveStorage(storage);
  if (!storage) return { state: fresh, status: "unavailable" };

  let raw;
  let source = "current";
  try {
    raw = storage.getItem(DATA.saveKey);
    if (!raw) {
      raw = storage.getItem(DATA.legacyKey);
      source = "legacy";
    }
  } catch {
    return { state: fresh, status: "unavailable" };
  }
  if (!raw) return { state: fresh, status: "empty" };

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid save root");
  } catch {
    // Keep a recovery copy before the next normal save replaces the damaged
    // primary key. Storage quota may prevent the copy, so this is best-effort.
    try { storage.setItem(DATA.saveKey + ".corrupt-backup", raw); } catch {}
    return { state: fresh, status: "corrupt" };
  }

  const sourceVersion = Number(parsed.schemaVersion) || 0;
  if (sourceVersion > SAVE_SCHEMA_VERSION) {
    // Do not overwrite a save created by a newer build with a fresh state.
    return { state: fresh, status: "unsupported-version", sourceVersion };
  }
  try {
    return {
      state: normalizeState(parsed),
      status: sourceVersion < SAVE_SCHEMA_VERSION || source === "legacy" ? "migrated" : "loaded",
      sourceVersion
    };
  } catch {
    try { storage.setItem(DATA.saveKey + ".corrupt-backup", raw); } catch {}
    return { state: fresh, status: "corrupt", sourceVersion };
  }
}

export function loadState(storage) {
  return loadStateResult(storage).state;
}

/** @typedef {{ ok: boolean, reason: "saved"|"unavailable"|"quota"|"failed" }} SaveResult */

/**
 * Persist a versioned snapshot. The simulation itself intentionally remains
 * mutable; JSON serialization is the save boundary and includes only plain data.
 * @param {ReturnType<typeof freshState>} state
 * @param {Storage|undefined|null} [storage]
 * @returns {SaveResult}
 */
export function saveStateResult(state, storage) {
  storage = resolveStorage(storage);
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    state.schemaVersion = SAVE_SCHEMA_VERSION;
    storage.setItem(DATA.saveKey, JSON.stringify(state));
    return { ok: true, reason: "saved" };
  } catch (error) {
    const quotaExceeded = error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED" || error?.code === 22 || error?.code === 1014;
    return { ok: false, reason: quotaExceeded ? "quota" : "failed" };
  }
}

export function saveState(state, storage) {
  return saveStateResult(state, storage).ok;
}

/**
 * Remove the current save and all known legacy/recovery copies.
 * Every key is attempted even if one removal fails.
 * @param {Storage|undefined|null} [storage]
 * @param {{ preserveNewerSave?: boolean }} [options]
 * @returns {{ ok: boolean, reason: "cleared"|"unavailable"|"failed"|"unsupported-version" }}
 */
export function clearSavedProgress(storage, { preserveNewerSave = false } = {}) {
  if (preserveNewerSave) return { ok: false, reason: "unsupported-version" };
  storage = resolveStorage(storage);
  if (!storage) return { ok: false, reason: "unavailable" };
  const keys = [DATA.saveKey, DATA.legacyKey, DATA.saveKey + ".corrupt-backup"];
  let failed = false;
  keys.forEach((key) => {
    try { storage.removeItem(key); } catch { failed = true; }
  });
  return failed ? { ok: false, reason: "failed" } : { ok: true, reason: "cleared" };
}

export function money(value) {
  return "NT$ " + Math.round(Number(value) || 0).toLocaleString("zh-TW");
}

export function todayEvent(state) {
  const entry = campaignEntry(state.day);
  const base = DATA.events.find((item) => item.id === entry.eventId);
  return { ...(base || { id: entry.eventId }), ...entry, id: entry.eventId };
}

export function todayStory(state) {
  return campaignEntry(state.day);
}

export function todayMarketCard(state) {
  return marketCardForDay(state.day);
}

export function currentCycleDay(state) {
  return campaignCycleDay(state.day);
}

export function marketCardChoice(state) {
  return state.marketChoiceDay === state.day ? state.marketCardChoice : null;
}

export function hasBrandAlliance(state) {
  if ((Number(state.expansions) || 0) < 1) return false;
  const counts = acquisitionGroupCounts(state.acquisitionTypes);
  return Object.values(counts).some((count) => count >= 2);
}

export function getTonightGuests(state) {
  const deck = DATA.guests;
  const offset = Math.max(0, (state.day - 3) % deck.length);
  const mainTier = getOutletTier((state.outlets || []).find((outlet) => outlet.id === "main"));
  const recoveryPenalty = Number(state.outbreakRecoveryUntilDay) >= Number(state.day) ? 1 : 0;
  const seats = Math.min(8, (Number(state.expansions) || 0) + (Number(state.acquisitions) || 0) + mainTier.guestBonus);
  const guests = Array.from({ length: Math.max(2, 3 + seats - recoveryPenalty) }, (_, index) => deck[(offset + index) % deck.length]);
  if (hasBrandAlliance(state)) guests.push({ ...deck[offset % deck.length], name: "品牌聯盟・港邊來客", role: "夜市品牌聯盟來客" });
  if (marketCardChoice(state) === "promote") {
    guests.push({ ...deck[offset % deck.length], name: "觀光客・小滿", role: "港區觀光旅人" });
    guests.push({ ...deck[(offset + 1) % deck.length], name: "觀光客・阿拓", role: "港區觀光旅人" });
  }
  const exposureGuests = state.marketCardOutcome && Number(state.marketCardOutcome.day) === Number(state.day)
    ? Math.max(0, Math.min(3, Math.floor(Number(state.marketCardOutcome.guestBonus) || 0))) : 0;
  for (let index = 0; index < exposureGuests; index += 1) {
    guests.push({ ...deck[(offset + index) % deck.length], name: "宣傳來客・" + deck[(offset + index) % deck.length].name, role: "夜市宣傳來客" });
  }
  const eventId = todayEvent(state).id;
  if (eventId === "festival") guests.push(DATA.festivalGuest);
  if (eventId === "complaint") guests.push(DATA.difficultGuest);
  return guests;
}

export function staffCost(state) {
  return DATA.staff.reduce((sum, person) => sum + (state.staff[person.id] ? person.wage : 0), 0) +
    (Number(state.hiredCrew) || 0) * 90;
}

export function inspectionFee(state) {
  if (todayEvent(state).id !== "inspection") return 0;
  if (marketCardChoice(state) === "deep-clean") return 0;
  const main = (state.outlets || []).find((outlet) => outlet.id === "main");
  const tier = getOutletTier(main);
  const ready = tier.id === "mobile"
    ? (Number(state.equipment.hood) || 0) > 0 || (Number(state.equipment.awning) || 0) > 0 || !!state.upgrades.lantern
    : getTierReadiness(state, main, tier.id).ready;
  return ready ? 0 : 75;
}

export function getPurchasePrice(state, item) {
  const event = todayEvent(state);
  const eventModifier = event.id === "supplier" ? DATA.economy.supplierMarkup : (event.id === "market-sale" ? DATA.economy.marketDiscount : 1);
  const modifier = eventModifier * (hasBrandAlliance(state) ? DATA.economy.alliancePurchaseMultiplier : 1);
  return Math.round(item.cost * modifier);
}

export function getFoodCost(state, dish) {
  const value = Number(state.stockCost[dish.ingredient]);
  return Math.round(Number.isFinite(value) ? value : dish.cost);
}

export function getUnlockedDishes(state) {
  const unlocked = new Set(Array.isArray(state.unlockedRecipes) ? state.unlockedRecipes : DATA.dishes
    .filter((dish) => !dish.unlockTier && !dish.secretFor).map((dish) => dish.id));
  return DATA.dishes.map((dish, index) => ({ dish, index })).filter(({ dish }) => unlocked.has(dish.id));
}

export function createLedger(state) {
  const event = todayEvent(state);
  const card = todayMarketCard(state);
  const choice = marketCardChoice(state);
  const selectedChoice = card?.choices.find((item) => item.id === choice);
  const hood = Number(state.equipment.hood) || 0;
  const awning = Number(state.equipment.awning) || 0;
  const rainElectricity = Math.max(0, DATA.economy.rainElectricity - awning * DATA.economy.awningElectricitySavings);
  const rainGas = Math.max(0, DATA.economy.rainGas - awning * DATA.economy.awningGasSavings);
  const blackout = event.id === "blackout" ? DATA.economy.blackoutSurcharge : 0;
  const fee = inspectionFee(state);
  const insurance = isInsuranceBillingDay(state.day)
    ? monthlyInsuranceTotals(state)
    : { accident: 0, labor: 0, health: 0, product: 0, public: 0 };
  return {
    sales: 0,
    tips: 0,
    bonus: 0,
    storyBonus: 0,
    food: 0,
    purchase: state.shiftPurchases || 0,
    rent: DATA.economy.rent,
    expansionRent: (Number(state.expansions) || 0) * 24,
    acquisitionRent: (Number(state.acquisitions) || 0) * 38,
    labor: staffCost(state),
    managerPayroll: (Array.isArray(state.outlets) ? state.outlets.filter((outlet) => outlet && outlet.manager).length : 0) * DATA.economy.managerWage,
    outletUtilities: (Array.isArray(state.outlets) ? state.outlets.filter((outlet) => outlet && outlet.id !== "main" && outlet.active).length : 0) * DATA.economy.outletUtilities,
    stallUtilities: getTierDailyUtilities(state),
    water: Math.max(DATA.economy.minWater, DATA.economy.water),
    electricity: Math.max(DATA.economy.minElectricity, DATA.economy.electricity - hood * DATA.economy.hoodElectricitySavings) + (event.id === "rain" ? rainElectricity : 0) + blackout,
    gas: Math.max(DATA.economy.minGas, DATA.economy.gas - hood * DATA.economy.hoodGasSavings) + (event.id === "rain" ? rainGas : 0),
    fees: fee,
    marketing: ["tourist-surge", "paid-promotion", "celebrity-visit"].includes(card?.id) ? Math.max(0, Math.round(Number(selectedChoice?.cost) || 0)) : 0,
    preparation: card?.id === "hygiene-audit" && choice === "deep-clean" ? DATA.economy.hygieneQuickCleanCost : 0,
    subsidies: card?.id === "rain-subsidy" && choice === "claim" ? DATA.economy.rainSubsidy : 0,
    interest: (Number(state.loanPrincipal) || 0) > 0
      ? Math.round((Number(state.loanNights) + 1) * Number(state.loanPrincipal) * DATA.economy.loanWeeklyRate / 7) -
        Math.round(Number(state.loanNights) * Number(state.loanPrincipal) * DATA.economy.loanWeeklyRate / 7)
      : 0,
    insuranceAccident: insurance.accident,
    insuranceLabor: insurance.labor,
    insuranceHealth: insurance.health,
    insuranceProduct: insurance.product,
    insurancePublic: insurance.public,
    insuranceRecovery: (Array.isArray(state.orphanPolicies) ? state.orphanPolicies : []).filter((policy) => policy?.status === "receivable" && Number(policy.periodEndDay) < Number(state.day))
      .reduce((sum, policy) => sum + Math.max(0, Math.round(Number(policy.refundAmount) || 0)), 0),
    insuranceClaimRevenue: 0,
    insuranceClaimReceipts: 0,
    safetyCosts: 0,
    compensation: 0,
    refunds: 0,
    cashShort: 0,
    cashOver: 0
  };
}

export function ledgerIncome(ledger) {
  return ledger.sales + ledger.tips + ledger.bonus + ledger.storyBonus + (ledger.subsidies || 0) + (ledger.insuranceClaimRevenue || 0) + (ledger.cashOver || 0);
}

export function fixedOperatingCost(ledger) {
  return ledger.rent + (ledger.expansionRent || 0) + (ledger.acquisitionRent || 0) + ledger.labor +
    (ledger.managerPayroll || 0) + (ledger.outletUtilities || 0) +
    (ledger.stallUtilities || 0) + (ledger.insuranceAccident || 0) + (ledger.insuranceLabor || 0) +
    (ledger.insuranceHealth || 0) + (ledger.insuranceProduct || 0) + (ledger.insurancePublic || 0) +
    (ledger.water || 0) + ledger.electricity + ledger.gas + (ledger.fees || 0) +
    (ledger.marketing || 0) + (ledger.preparation || 0) + (ledger.interest || 0);
}

export function ledgerCosts(ledger) {
  return ledger.food + fixedOperatingCost(ledger) + ledger.compensation + ledger.refunds + (ledger.safetyCosts || 0) + (ledger.cashShort || 0);
}

export function ledgerNet(ledger) {
  return ledgerIncome(ledger) - ledgerCosts(ledger);
}

export function forecast(state) {
  const guests = getTonightGuests(state);
  const paying = guests.filter((guest) => !guest.difficult).length;
  const availableDishes = getUnlockedDishes(state).map(({ dish }) => dish);
  const menu = availableDishes.length ? availableDishes : DATA.dishes.slice(0, 1);
  const averagePrice = Math.round(menu.reduce((sum, dish) => sum + dish.price, 0) / menu.length);
  const averageFood = Math.round(menu.reduce((sum, dish) => sum + getFoodCost(state, dish), 0) / menu.length);
  const event = todayEvent(state);
  const baseTips = DATA.economy.baseTip - (state.staff.cook ? 0 : DATA.economy.cookServicePenalty) - (state.staff.server ? 0 : DATA.economy.serverServicePenalty);
  const upgradeTips = (Number(state.equipment.grill) || 0) * DATA.economy.grillTipPerLevel + (state.upgrades["window-seat"] ? DATA.economy.menuTipBonus : 0) + (Number(state.hiredCrew) || 0) * 10;
  const featuredBonus = menu.some((dish) => dish.id === DATA.dishes[state.selectedDish]?.id) ? DATA.economy.featuredDishBonus : 0;
  const tips = paying * (baseTips + upgradeTips + featuredBonus + (event.id === "street-music" ? DATA.economy.streetMusicTip : 0));
  const bonus = event.id === "festival" ? paying * DATA.economy.festivalBonus : 0;
  const ledger = createLedger(state);
  ledger.sales = paying * averagePrice;
  ledger.tips = tips;
  ledger.bonus = bonus;
  ledger.food = paying * averageFood;
  let outletSales = 0;
  let outletFood = 0;
  (Array.isArray(state.outlets) ? state.outlets : []).filter((outlet) => outlet.id !== "main" && outlet.active).forEach((outlet) => {
    const product = getOutletProduct(outlet.type);
    const capacity = getOutletCapacity(outlet);
    let remaining = capacity;
    if (!product.legacyMixed) {
      const units = Math.min(remaining, outletAvailableStock(outlet));
      outletSales += units * outletRetailPrice(outlet);
      outletFood += units * Math.max(0, Number(outlet.stockCost?.[product.stockId]) || product.cost);
    } else {
      DATA.ingredients.forEach((item) => {
        const units = Math.min(remaining, Math.max(0, Number(outlet.stock?.[item.id]) || 0));
        outletSales += units * outletRetailPrice(outlet);
        outletFood += units * Math.max(0, Number(outlet.stockCost?.[item.id]) || item.cost);
        remaining -= units;
      });
    }
    outletSales += Math.max(0, Number(outlet.nextNightBonus) || 0);
  });
  ledger.sales += outletSales;
  ledger.food += outletFood;
  ledger.bonus += (Array.isArray(state.outlets) ? state.outlets : []).filter((outlet) => outlet.id !== "main" && outlet.active)
    .reduce((sum, outlet) => sum + Math.max(0, Number(outlet.nextNightBonus) || 0), 0);
  const net = ledgerNet(ledger);
  return { guests, paying, food: paying * averageFood + outletFood, sales: paying * averagePrice + outletSales, tips, bonus, outletSales, ledger, net };
}

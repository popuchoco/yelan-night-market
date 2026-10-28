import { DATA } from "./data.js";
import { CAMPAIGN_DAYS, campaignEntry, campaignCycleDay, isWeeklyDecisionDay, marketCardForDay } from "./campaign.js";
import { createAccountingState, ensureAccounting } from "./accounting.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function freshState() {
  const state = {
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
    equipment: { grill: 0, hood: 0, awning: 0 },
    expansions: 0,
    hiredCrew: 0,
    acquisitions: 0,
    acquisitionTypes: [],
    loanUsed: false,
    loanPrincipal: 0,
    loanTakenDay: 0,
    loanNights: 0,
    marketChoiceDay: 0,
    marketCardChoice: null,
    decisions: [],
    campaignNet: 0,
    endingId: null
  };
  const inventoryValue = DATA.ingredients.reduce((sum, item) => sum + (state.stock[item.id] || 0) * (state.stockCost[item.id] || item.cost), 0);
  state.accounting = createAccountingState({ day: state.day, cash: state.coins, inventory: inventoryValue });
  return state;
}

export function normalizeState(data) {
  const fresh = freshState();
  if (!data || typeof data !== "object" || Array.isArray(data)) return fresh;
  Object.keys(fresh).forEach((key) => {
    if (hasOwn(data, key)) fresh[key] = data[key];
  });
  fresh.staff = Object.assign({ cook: true, server: true }, fresh.staff || {});
  fresh.stock = Object.assign(fresh.stock, data.stock || {});
  fresh.stockCost = Object.assign(fresh.stockCost, data.stockCost || {});
  fresh.equipment = Object.assign(fresh.equipment, data.equipment || {});
  fresh.expansions = Math.max(0, Math.min(9, Number(fresh.expansions) || 0));
  fresh.hiredCrew = Math.max(0, Math.min(6, Number(fresh.hiredCrew) || 0));
  fresh.acquisitions = Math.max(0, Math.min(4, Number(fresh.acquisitions) || 0));
  const validAcquisitionTypes = new Set(["food", "leisure"]);
  fresh.acquisitionTypes = Array.isArray(data.acquisitionTypes)
    ? data.acquisitionTypes.filter((type) => validAcquisitionTypes.has(type)).slice(0, fresh.acquisitions)
    : [];
  // Older saves counted acquired stalls without recording their category.
  // Treat those legacy purchases as food stalls so the new alliance can still
  // be reached instead of permanently locking out the feature.
  while (fresh.acquisitionTypes.length < fresh.acquisitions) fresh.acquisitionTypes.push("food");
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
  }
  if (!Array.isArray(fresh.decisions)) fresh.decisions = [];
  if (!Array.isArray(fresh.journal)) fresh.journal = [];
  if (!Number.isFinite(Number(fresh.campaignNet))) fresh.campaignNet = 0;
  fresh.day = Math.max(1, Math.floor(Number(fresh.day) || 1));
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
  if (!Array.isArray(fresh.journal)) fresh.journal = [];
  if (!fresh.upgrades || typeof fresh.upgrades !== "object") fresh.upgrades = {};
  if (!Number.isFinite(Number(fresh.shiftPurchases))) fresh.shiftPurchases = 0;
  if (fresh.ledger && typeof fresh.ledger === "object") {
    const defaults = createLedger(fresh);
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
      id: "legacy-expansion-" + (index + 1), name: "戶外桌區改建 " + (index + 1),
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

export function loadState(storage = globalThis.localStorage) {
  const fresh = freshState();
  if (!storage) return fresh;
  try {
    const raw = storage.getItem(DATA.saveKey) || storage.getItem(DATA.legacyKey);
    return raw ? normalizeState(JSON.parse(raw)) : fresh;
  } catch {
    return fresh;
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    if (!storage) return false;
    storage.setItem(DATA.saveKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
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
  const counts = (Array.isArray(state.acquisitionTypes) ? state.acquisitionTypes : [])
    .filter((type) => type === "food" || type === "leisure")
    .reduce((result, type) => {
      result[type] = (result[type] || 0) + 1;
      return result;
    }, {});
  return Object.values(counts).some((count) => count >= 2);
}

export function getTonightGuests(state) {
  const deck = DATA.guests;
  const offset = Math.max(0, (state.day - 3) % deck.length);
  const seats = Math.min(8, (Number(state.expansions) || 0) + (Number(state.acquisitions) || 0));
  const guests = Array.from({ length: 3 + seats }, (_, index) => deck[(offset + index) % deck.length]);
  if (hasBrandAlliance(state)) guests.push({ ...deck[offset % deck.length], name: "品牌聯盟・港邊來客", role: "夜市品牌聯盟來客" });
  if (marketCardChoice(state) === "promote") {
    guests.push({ ...deck[offset % deck.length], name: "觀光客・小滿", role: "港區觀光旅人" });
    guests.push({ ...deck[(offset + 1) % deck.length], name: "觀光客・阿拓", role: "港區觀光旅人" });
  }
  const eventId = todayEvent(state).id;
  if (eventId === "festival") guests.push(DATA.festivalGuest);
  if (eventId === "complaint") guests.push(DATA.difficultGuest);
  return guests;
}

export function staffCost(state) {
  return DATA.staff.reduce((sum, person) => sum + (state.staff[person.id] ? person.wage : 0), 0) + (Number(state.hiredCrew) || 0) * 90;
}

export function inspectionFee(state) {
  if (todayEvent(state).id !== "inspection") return 0;
  if (marketCardChoice(state) === "deep-clean") return 0;
  const ready = (Number(state.equipment.hood) || 0) > 0 || (Number(state.equipment.awning) || 0) > 0 || !!state.upgrades.lantern;
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

export function createLedger(state) {
  const event = todayEvent(state);
  const card = todayMarketCard(state);
  const choice = marketCardChoice(state);
  const hood = Number(state.equipment.hood) || 0;
  const awning = Number(state.equipment.awning) || 0;
  const rainElectricity = Math.max(0, DATA.economy.rainElectricity - awning * DATA.economy.awningElectricitySavings);
  const rainGas = Math.max(0, DATA.economy.rainGas - awning * DATA.economy.awningGasSavings);
  const blackout = event.id === "blackout" ? DATA.economy.blackoutSurcharge : 0;
  const fee = inspectionFee(state);
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
    water: Math.max(DATA.economy.minWater, DATA.economy.water),
    electricity: Math.max(DATA.economy.minElectricity, DATA.economy.electricity - hood * DATA.economy.hoodElectricitySavings) + (event.id === "rain" ? rainElectricity : 0) + blackout,
    gas: Math.max(DATA.economy.minGas, DATA.economy.gas - hood * DATA.economy.hoodGasSavings) + (event.id === "rain" ? rainGas : 0),
    fees: fee,
    marketing: card?.id === "tourist-surge" && choice === "promote" ? DATA.economy.touristPromotionCost : 0,
    preparation: card?.id === "hygiene-audit" && choice === "deep-clean" ? DATA.economy.hygieneQuickCleanCost : 0,
    subsidies: card?.id === "rain-subsidy" && choice === "claim" ? DATA.economy.rainSubsidy : 0,
    interest: (Number(state.loanPrincipal) || 0) > 0
      ? Math.round((Number(state.loanNights) + 1) * Number(state.loanPrincipal) * DATA.economy.loanWeeklyRate / 7) -
        Math.round(Number(state.loanNights) * Number(state.loanPrincipal) * DATA.economy.loanWeeklyRate / 7)
      : 0,
    compensation: 0,
    refunds: 0
  };
}

export function ledgerIncome(ledger) {
  return ledger.sales + ledger.tips + ledger.bonus + ledger.storyBonus + (ledger.subsidies || 0);
}

export function fixedOperatingCost(ledger) {
  return ledger.rent + (ledger.expansionRent || 0) + (ledger.acquisitionRent || 0) + ledger.labor +
    (ledger.water || 0) + ledger.electricity + ledger.gas + (ledger.fees || 0) +
    (ledger.marketing || 0) + (ledger.preparation || 0) + (ledger.interest || 0);
}

export function ledgerCosts(ledger) {
  return ledger.food + fixedOperatingCost(ledger) + ledger.compensation + ledger.refunds;
}

export function ledgerNet(ledger) {
  return ledgerIncome(ledger) - ledgerCosts(ledger);
}

export function forecast(state) {
  const guests = getTonightGuests(state);
  const paying = guests.filter((guest) => !guest.difficult).length;
  const averagePrice = Math.round(DATA.dishes.reduce((sum, dish) => sum + dish.price, 0) / DATA.dishes.length);
  const averageFood = Math.round(DATA.dishes.reduce((sum, dish) => sum + getFoodCost(state, dish), 0) / DATA.dishes.length);
  const event = todayEvent(state);
  const baseTips = DATA.economy.baseTip - (state.staff.cook ? 0 : DATA.economy.cookServicePenalty) - (state.staff.server ? 0 : DATA.economy.serverServicePenalty);
  const upgradeTips = (Number(state.equipment.grill) || 0) * DATA.economy.grillTipPerLevel + (state.upgrades["window-seat"] ? DATA.economy.menuTipBonus : 0) + (Number(state.hiredCrew) || 0) * 10;
  const featuredBonus = DATA.dishes[state.selectedDish] ? DATA.economy.featuredDishBonus : 0;
  const tips = paying * (baseTips + upgradeTips + featuredBonus + (event.id === "street-music" ? DATA.economy.streetMusicTip : 0));
  const bonus = event.id === "festival" ? paying * DATA.economy.festivalBonus : 0;
  const ledger = createLedger(state);
  ledger.sales = paying * averagePrice;
  ledger.tips = tips;
  ledger.bonus = bonus;
  ledger.food = paying * averageFood;
  const net = ledgerNet(ledger);
  return { guests, paying, food: paying * averageFood, sales: paying * averagePrice, tips, bonus, ledger, net };
}

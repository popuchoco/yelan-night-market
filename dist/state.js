import { DATA } from "./data.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function freshState() {
  return {
    day: 3,
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
    equipment: { grill: 0, hood: 0, awning: 0 }
  };
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
  if (!Array.isArray(fresh.results)) fresh.results = [];
  if (!Array.isArray(fresh.journal)) fresh.journal = [];
  if (!fresh.upgrades || typeof fresh.upgrades !== "object") fresh.upgrades = {};
  if (!Number.isFinite(Number(fresh.shiftPurchases))) fresh.shiftPurchases = 0;
  if ((fresh.phase === "service" || fresh.phase === "report") && !fresh.ledger) {
    fresh.phase = "prep";
    fresh.customerIndex = 0;
    fresh.revenue = 0;
    fresh.results = [];
    fresh.reportChoice = null;
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
  const index = ((state.day - 3) % DATA.events.length + DATA.events.length) % DATA.events.length;
  return DATA.events[index];
}

export function todayStory(state) {
  const index = ((state.day - 3) % DATA.stories.length + DATA.stories.length) % DATA.stories.length;
  return DATA.stories[index];
}

export function getTonightGuests(state) {
  const deck = DATA.guests;
  const offset = Math.max(0, (state.day - 3) % deck.length);
  const guests = [deck[offset], deck[(offset + 1) % deck.length], deck[(offset + 2) % deck.length]];
  const eventId = todayEvent(state).id;
  if (eventId === "festival") guests.push(DATA.festivalGuest);
  if (eventId === "complaint") guests.push(DATA.difficultGuest);
  return guests;
}

export function staffCost(state) {
  return DATA.staff.reduce((sum, person) => sum + (state.staff[person.id] ? person.wage : 0), 0);
}

export function getPurchasePrice(state, item) {
  const event = todayEvent(state);
  const modifier = event.id === "supplier" ? DATA.economy.supplierMarkup : (event.id === "market-sale" ? DATA.economy.marketDiscount : 1);
  return Math.round(item.cost * modifier);
}

export function getFoodCost(state, dish) {
  const value = Number(state.stockCost[dish.ingredient]);
  return Math.round(Number.isFinite(value) ? value : dish.cost);
}

export function createLedger(state) {
  const event = todayEvent(state);
  const hood = Number(state.equipment.hood) || 0;
  const awning = Number(state.equipment.awning) || 0;
  const rainElectricity = Math.max(0, DATA.economy.rainElectricity - awning * DATA.economy.awningElectricitySavings);
  const rainGas = Math.max(0, DATA.economy.rainGas - awning * DATA.economy.awningGasSavings);
  const blackout = event.id === "blackout" ? DATA.economy.blackoutSurcharge : 0;
  return {
    sales: 0,
    tips: 0,
    bonus: 0,
    storyBonus: 0,
    food: 0,
    purchase: state.shiftPurchases || 0,
    rent: DATA.economy.rent,
    labor: staffCost(state),
    electricity: Math.max(DATA.economy.minElectricity, DATA.economy.electricity - hood * DATA.economy.hoodElectricitySavings) + (event.id === "rain" ? rainElectricity : 0) + blackout,
    gas: Math.max(DATA.economy.minGas, DATA.economy.gas - hood * DATA.economy.hoodGasSavings) + (event.id === "rain" ? rainGas : 0),
    compensation: 0,
    refunds: 0
  };
}

export function ledgerIncome(ledger) {
  return ledger.sales + ledger.tips + ledger.bonus + ledger.storyBonus;
}

export function ledgerCosts(ledger) {
  return ledger.food + ledger.rent + ledger.labor + ledger.electricity + ledger.gas + ledger.compensation + ledger.refunds;
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
  const upgradeTips = (Number(state.equipment.grill) || 0) * DATA.economy.grillTipPerLevel + (state.upgrades["window-seat"] ? DATA.economy.menuTipBonus : 0);
  const featuredBonus = DATA.dishes[state.selectedDish] ? DATA.economy.featuredDishBonus : 0;
  const tips = paying * (baseTips + upgradeTips + featuredBonus + (event.id === "street-music" ? DATA.economy.streetMusicTip : 0));
  const bonus = event.id === "festival" ? paying * DATA.economy.festivalBonus : 0;
  const ledger = createLedger(state);
  const net = paying * averagePrice + tips + bonus - ledger.rent - ledger.labor - ledger.electricity - ledger.gas - paying * averageFood;
  return { guests, paying, food: paying * averageFood, sales: paying * averagePrice, tips, bonus, ledger, net };
}

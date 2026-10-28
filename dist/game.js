import { DATA, createOutletInventory, getOutletProduct, outletAvailableStock, outletRetailPrice } from "./data.js";
import { ACQUISITION_TYPES, ENDINGS, WEEKLY_OPTIONS, isWeeklyDecisionDay, selectEnding, weeklyOptionCost } from "./campaign.js";
import {
  createLedger, fixedOperatingCost, getFoodCost, getPurchasePrice, getTonightGuests, hasBrandAlliance,
  ledgerIncome, ledgerNet, freshState, loadState, marketCardChoice, money, saveState, staffCost,
  todayEvent, todayMarketCard, todayStory
} from "./state.js";
import { createScene } from "./scene.js";
import { createUI } from "./ui.js";
import {
  closeDepreciation, closeMonthlyStatements, closeWeeklyWorksheet,
  recordAssetPurchase, recordExpense, recordInventoryPurchase, recordLoanDraw,
  recordLoanRepayment, recordOperatingClose, recordRefund, recordSale
} from "./accounting.js";

const capAt = (value, max) => Math.min(max, value);

export function createGameEngine(state) {
  const guests = () => getTonightGuests(state);
  const event = () => todayEvent(state);
  const response = (ok, message, changed = ok) => ({ ok, changed, message });

  function openDoors() {
    if (state.phase !== "prep") return response(false, "現在不是開門準備時段。");
    if (todayMarketCard(state) && !marketCardChoice(state)) return response(false, "先處理今晚的市集公告卡，再掛燈迎客。", false);
    if (state.managerEvent) return response(false, "先處理店長送來的重大營運事件，再開始今晚營業。", false);
    state.phase = "service";
    state.customerIndex = 0;
    state.revenue = 0;
    state.results = [];
    state.reportChoice = null;
    state.ledger = createLedger(state);
    simulateOutletOperations();
    const fixed = fixedOperatingCost(state.ledger);
    state.coins -= fixed;
    state.coins += state.ledger.subsidies || 0;
    recordOperatingClose(state, state.ledger);
    if (state.loanPrincipal > 0) state.loanNights = (Number(state.loanNights) || 0) + 1;
    if (state.ledger.fees) state.fame = Math.max(0, state.fame - 2);
    else if (event().id === "inspection") state.fame = capAt(state.fame + 1, 100);
    if (marketCardChoice(state) === "promote" || marketCardChoice(state) === "deep-clean") state.fame = capAt(state.fame + 1, 100);
    return response(true, "租金、人事、能源與活動費用 " + money(fixed) + " 已扣。街口有人往你的燈牌走來。");
  }

  function chooseMarketCard(choiceId) {
    if (state.phase !== "prep") return response(false, "市集公告卡只能在開門前處理。", false);
    const card = todayMarketCard(state);
    if (!card) return response(false, "今晚沒有新的市集公告卡。", false);
    if (state.marketChoiceDay === state.day) return response(false, "今晚的市集公告已經選定。", false);
    const choice = card.choices.find((item) => item.id === choiceId);
    if (!choice) return response(false, "找不到這項公告卡選擇。", false);
    if (choice.cost > 0 && state.coins < choice.cost) return response(false, "現金不足，無法採用這項公告卡方案。", false);
    state.marketChoiceDay = state.day;
    state.marketCardChoice = choice.id;
    return response(true, "已選擇「" + choice.name + "」：" + choice.detail + "。今晚開門時會依選項入帳。");
  }

  function borrowWorkingCapital() {
    if (state.phase !== "decision") return response(false, "週轉金只能在每週經營決策時申請。", false);
    if (state.loanUsed || state.loanPrincipal > 0) return response(false, "本周目已使用過週轉額度，請先依計畫償還。", false);
    const principal = DATA.economy.loanPrincipal;
    state.loanUsed = true;
    state.loanPrincipal = principal;
    state.loanTakenDay = state.day;
    state.coins += principal;
    recordLoanDraw(state, principal);
    return response(true, "銀行核准低利週轉金 +" + money(principal) + "。未償本金每營業夜計息，週轉決策時可提前還清。");
  }

  function repayWorkingCapital() {
    if (state.phase !== "decision") return response(false, "請在週轉決策時償還本金。", false);
    if (!(Number(state.loanPrincipal) > 0)) return response(false, "目前沒有待償還的週轉本金。", false);
    if (state.loanTakenDay && state.day <= state.loanTakenDay) return response(false, "至少完成一夜營業後，才能在下一次週轉決策還款。", false);
    if (state.coins < state.loanPrincipal) return response(false, "現金不足，無法一次還清週轉本金。", false);
    const principal = state.loanPrincipal;
    state.coins -= principal;
    state.loanPrincipal = 0;
    recordLoanRepayment(state, principal);
    return response(true, "已償還週轉本金 " + money(principal) + "；之後不再計息。利息已按營業夜列入帳本。");
  }

  function serveDish(id) {
    if (state.phase !== "service") return response(false, "目前沒有營業中的訂單。", false);
    const dish = DATA.dishes.find((item) => item.id === id);
    const guest = guests()[state.customerIndex];
    if (!dish || !guest || guest.difficult) return response(false, "這位客人目前不能點這道料理。", false);
    const ingredient = dish.ingredient;
    if (Number(state.stock[ingredient]) <= 0) return response(false, "這份備料已用完；打烊後先補貨再販售。", false);

    const good = dish.need.includes(guest.need);
    const economy = DATA.economy;
    let tip = good ? economy.goodMatchTip : economy.standardTip;
    tip += (Number(state.equipment.grill) || 0) * economy.grillTipPerLevel;
    if (state.upgrades["window-seat"]) tip += economy.menuTipBonus;
    if (event().id === "street-music") tip += economy.streetMusicTip;
    tip += (Number(state.hiredCrew) || 0) * 10;
    tip = Math.max(0, tip - (state.staff.cook ? 0 : economy.cookServicePenalty) - (state.staff.server ? 0 : economy.serverServicePenalty));
    const featured = state.selectedDish === DATA.dishes.indexOf(dish);
    const menuBonus = featured ? economy.featuredDishBonus : 0;
    const eventBonus = event().id === "festival" ? economy.festivalBonus : 0;
    const cost = getFoodCost(state, dish);
    state.stock[ingredient] = Math.max(0, Number(state.stock[ingredient]) - 1);
    state.coins += dish.price + tip + menuBonus + eventBonus;
    state.revenue += dish.price + tip + menuBonus + eventBonus;
    state.ledger.sales += dish.price;
    state.ledger.tips += tip + menuBonus;
    state.ledger.bonus += eventBonus;
    state.ledger.food += cost;
    recordSale(state, { dishName: dish.name, price: dish.price, serviceIncome: tip + menuBonus, otherIncome: eventBonus, foodCost: cost });

    const score = good ? ((state.staff.cook && state.staff.server) || state.hiredCrew > 0 ? 100 : 84) : 68;
    state.fame += good ? (score >= 90 ? 2 : 1) : 1;
    if (good) {
      state.cozy = capAt(state.cozy + 2, 100);
      if (score >= 90) state.regulars = capAt(state.regulars + 1, 24);
    }
    state.results.push({ name: guest.name, icon: guest.icon, score, reaction: good ? (score >= 90 ? "剛剛好" : "老闆忙中代班") : "也不錯", mood: guest.mood, good, dish: dish.name });
    state.customerIndex += 1;
    if (state.customerIndex >= guests().length) state.phase = "report";
    const eventText = eventBonus ? "燈節 Bonus +" + money(eventBonus) + "。 " : "";
    return response(true, eventText + (good ? guest.name + "吃得滿足，留下了一句謝謝。" : guest.name + "收下餐點，安靜地笑了笑。"));
  }

  function resolveComplaint(choice) {
    if (state.phase !== "service") return response(false, "目前沒有待處理的客訴。", false);
    const guest = guests()[state.customerIndex];
    if (!guest || !guest.difficult) return response(false, "這位客人沒有提出客訴。", false);
    let score = 65;
    let reaction = "守住界線";
    const economy = DATA.economy;
    if (choice === "calm") state.fame = Math.max(0, state.fame - 1);
    else if (choice === "snack") {
      state.coins -= economy.complaintSnackCost;
      state.ledger.compensation += economy.complaintSnackCost;
      recordExpense(state, "5500", "客訴補償｜招待小菜", economy.complaintSnackCost);
      state.fame += 1;
      state.cozy = capAt(state.cozy + 1, 100);
      score = 92;
      reaction = "小菜化解客訴";
    } else if (choice === "refund") {
      state.coins -= economy.complaintRefund;
      state.ledger.refunds += economy.complaintRefund;
      recordRefund(state, economy.complaintRefund);
      score = 76;
      reaction = "退款後平和離店";
    } else return response(false, "請選擇一種客訴處理方式。", false);
    state.results.push({ name: guest.name, icon: guest.icon, score, reaction, mood: guest.mood, good: score >= 90 });
    state.customerIndex += 1;
    if (state.customerIndex >= guests().length) state.phase = "report";
    const messages = {
      snack: "小菜已記入客訴補償，口碑回升。",
      refund: "部分退款已記入帳本。",
      calm: "你冷靜說明了原委，守住界線。"
    };
    return response(true, messages[choice]);
  }

  function buyStock(id) {
    if (state.phase !== "prep") return response(false, "開門後不能再補貨。", false);
    const item = DATA.ingredients.find((ingredient) => ingredient.id === id);
    if (!item) return response(false, "找不到這項食材。", false);
    const price = getPurchasePrice(state, item);
    if (state.coins < price) return response(false, "現金不足，暫時無法補貨。", false);
    const qty = Number(state.stock[id]) || 0;
    const oldCost = Number(state.stockCost[id]) || item.cost;
    state.stockCost[id] = Math.round((qty * oldCost + price) / (qty + 1));
    state.stock[id] = qty + 1;
    state.coins -= price;
    state.shiftPurchases = (state.shiftPurchases || 0) + price;
    recordInventoryPurchase(state, item.name, price);
    return response(true, item.name + "補進 1 份，採購 " + money(price) + " 已記入庫存現金流。");
  }

  function upgradeEquipment(id) {
    if (state.phase !== "prep") return response(false, "開門後不能施工。", false);
    const item = DATA.equipment.find((equipment) => equipment.id === id);
    if (!item) return response(false, "找不到這項設備。", false);
    const level = Number(state.equipment[id]) || 0;
    const price = item.costs[level];
    if (typeof price !== "number" || state.coins < price) return response(false, "現金不足，或設備已經滿級。", false);
    state.coins -= price;
    state.equipment[id] = level + 1;
    recordAssetPurchase(state, {
      id: "equipment-" + id + "-" + (level + 1) + "-day-" + state.day,
      name: item.name + " Lv." + (level + 1), cost: price,
      usefulLifeDays: DATA.accounting.equipmentUsefulLifeDays,
      residualValue: Math.round(price * DATA.accounting.equipmentResidualRate)
    });
    return response(true, item.name + "升至 Lv." + (level + 1) + "，模型與營運效果已更新。");
  }

  function buyUpgrade(id) {
    if (state.phase !== "prep") return response(false, "開門後不能改造。", false);
    const item = DATA.upgrades.find((upgrade) => upgrade.id === id);
    if (!item || state.upgrades[id] || state.coins < item.cost) return response(false, "現金不足，或這項改造已經添置。", false);
    state.coins -= item.cost;
    state.upgrades[id] = true;
    recordAssetPurchase(state, {
      id: "upgrade-" + id + "-day-" + state.day,
      name: item.name, cost: item.cost, usefulLifeDays: DATA.accounting.improvementUsefulLifeDays,
      residualValue: Math.round(item.cost * DATA.accounting.improvementResidualRate)
    });
    if (id === "lantern") state.cozy = capAt(state.cozy + 8, 100);
    if (id === "old-radio") state.fame += 6;
    return response(true, item.name + "已添置，夜市多了一個讓人留下來的理由。");
  }

  function toggleStaff(role) {
    if (state.phase !== "prep" || !Object.prototype.hasOwnProperty.call(state.staff, role)) return response(false, "目前不能調整這個班表。", false);
    state.staff[role] = !state.staff[role];
    return response(true, state.staff[role] ? "已加入今晚班表。" : "改由老闆代班，薪資省下但服務小費會下降。");
  }

  function findOutlet(outletId) {
    return (Array.isArray(state.outlets) ? state.outlets : []).find((outlet) => outlet.id === outletId && outlet.id !== "main");
  }

  function buyOutletStock(outletId, stockId) {
    if (state.phase !== "prep") return response(false, "分店備料只能在開門前處理。", false);
    const outlet = findOutlet(outletId);
    if (!outlet) return response(false, "找不到這間分店。", false);
    const product = getOutletProduct(outlet.type);
    const item = product.legacyMixed
      ? DATA.ingredients.find((ingredient) => ingredient.id === stockId)
      : (product.stockId === stockId ? product : null);
    if (!item) return response(false, "這間分店不能採購該項備料。", false);
    const price = getPurchasePrice(state, item);
    if (state.coins < price) return response(false, "現金不足，暫時無法補進分店備料。", false);
    const quantity = Math.max(0, Number(outlet.stock[stockId]) || 0);
    const oldCost = Math.max(0, Number(outlet.stockCost[stockId]) || item.cost);
    outlet.stockCost[stockId] = Math.round((quantity * oldCost + price) / (quantity + 1));
    outlet.stock[stockId] = quantity + 1;
    state.coins -= price;
    state.shiftPurchases = (state.shiftPurchases || 0) + price;
    recordInventoryPurchase(state, outlet.name + "｜" + item.name, price);
    return response(true, outlet.name + "補進 1 份" + item.name + "，已列入存貨與現金流。");
  }

  function toggleOutlet(outletId) {
    if (state.phase !== "prep") return response(false, "分店營業狀態只能在開門前調整。", false);
    const outlet = findOutlet(outletId);
    if (!outlet) return response(false, "找不到這間分店。", false);
    if (!outlet.active) {
      const available = outletAvailableStock(outlet);
      if (!available) return response(false, "先補進至少一份營運備料，才能開啟分店。", false);
      outlet.active = true;
      outlet.autoPaused = false;
      return response(true, outlet.name + "已開門；" + (outlet.manager ? "店長會自動排班與營運。" : "目前由你兼顧，分店每夜最多接待一筆生意。"));
    }
    outlet.active = false;
    outlet.autoPaused = false;
    return response(true, outlet.name + "今晚暫停營業；已聘店長的薪資仍會照常列帳。");
  }

  function dismissOutletManager(outletId) {
    if (state.phase !== "prep") return response(false, "店長人事只能在開門前調整。", false);
    const outlet = findOutlet(outletId);
    if (!outlet || !outlet.manager) return response(false, "這間分店目前沒有受聘店長。", false);
    outlet.manager = false;
    return response(true, outlet.name + "已改由你親自照看；往後每夜店長薪資停止，但接待量回到每夜一筆。");
  }

  function upgradeOutletEquipment(outletId) {
    if (state.phase !== "prep") return response(false, "分店設備只能在開門前添購。", false);
    const outlet = findOutlet(outletId);
    if (!outlet) return response(false, "找不到這間分店。", false);
    const level = Number(outlet.equipmentLevel) || 0;
    const cost = DATA.economy.outletEquipmentCosts[level];
    if (typeof cost !== "number") return response(false, "這間分店的營運設備已達最高級。", false);
    if (state.coins < cost) return response(false, "現金不足，無法添購分店設備。", false);
    state.coins -= cost;
    outlet.equipmentLevel = level + 1;
    recordAssetPurchase(state, { id: outlet.id + "-equipment-" + (level + 1) + "-day-" + state.day,
      name: outlet.name + "｜營運設備 Lv." + (level + 1), cost,
      usefulLifeDays: DATA.accounting.equipmentUsefulLifeDays,
      residualValue: Math.round(cost * DATA.accounting.equipmentResidualRate) });
    return response(true, outlet.name + "設備升至 Lv." + (level + 1) + "；自動營運的單筆收入提高。");
  }

  function hireOutletManager(outletId) {
    if (state.phase !== "decision") return response(false, "店長招聘安排在每週經營決策時處理。", false);
    if (state.managerEvent) return response(false, "先決定如何處理店長回報的重大事件。", false);
    const outlet = findOutlet(outletId);
    if (!outlet) return response(false, "找不到這間分店。", false);
    const operatingLocations = 1 + (Array.isArray(state.outlets) ? state.outlets.filter((item) => item.id !== "main" && item.active).length : 0);
    if (operatingLocations < 2) return response(false, "至少要有兩間營業中的店家，才能建立店長職缺。", false);
    if (!outlet.active) return response(false, "分店目前尚未開門，先備料並開始營業，再聘請店長。", false);
    if (outlet.manager) return response(false, "這間分店已經有店長。", false);
    const cost = DATA.economy.managerHireCost + (state.outlets.filter((item) => item.manager).length * 140);
    if (state.coins < cost) return response(false, "現金不足，無法支付店長招募與訓練費。", false);
    state.coins -= cost;
    outlet.manager = true;
    recordExpense(state, "5110", "招募與訓練｜" + outlet.name + "店長", cost);
    state.decisions.push({ day: state.day, id: "manager", name: "聘請店長｜" + outlet.name, cost, outletId: outlet.id });
    state.phase = "prep";
    state.selectedDish = (state.day - 1) % DATA.dishes.length;
    return response(true, outlet.name + "店長到任：往後每夜薪資 " + money(DATA.economy.managerWage) + "，可自動排班、補足出餐並處理日常營運；重大事件仍由你拍板。");
  }

  function resolveManagerEvent(choice) {
    if (state.phase !== "decision" || !state.managerEvent) return response(false, "目前沒有待決定的店長事件。", false);
    const incident = state.managerEvent;
    const outlet = findOutlet(incident.outletId);
    if (!outlet) { state.managerEvent = null; return response(false, "事件所屬分店已不存在，已清除此筆事件。", false); }
    if (incident.type === "equipment" && choice === "repair") {
      const cost = 85;
      if (state.coins < cost) return response(false, "現金不足；可選擇讓分店先以降載方式營業。", false);
      state.coins -= cost;
      recordExpense(state, "5400", "設備維護｜" + outlet.name, cost);
      outlet.efficiencyPenalty = 0;
    } else if (incident.type === "equipment" && choice === "defer") {
      outlet.efficiencyPenalty = 1;
    } else if (incident.type === "complaint" && choice === "compensate") {
      const cost = 55;
      if (state.coins < cost) return response(false, "現金不足，請選擇由店長說明處理。", false);
      state.coins -= cost;
      recordExpense(state, "5500", "分店客訴補償｜" + outlet.name, cost);
      outlet.reputation = capAt(outlet.reputation + 3, 100);
    } else if (incident.type === "complaint" && choice === "explain") {
      outlet.reputation = Math.max(0, outlet.reputation - 2);
    } else if (incident.type === "festival" && choice === "promote") {
      const cost = 70;
      if (state.coins < cost) return response(false, "現金不足，無法支付分店慶典宣傳費。", false);
      state.coins -= cost;
      recordExpense(state, "5410", "分店慶典宣傳｜" + outlet.name, cost);
      outlet.nextNightBonus = (Number(outlet.nextNightBonus) || 0) + 130;
    } else if (incident.type === "festival" && choice === "decline") {
      outlet.nextNightBonus = 0;
    } else return response(false, "請選擇一項重大事件處理方式。", false);
    state.managerEvent = null;
    return response(true, outlet.name + "的重大事件已依你的決策處理；一般營運仍由店長自動進行。");
  }

  function simulateOutletOperations() {
    (Array.isArray(state.outlets) ? state.outlets : []).filter((outlet) => outlet.id !== "main").forEach((outlet) => {
      const wasActive = !!outlet.active;
      let sales = 0;
      let food = 0;
      let units = 0;
      if (outlet.active) {
        const capacity = outlet.manager ? (outlet.efficiencyPenalty > 0 ? 1 : 2) : 1;
        const product = getOutletProduct(outlet.type);
        for (let index = 0; index < capacity; index++) {
          let supply;
          let supplyName;
          let price = outletRetailPrice(outlet);
          let unitCost;
          if (product.legacyMixed) {
            const item = DATA.ingredients.find((ingredient) => (Number(outlet.stock[ingredient.id]) || 0) > 0);
            if (!item) break;
            supply = item.id;
            supplyName = item.name;
            unitCost = item.cost;
          } else {
            if (outletAvailableStock(outlet) <= 0) break;
            supply = product.stockId;
            supplyName = product.productName;
            unitCost = product.cost;
          }
          const cost = Math.max(0, Number(outlet.stockCost[supply]) || unitCost);
          outlet.stock[supply] = Math.max(0, (Number(outlet.stock[supply]) || 0) - 1);
          state.coins += price;
          state.ledger.sales += price;
          state.ledger.food += cost;
          sales += price;
          food += cost;
          units += 1;
          recordSale(state, { dishName: outlet.name + "｜" + supplyName, price, foodCost: cost });
        }
        const bonus = Math.max(0, Number(outlet.nextNightBonus) || 0);
        if (bonus) {
          state.coins += bonus;
          state.ledger.bonus += bonus;
          sales += bonus;
          recordSale(state, { dishName: outlet.name + "｜活動 Bonus", otherIncome: bonus });
        }
        outlet.nextNightBonus = 0;
        const remainingStock = outletAvailableStock(outlet);
        if (remainingStock <= 0) {
          outlet.active = false;
          outlet.autoPaused = true;
        }
      }
      outlet.efficiencyPenalty = 0;
      outlet.lastResult = {
        day: state.day, units, sales,
        food, utilities: wasActive ? DATA.economy.outletUtilities : 0,
        managerPayroll: outlet.manager ? DATA.economy.managerWage : 0,
        rent: 38,
        net: sales - food - (wasActive ? DATA.economy.outletUtilities : 0) - (outlet.manager ? DATA.economy.managerWage : 0) - 38
      };
    });
  }

  function selectDish(index) {
    if (state.phase !== "prep") return response(false, "開門後不能更換招牌菜。", false);
    const selected = Number(index);
    if (!Number.isInteger(selected) || selected < 0 || selected >= DATA.dishes.length) return response(false, "找不到這道招牌菜。", false);
    state.selectedDish = selected;
    return response(true, DATA.dishes[selected].name + "設為今晚招牌。");
  }

  function chooseStory(id) {
    if (state.phase !== "report" || state.reportChoice) return response(false, "先完成今晚的結算選擇。", false);
    if (id !== "paperboat" && id !== "window") return response(false, "找不到這個手記選項。", false);
    state.reportChoice = id;
    if (id === "paperboat") state.fame += 2;
    if (id === "window") {
      state.regulars = capAt(state.regulars + 1, 24);
      state.coins += 80;
      state.revenue += 80;
      state.ledger.storyBonus += 80;
      recordSale(state, { dishName: "熟客心意", otherIncome: 80 });
    }
    return response(true, id === "paperboat" ? "紙船漂進港灣，手記多了一頁。" : "替熟客留了窗邊桌，收到 NT$ 80 心意。");
  }

  function chooseWeeklyDecision(id, targetType = "fish") {
    if (state.phase !== "decision") return response(false, "目前不是本週投資決策時段。", false);
    if (state.managerEvent) return response(false, "先處理店長回報的重大營運事件，再決定本週投資。", false);
    const option = WEEKLY_OPTIONS[id];
    const cost = weeklyOptionCost(state, id);
    if (!option || cost === null) return response(false, "這項發展已達目前場景容量，請選其他方向。", false);
    if (cost > 0 && state.coins < cost) return response(false, "現金不足，請選擇暫不投資或其他負擔較低的方向。", false);
    if (id === "acquire" && !Object.prototype.hasOwnProperty.call(ACQUISITION_TYPES, targetType)) return response(false, "請選擇要接手的攤位類型。", false);
    const allianceBefore = hasBrandAlliance(state);
    state.coins -= cost;
    if (id === "expand") {
      state.expansions += 1;
      state.cozy = capAt(state.cozy + 5, 100);
      recordAssetPurchase(state, { id: "expansion-" + state.expansions + "-day-" + state.day, name: "戶外桌區改建 " + state.expansions, cost,
        usefulLifeDays: DATA.accounting.improvementUsefulLifeDays });
    } else if (id === "hire") {
      state.hiredCrew += 1;
      state.fame = capAt(state.fame + 2, 100);
      recordExpense(state, "5110", "招募與訓練｜新增夥伴", cost);
    } else if (id === "acquire") {
      state.acquisitions += 1;
      state.acquisitionTypes.push(targetType);
      const inventory = createOutletInventory();
      state.outlets.push({ id: "acquired-" + state.acquisitions,
        name: ACQUISITION_TYPES[targetType].name + "・分店 " + state.acquisitions, type: targetType,
        active: false, manager: false, equipmentLevel: 0, stock: inventory.stock, stockCost: inventory.stockCost, nextNightBonus: 0,
        efficiencyPenalty: 0, reputation: 50, autoPaused: false, lastResult: null });
      state.fame = capAt(state.fame + 5, 100);
      state.regulars = capAt(state.regulars + 1, 24);
      recordAssetPurchase(state, { id: "concession-" + state.acquisitions + "-day-" + state.day,
        name: "攤位經營權｜" + ACQUISITION_TYPES[targetType].name, cost,
        usefulLifeDays: DATA.accounting.concessionUsefulLifeDays, category: "intangible" });
    }
    const targetName = id === "acquire" ? ACQUISITION_TYPES[targetType].name : null;
    const decisionName = targetName ? option.name + "・" + targetName : option.name;
    state.decisions.push({ day: state.day, id, name: decisionName, cost, ...(targetName ? { targetType } : {}) });
    state.phase = "prep";
    state.selectedDish = (state.day - 1) % DATA.dishes.length;
    if (!allianceBefore && hasBrandAlliance(state)) return response(true, "夜市品牌聯盟成立：每夜多一桌聯盟來客，聯合採購享進價 9 折。");
    return response(true, id === "hold" ? "保留現金，照目前規模進入新的一週。" : decisionName + "已完成，往後每夜固定成本與客流效果同步更新。");
  }

  function nextNight() {
    if (state.phase !== "report" || !state.reportChoice) return response(false, "先完成今晚的打烊選擇。", false);
    const finishedDay = state.day;
    const net = ledgerNet(state.ledger);
    const marketCard = todayMarketCard(state);
    const selectedMarketChoice = marketCard
      ? marketCard.choices.find((choice) => choice.id === marketCardChoice(state))
      : null;
    state.journal.unshift({ day: state.day, event: event().name, title: todayStory(state).title,
      choice: state.reportChoice === "paperboat" ? "把紙船放回港灣" : "替熟客留了一張窗邊桌",
      marketCard: marketCard ? marketCard.name : null,
      marketChoice: selectedMarketChoice ? selectedMarketChoice.name : null,
      net, guests: state.results.map((result) => result.name) });
    state.journal = state.journal.slice(0, 30);
    state.campaignNet = (Number(state.campaignNet) || 0) + net;
    closeDepreciation(state, finishedDay);
    const monthlyClose = finishedDay % 30 === 0 ? closeMonthlyStatements(state, finishedDay) : null;
    if (monthlyClose) {
      monthlyClose.outcomeId = selectEnding({ ...state, campaignNet: monthlyClose.totals.profit });
      monthlyClose.outcome = ENDINGS[monthlyClose.outcomeId];
    }
    const weeklyClose = finishedDay % 7 === 0 ? closeWeeklyWorksheet(state, finishedDay) : null;
    state.customerIndex = 0;
    state.revenue = 0;
    state.results = [];
    state.reportChoice = null;
    state.ledger = null;
    state.shiftPurchases = 0;
    state.marketChoiceDay = 0;
    state.marketCardChoice = null;
    state.day = finishedDay + 1;
    const weeklyDecision = isWeeklyDecisionDay(state.day);
    state.phase = weeklyDecision ? "decision" : "prep";
    if (weeklyDecision && state.outlets.some((outlet) => outlet.id !== "main" && outlet.manager && outlet.active)) {
      const managerBranches = state.outlets.filter((outlet) => outlet.id !== "main" && outlet.manager && outlet.active);
      const outlet = managerBranches[Math.floor((state.day / 7) % managerBranches.length)];
      const type = ["equipment", "complaint", "festival"][Math.floor((state.day - 8) / 7) % 3];
      const incidents = {
        equipment: { title: "設備開始異音", description: outlet.name + "回報營運設備運轉不穩。要安排打烊後維修，或讓店長下週先降載營運？", choices: [{ id: "repair", name: "安排維修・NT$ 85" }, { id: "defer", name: "暫緩處理・下週少接一單" }] },
        complaint: { title: "分店客訴升級", description: outlet.name + "遇到一位不滿排隊安排的客人。由總部核准補償，或請店長當面說明？", choices: [{ id: "compensate", name: "核准補償・NT$ 55・口碑回升" }, { id: "explain", name: "由店長說明・不支出" }] },
        festival: { title: "收到慶典合作邀約", description: outlet.name + "獲邀參與下週夜市慶典；可以投入宣傳換取營收 Bonus，或維持日常節奏。", choices: [{ id: "promote", name: "接受邀約・NT$ 70・下夜 Bonus +NT$ 130" }, { id: "decline", name: "婉拒邀約・不增加成本" }] }
      };
      state.managerEvent = { ...incidents[type], id: "manager-event-" + state.day, type, outletId: outlet.id };
    }
    state.selectedDish = (state.day - 1) % DATA.dishes.length;
    if (monthlyClose) return response(true, "第 " + monthlyClose.period + " 期已結帳，財務報表與本期故事走向「" + monthlyClose.outcome.title + "」已歸檔。夜市持續營業，第 " + state.day + " 夜開始。" + (weeklyClose?.balanced ? " 本週試算平衡。" : ""));
    if (weeklyClose) return response(true, "第 " + weeklyClose.week + " 週工作底稿已歸檔，試算" + (weeklyClose.balanced ? "平衡" : "待核對") + "；新的一週開始前，請選擇經營方向。");
    return response(true, weeklyDecision
      ? "第 " + (state.day - 1) + " 夜結束。新的一週開始前，選擇擴大店家、招聘人手、併購攤販，或暫時保留現金。"
      : "新的一晚開始了，港邊又亮起幾盞燈。");
  }

  function restartCampaign() {
    const fresh = freshState();
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
    return response(true, "新的夜市世界已開張。先備料、排班，再掛燈迎客。");
  }

  return { openDoors, chooseMarketCard, borrowWorkingCapital, repayWorkingCapital, serveDish, resolveComplaint, buyStock, upgradeEquipment, buyUpgrade, toggleStaff, selectDish, chooseStory, chooseWeeklyDecision, nextNight, restartCampaign,
    buyOutletStock, toggleOutlet, upgradeOutletEquipment, hireOutletManager, dismissOutletManager, resolveManagerEvent,
    getEvent: event, getGuests: guests, getStaffCost: () => staffCost(state), getIncome: () => state.ledger ? ledgerIncome(state.ledger) : 0 };
}

function boot() {
  const state = loadState();
  const engine = createGameEngine(state);
  let toastTimer = 0;
  let lastFrame = 0;
  let audioContext = null;
  let soundEnabled = false;
  try { soundEnabled = localStorage.getItem("yelan-sound-enabled") === "true"; } catch {}
  const ui = createUI({ state, saveState });
  const scene = createScene({ state, todayEvent: () => todayEvent(state), getTonightGuests: () => getTonightGuests(state) });
  let orderReturnFocus = null;
  let reportReturnFocus = null;

  function playTone(kind = "tap") {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      audioContext = audioContext || new AudioContext();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const frequency = kind === "success" ? 660 : (kind === "open" ? 520 : 390);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.17);
    } catch {}
  }

  function syncMotionControl() {
    const button = document.querySelector('[data-action="toggle-pause"]');
    if (!button) return;
    button.disabled = scene.motionReduced;
    button.setAttribute("aria-pressed", String(scene.motionReduced || scene.paused));
    button.textContent = scene.motionReduced ? "低動態：依系統" : (scene.paused ? "▶ 恢復場景" : "Ⅱ 暫停場景");
    button.title = scene.motionReduced ? "已依作業系統減少動態效果" : "暫停或恢復夜市場景動畫";
  }
  function renderUI() { ui.renderUI(); syncMotionControl(); syncWorldEventTrigger(); syncOutletEventTriggers(); }
  const reportDialog = document.getElementById("reportDialog");
  const reportDialogContent = document.getElementById("reportDialogContent");
  const worldEventDialog = document.getElementById("worldEventDialog");
  const worldEventDialogContent = document.getElementById("worldEventDialogContent");
  const storyChoiceDialog = document.getElementById("storyChoiceDialog");
  const storyChoiceContent = document.getElementById("storyChoiceContent");
  let worldEventReturnFocus = null;
  let storyChoiceReturnFocus = null;
  let worldEventPosition = "";
  const outletEventButtons = new Map();
  function syncWorldEventTrigger() {
    const trigger = document.getElementById("worldEventTrigger");
    const info = ui.getWorldEventInfo();
    if (!trigger || !info) return;
    document.getElementById("worldEventIcon").textContent = info.icon || "⚑";
    document.getElementById("worldEventLabel").textContent = info.label;
    document.getElementById("worldEventTitle").textContent = info.title;
    trigger.dataset.tone = info.tone || "positive";
    trigger.dataset.pending = String(!!info.pending);
    trigger.dataset.outletId = info.anchorOutletId || "main";
    trigger.setAttribute("aria-label", (info.pending ? "待處理：" : "查看：") +
      (info.anchorOutletName ? info.anchorOutletName + "・" : "") + info.title + "。開啟夜市事件視窗");
    const point = scene.eventAnchor(info.anchorOutletId);
    const frame = document.querySelector(".world-frame");
    if (!point || !frame) return;
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = scene.canvas.getBoundingClientRect();
    const halfWidth = (trigger.offsetWidth || 216) / 2;
    const rawX = canvasRect.left - frameRect.left + point.x;
    const rawY = canvasRect.top - frameRect.top + point.y;
    const left = Math.max(halfWidth + 9, Math.min(frame.clientWidth - halfWidth - 9, rawX));
    const top = Math.max(86, Math.min(frame.clientHeight - 104, rawY));
    const position = Math.round(left) + "px|" + Math.round(top) + "px";
    if (position !== worldEventPosition) {
      trigger.style.left = Math.round(left) + "px";
      trigger.style.top = Math.round(top) + "px";
      worldEventPosition = position;
    }
  }
  function syncOutletEventTriggers(updateCopy = false) {
    const container = document.getElementById("outletEventTriggers");
    if (!container) return;
    const events = ui.getOutletWorldEvents();
    const activeIds = new Set(events.map((item) => item.id));
    outletEventButtons.forEach((button, id) => {
      if (!activeIds.has(id)) { button.remove(); outletEventButtons.delete(id); }
    });
    const frame = document.querySelector(".world-frame");
    if (!frame) return;
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = scene.canvas.getBoundingClientRect();
    const occupied = [];
    events.forEach((info) => {
      let button = outletEventButtons.get(info.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "outlet-event-trigger";
        button.dataset.action = "open-outlet-event";
        button.dataset.eventId = info.id;
        button.dataset.outletId = info.outletId;
        button.setAttribute("aria-haspopup", info.kind === "manager" ? "dialog" : "false");
        button.replaceChildren();
        const icon = document.createElement("span");
        icon.className = "outlet-event-icon";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "outlet-event-copy";
        const name = document.createElement("strong");
        const title = document.createElement("span");
        label.append(name, title);
        button.append(icon, label);
        container.append(button);
        outletEventButtons.set(info.id, button);
      }
      const outletName = (state.outlets || []).find((outlet) => outlet.id === info.outletId)?.name || "分店";
      const copyKey = [info.tone, info.kind, info.icon, info.label, info.title, info.description, outletName].join("|");
      if (updateCopy || button.dataset.copyKey !== copyKey) {
        button.dataset.tone = info.tone;
        button.dataset.kind = info.kind;
        button.dataset.copyKey = copyKey;
        button.setAttribute("aria-label", info.label + "・" + info.title + "。" + info.description);
        button.querySelector(".outlet-event-icon").textContent = info.icon;
        button.querySelector(".outlet-event-copy strong").textContent = info.label + "｜" + outletName;
        button.querySelector(".outlet-event-copy span").textContent = info.title;
      }
      const point = scene.eventAnchor(info.outletId);
      const width = button.offsetWidth || 192;
      const halfWidth = width / 2;
      const rawX = canvasRect.left - frameRect.left + point.x;
      const rawY = canvasRect.top - frameRect.top + point.y;
      const left = Math.max(halfWidth + 8, Math.min(frame.clientWidth - halfWidth - 8, rawX));
      const top = Math.max(116, Math.min(frame.clientHeight - 108, rawY));
      let placedTop = top;
      while (occupied.some((rect) => Math.abs(rect.left - left) < width * 0.72 && Math.abs(rect.top - placedTop) < 50) && placedTop < frame.clientHeight - 110) {
        placedTop = Math.min(frame.clientHeight - 108, placedTop + 48);
        if (placedTop === frame.clientHeight - 108) break;
      }
      occupied.push({ left, top: placedTop });
      const leftStyle = Math.round(left) + "px";
      const topStyle = Math.round(placedTop) + "px";
      if (button.style.left !== leftStyle) button.style.left = leftStyle;
      if (button.style.top !== topStyle) button.style.top = topStyle;
    });
  }
  function openWorldEvent(outletId) {
    const incident = state.managerEvent && state.managerEvent.outletId === outletId ? state.managerEvent : null;
    const info = incident ? { kind: "manager", icon: "⚠️", label: "分店重大事件", title: incident.title, description: incident.description } : ui.getWorldEventInfo();
    if (info.kind === "complaint") { openOrder(state.customerIndex); return; }
    worldEventReturnFocus = (outletId && outletEventButtons.get("manager:" + outletId)) || document.activeElement;
    document.getElementById("worldEventDialogKicker").textContent = info.label;
    document.getElementById("worldEventDialogTitle").textContent = info.title;
    document.getElementById("worldEventDialogDescription").textContent = info.description;
    worldEventDialogContent.replaceChildren(ui.renderWorldEventContent());
    if (!worldEventDialog.open) worldEventDialog.showModal();
    const firstAction = worldEventDialogContent.querySelector("button:not(:disabled)");
    const focusTarget = firstAction || worldEventDialog.querySelector('[data-action="close-world-event"]');
    if (focusTarget) focusTarget.focus();
    playTone("open");
  }
  function openStoryChoice() {
    if (state.phase !== "report" || state.reportChoice || storyChoiceDialog.open) return;
    storyChoiceReturnFocus = document.activeElement;
    const story = todayStory(state);
    const card = document.createElement("section");
    card.className = "story-choice-card";
    const title = document.createElement("h3");
    title.textContent = story.title;
    const description = document.createElement("p");
    description.textContent = story.story;
    card.append(title, description);

    const options = document.createElement("div");
    options.className = "story-choice-options";
    const choices = [
      { id: "paperboat", icon: "紙", name: "把紙船放回港灣", detail: "留下一份溫柔的心意，讓夜市口碑增加。", effect: "+2 口碑" },
      { id: "window", icon: "桌", name: "替熟客留桌", detail: "照顧常來的熟面孔，增加熟客並收到心意金。", effect: "+NT$ 80・熟客 +1" }
    ];
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "story-choice-option";
      button.dataset.action = "choose-story";
      button.dataset.id = choice.id;
      const icon = document.createElement("span");
      icon.className = "story-choice-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = choice.icon;
      const copy = document.createElement("span");
      copy.className = "story-choice-copy";
      const name = document.createElement("span");
      name.className = "story-choice-name";
      name.textContent = choice.name;
      const detail = document.createElement("span");
      detail.className = "story-choice-detail";
      detail.textContent = choice.detail;
      copy.append(name, detail);
      const effect = document.createElement("span");
      effect.className = "story-choice-effect";
      effect.textContent = choice.effect;
      button.append(icon, copy, effect);
      options.append(button);
    });
    const note = document.createElement("p");
    note.className = "story-choice-note";
    note.textContent = "選擇後會自動把本夜手記歸檔，並進入明晚；每 7 夜則會接著出現本週經營決策。";
    storyChoiceContent.replaceChildren(card, options, note);
    storyChoiceDialog.showModal();
    const firstChoice = storyChoiceContent.querySelector('[data-action="choose-story"]');
    if (firstChoice) firstChoice.focus();
    playTone("open");
  }
  function advanceNight() {
    const result = engine.nextNight();
    if (result.ok) {
      scene.spawnGuests([]);
      if (state.phase === "decision") ui.setTab("ops");
    }
    showResult(result);
  }
  function chooseStoryFromDialog(id) {
    const choiceResult = engine.chooseStory(id);
    if (!choiceResult.ok) { showResult(choiceResult); return; }
    const nextResult = engine.nextNight();
    if (nextResult.ok) {
      scene.spawnGuests([]);
      if (state.phase === "decision") ui.setTab("ops");
    }
    if (storyChoiceDialog.open) storyChoiceDialog.close();
    showResult({ ok: nextResult.ok, changed: nextResult.changed, message: choiceResult.message + " " + nextResult.message });
  }
  function renderReportDialogContent(focusAction, focusId, resetScroll = false) {
    const previousScroll = resetScroll ? 0 : reportDialogContent.scrollTop;
    reportDialogContent.replaceChildren(ui.renderJournalReport());
    reportDialogContent.scrollTop = previousScroll;
    if (focusAction) {
      const control = Array.from(reportDialogContent.querySelectorAll('[data-action="' + focusAction + '"]'))
        .find((item) => !focusId || item.dataset.id === focusId);
      if (control) control.focus();
    }
  }
  function openJournalReport(id) {
    reportReturnFocus = document.activeElement;
    ui.setJournalView(id);
    const report = ui.getJournalReportInfo();
    document.getElementById("reportDialogTitle").textContent = report.title;
    document.getElementById("reportDialogDescription").textContent = report.description;
    renderReportDialogContent();
    if (!reportDialog.open) reportDialog.showModal();
    reportDialog.querySelector('[data-action="close-report"]').focus();
    playTone("open");
  }
  reportDialog.addEventListener("click", (event) => {
    if (event.target === reportDialog) reportDialog.close();
  });
  reportDialog.addEventListener("close", () => {
    const fallback = document.getElementById("tab-journal");
    const target = reportReturnFocus && reportReturnFocus.isConnected ? reportReturnFocus : fallback;
    reportReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  });
  worldEventDialog.addEventListener("click", (event) => {
    if (event.target === worldEventDialog) worldEventDialog.close();
  });
  worldEventDialog.addEventListener("close", () => {
    const fallback = document.getElementById("worldEventTrigger");
    const target = worldEventReturnFocus && worldEventReturnFocus.isConnected ? worldEventReturnFocus : fallback;
    worldEventReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => {
      const focusTarget = target.isConnected ? target : (fallback && fallback.isConnected ? fallback : document.getElementById("tab-stall"));
      if (focusTarget && focusTarget.focus) focusTarget.focus();
    });
  });
  storyChoiceDialog.addEventListener("click", (event) => {
    if (event.target === storyChoiceDialog) storyChoiceDialog.close();
  });
  storyChoiceDialog.addEventListener("close", () => {
    const fallback = document.getElementById("mainAction");
    const target = storyChoiceReturnFocus && storyChoiceReturnFocus.isConnected ? storyChoiceReturnFocus : fallback;
    storyChoiceReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  });
  document.addEventListener("scene-motion-change", syncMotionControl);
  function syncToastPosition() {
    const frame = document.querySelector(".world-frame");
    const actions = document.querySelector(".world-actions");
    if (!frame || !actions) return;
    const actionBottom = Number.parseFloat(getComputedStyle(actions).bottom) || 0;
    frame.style.setProperty("--world-toast-offset", Math.ceil(actions.offsetHeight + actionBottom + 10) + "px");
  }
  const worldActions = document.querySelector(".world-actions");
  if (worldActions && typeof ResizeObserver !== "undefined") new ResizeObserver(syncToastPosition).observe(worldActions);
  window.addEventListener("resize", syncToastPosition, { passive: true });
  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }
  function showResult(result, refresh = true) {
    if (result.changed && refresh) renderUI();
    if (result.message) toast(result.message);
    if (result.ok) playTone("success");
  }
  function openDoors() {
    const result = engine.openDoors();
    if (result.ok) { scene.spawnGuests(); ui.setTab("ops"); }
    showResult(result);
  }
  function openOrder(index) {
    if (state.phase !== "service") return;
    const guests = engine.getGuests();
    if (index !== state.customerIndex) { toast("先完成櫃台前這一桌，再招呼後面的客人。"); return; }
    const guest = guests[index];
    if (!guest) return;
    orderReturnFocus = document.activeElement;
    document.getElementById("orderKicker").textContent = guest.difficult ? "CUSTOMER COMPLAINT" : "CUSTOMER AT THE COUNTER";
    document.getElementById("orderTitle").textContent = guest.icon + "　" + guest.name;
    document.getElementById("orderMeta").textContent = guest.role + " · " + guest.needLabel;
    document.getElementById("orderQuote").textContent = "「" + guest.line + "」";
    document.getElementById("orderChoices").replaceChildren(ui.renderOrderChoices(guest));
    document.getElementById("orderModal").hidden = false;
    document.querySelector('[data-action="close-order"]').focus();
    playTone("open");
  }
  function closeOrder() {
    document.getElementById("orderModal").hidden = true;
    const fallback = state.phase === "service"
      ? document.querySelector('[data-action="call-next"]')
      : document.getElementById("mainAction");
    const target = orderReturnFocus && orderReturnFocus.isConnected ? orderReturnFocus : fallback;
    orderReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  }
  function runOrderAction(result) {
    if (result.ok) document.getElementById("orderModal").hidden = true;
    showResult(result);
    if (result.ok) {
      const fallback = state.phase === "service"
        ? document.querySelector('[data-action="call-next"]')
        : document.getElementById("mainAction");
      const target = orderReturnFocus && orderReturnFocus.isConnected ? orderReturnFocus : fallback;
      orderReturnFocus = null;
      if (target && target.focus) requestAnimationFrame(() => target.focus());
    }
  }
  function onSceneClick(event) {
    const rect = scene.canvas.getBoundingClientRect();
    const hit = scene.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (hit && hit.type === "guest") { openOrder(hit.index); return; }
    if (hit && hit.type === "outlet-event") {
      if (hit.kind === "manager") openWorldEvent(hit.outletId);
      else openOutletManagement(hit.outletId);
      return;
    }
    if (hit && hit.type === "stall") {
      const info = ui.getWorldEventInfo();
      if (info.pending && info.anchorOutletId === "main") { openWorldEvent(); return; }
      ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。"); return;
    }
    if (hit && hit.type === "outlet") {
      if (state.managerEvent && state.managerEvent.outletId === hit.outletId) { openWorldEvent(hit.outletId); return; }
      openOutletManagement(hit.outletId, hit.outletName);
      return;
    }
    toast("夜市巷弄裡，還有鄰攤與往來的人潮。");
  }

  function openOutletManagement(outletId, outletName) {
    ui.setOutletTarget(outletId);
    ui.setTab("stall");
    renderUI();
    const card = document.getElementById("outlet-card-" + outletId);
    if (card) { card.focus({ preventScroll: true }); card.scrollIntoView({ block: "nearest" }); }
    toast((outletName || (state.outlets || []).find((item) => item.id === outletId)?.name || "分店") + "管理已開啟：可在這裡補貨、升級或查看店長營運。");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "open-world-event") openWorldEvent();
    if (action === "close-story-choice" && storyChoiceDialog.open) storyChoiceDialog.close();
    if (action === "open-outlet-event") {
      const outletId = button.dataset.outletId;
      const eventInfo = ui.getOutletWorldEvents().find((item) => item.id === button.dataset.eventId);
      if (eventInfo?.kind === "manager") openWorldEvent(outletId);
      else openOutletManagement(outletId);
    }
    if (action === "close-world-event" && worldEventDialog.open) worldEventDialog.close();
    if (action === "panel-tab") { ui.setTab(button.dataset.tab); renderUI(); }
    if (action === "open-report") openJournalReport(button.dataset.id);
    if (action === "close-report" && reportDialog.open) reportDialog.close();
    if (action === "statement-view") {
      ui.setStatementView(button.dataset.id);
      if (reportDialog.open) renderReportDialogContent("statement-view", button.dataset.id, true);
    }
    if (action === "main-action") {
      if (state.phase === "prep") openDoors();
      else if (state.phase === "service") openOrder(state.customerIndex);
      else if (state.phase === "report" && state.reportChoice) advanceNight();
      else if (state.phase === "report") openStoryChoice();
      else { ui.setTab("ops"); renderUI(); }
    }
    if (action === "open-stall") { ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。"); }
    if (action === "open-doors") openDoors();
    if (action === "call-next") openOrder(state.customerIndex);
    if (action === "serve-dish") runOrderAction(engine.serveDish(button.dataset.id));
    if (action === "resolve-complaint") runOrderAction(engine.resolveComplaint(button.dataset.choice));
    if (action === "close-order") closeOrder();
    if (action === "select-dish") showResult(engine.selectDish(button.dataset.index));
    if (action === "buy-stock") showResult(engine.buyStock(button.dataset.id));
    if (action === "buy-outlet-stock") showResult(engine.buyOutletStock(button.dataset.outletId, button.dataset.stockId));
    if (action === "toggle-outlet") showResult(engine.toggleOutlet(button.dataset.outletId));
    if (action === "upgrade-outlet-equipment") showResult(engine.upgradeOutletEquipment(button.dataset.outletId));
    if (action === "hire-outlet-manager") showResult(engine.hireOutletManager(button.dataset.outletId));
    if (action === "dismiss-outlet-manager") showResult(engine.dismissOutletManager(button.dataset.outletId));
    if (action === "resolve-manager-event") {
      const result = engine.resolveManagerEvent(button.dataset.choice);
      if (result.ok && worldEventDialog.open) worldEventDialog.close();
      showResult(result);
    }
    if (action === "upgrade-equipment") showResult(engine.upgradeEquipment(button.dataset.id));
    if (action === "buy-upgrade") showResult(engine.buyUpgrade(button.dataset.id));
    if (action === "toggle-staff") showResult(engine.toggleStaff(button.dataset.role));
    if (action === "choose-story") {
      if (storyChoiceDialog.open && button.closest("#storyChoiceContent")) chooseStoryFromDialog(button.dataset.id);
      else showResult(engine.chooseStory(button.dataset.id));
    }
    if (action === "choose-market-card") {
      const result = engine.chooseMarketCard(button.dataset.id);
      if (result.ok && worldEventDialog.open) worldEventDialog.close();
      showResult(result);
    }
    if (action === "next-night") {
      advanceNight();
    }
    if (action === "choose-weekly") showResult(engine.chooseWeeklyDecision(button.dataset.id, button.dataset.targetType));
    if (action === "borrow-loan") showResult(engine.borrowWorkingCapital());
    if (action === "repay-loan") showResult(engine.repayWorkingCapital());
    if (action === "restart-campaign") {
      ui.setTab("ops");
      const result = engine.restartCampaign();
      scene.spawnGuests([]);
      showResult(result);
    }
    if (["orbit-left", "orbit-right", "tilt-up", "tilt-down", "zoom-in", "zoom-out", "camera-reset"].includes(action)) scene.cameraAction(action);
    if (action === "toggle-pause") {
      if (scene.motionReduced) { toast("夜市動畫已依系統設定降低動態效果。"); return; }
      const paused = scene.togglePause();
      syncMotionControl();
      toast(paused ? "場景動畫已暫停。" : "場景動畫已恢復。");
    }
    if (action === "toggle-sound") {
      soundEnabled = !soundEnabled;
      try { localStorage.setItem("yelan-sound-enabled", String(soundEnabled)); } catch {}
      button.setAttribute("aria-pressed", String(soundEnabled));
      button.textContent = soundEnabled ? "♫ 音效：開" : "♫ 音效：關";
      toast(soundEnabled ? "輕柔音效已開啟。" : "音效已關閉。");
      if (soundEnabled) playTone("success");
    }
  });

  document.addEventListener("change", (event) => {
    const control = event.target.closest('select[data-action]');
    if (!control) return;
    if (control.dataset.action === "diary-day" || control.dataset.action === "report-period" || control.dataset.action === "week-report") {
      ui.setJournalFilter(control.dataset.action, control.value);
      if (reportDialog.open) renderReportDialogContent(control.dataset.action);
      else renderUI();
    }
  });

  const orderModal = document.getElementById("orderModal");
  orderModal.addEventListener("click", function(event) { if (event.target === this) closeOrder(); });
  orderModal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(orderModal.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !orderModal.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !orderModal.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("orderModal").hidden) closeOrder();
  });
  scene.canvas.addEventListener("keydown", (event) => {
    const actions = {
      ArrowLeft: "orbit-left", ArrowRight: "orbit-right", ArrowUp: "tilt-up", ArrowDown: "tilt-down",
      "+": "zoom-in", "=": "zoom-in", "-": "zoom-out"
    };
    if (actions[event.key]) {
      event.preventDefault();
      scene.cameraAction(actions[event.key]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (state.phase === "service") openOrder(state.customerIndex);
      else if (state.phase === "prep") {
        ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。");
      }
    }
  });
  document.querySelector(".panel-tabs").addEventListener("keydown", (event) => {
    const tabs = Array.from(document.querySelectorAll(".panel-tab"));
    const current = tabs.indexOf(document.activeElement);
    if (current < 0 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + offset + tabs.length) % tabs.length];
    next.focus();
    ui.setTab(next.dataset.tab);
    renderUI();
  });
  scene.canvas.addEventListener("click", onSceneClick);

  function frame(time) {
    const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0.016;
    lastFrame = time;
    if (!document.hidden) { scene.update(dt); scene.draw(); syncWorldEventTrigger(); syncOutletEventTriggers(); }
    requestAnimationFrame(frame);
  }
  const soundButton = document.querySelector('[data-action="toggle-sound"]');
  if (soundButton) {
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.textContent = soundEnabled ? "♫ 音效：開" : "♫ 音效：關";
  }
  syncToastPosition();
  renderUI();
  requestAnimationFrame(frame);
}

if (typeof document !== "undefined") boot();

import { DATA, getOutletProduct, getOutletSpecialty, outletAvailableStock, outletRetailPrice } from "../data.js";
import { getNextStallTier, getOutletCapacity, getOutletSafetyLevel, getOutletTier, getTierReadiness, INSURANCE_RATES, OUTLET_SAFETY_EQUIPMENT } from "../safety.js";
import { getPurchasePrice, money } from "../state.js";
import { recordAssetPurchase, recordExpense, recordInventoryPurchase, recordSale } from "../accounting.js";

const capAt = (value, max) => Math.min(max, value);

export function createBranchActions({ state, response, unlockRecipe, resetDailyFeaturedDish }) {
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
    const itemName = item.name || item.productName || item.storeName || "備料";
    recordInventoryPurchase(state, outlet.name + "｜" + itemName, price);
    return response(true, outlet.name + "補進 1 份" + itemName + "，已列入存貨與現金流。");
  }

  function toggleOutlet(outletId) {
    if (state.phase !== "prep") return response(false, "分店營業狀態只能在開門前調整。", false);
    const outlet = findOutlet(outletId);
    if (!outlet) return response(false, "找不到這間分店。", false);
    if (!outlet.active) {
      const readiness = getTierReadiness(state, outlet, getOutletTier(outlet).id);
      if (!readiness.ready) return response(false, "這間店的攤型安全條件不足，請先補齊：「" + readiness.missing.join("、") + "」。", false);
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
    if (getOutletTier(outlet).id === "dapaidang") return response(false, "大排檔規模需要店長維持現場管理與安全點檢，不能解除店長職務。", false);
    const refund = recordEmployeeDeparture(outlet, outlet.name + "店長");
    outlet.manager = false;
    return response(true, outlet.name + "已改由你親自照看；往後每夜店長薪資停止，但接待量回到每夜一筆。" + (refund ? "本期未到期職災保費 " + money(refund) + " 將於期末底稿轉列應收。" : ""));
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

  function upgradeOutletSafety(outletId, equipmentId) {
    if (state.phase !== "prep") return response(false, "分店安全設備只能在開門前施工。", false);
    const outlet = findOutlet(outletId);
    const item = OUTLET_SAFETY_EQUIPMENT.find((equipment) => equipment.id === equipmentId);
    if (!outlet || !item) return response(false, "找不到這間分店或安全設備。", false);
    if (equipmentId === "coldStorage" && getOutletProduct(outlet.type).group !== "food") {
      return response(false, "這間非餐飲體驗店不需要食品冷鏈設備。", false);
    }
    const level = getOutletSafetyLevel(state, outlet, equipmentId);
    const cost = item.costs[level];
    if (typeof cost !== "number") return response(false, item.name + "已達最高級。", false);
    if (state.coins < cost) return response(false, "現金不足，無法添購分店安全設備。", false);
    outlet.safety ||= { fire: 0, ventilation: 0, coldStorage: 0 };
    outlet.safety[equipmentId] = level + 1;
    state.coins -= cost;
    recordAssetPurchase(state, { id: outlet.id + "-safety-" + equipmentId + "-" + (level + 1) + "-day-" + state.day,
      name: outlet.name + "｜" + item.name + " Lv." + (level + 1), cost,
      usefulLifeDays: DATA.accounting.equipmentUsefulLifeDays,
      residualValue: Math.round(cost * DATA.accounting.equipmentResidualRate) });
    return response(true, outlet.name + "已完成「" + item.name + "」Lv." + (level + 1) + "；已列為設備資產並開始折舊。");
  }

  function upgradeStallTier(outletId) {
    if (state.phase !== "prep") return response(false, "攤型施工只能在開門前進行。", false);
    const outlet = (state.outlets || []).find((item) => item.id === outletId);
    if (!outlet) return response(false, "找不到這間店面。", false);
    const nextTier = getNextStallTier(outlet);
    if (!nextTier) return response(false, "這間店已達最高攤型：大排檔。", false);
    const readiness = getTierReadiness(state, outlet, nextTier.id);
    if (!readiness.ready) return response(false, "升級條件尚未達成：「" + readiness.missing.join("、") + "」。", false);
    if (state.coins < nextTier.buildCost) return response(false, "現金不足，無法支付攤型整修費 " + money(nextTier.buildCost) + "。", false);
    outlet.tier = nextTier.id;
    state.coins -= nextTier.buildCost;
    recordAssetPurchase(state, { id: outlet.id + "-stall-tier-" + nextTier.id + "-day-" + state.day,
      name: outlet.name + "｜" + nextTier.name + "整修", cost: nextTier.buildCost,
      usefulLifeDays: DATA.accounting.improvementUsefulLifeDays,
      residualValue: Math.round(nextTier.buildCost * DATA.accounting.improvementResidualRate) });
    const unlocked = outlet.id === "main" ? DATA.dishes.find((dish) => dish.unlockTier === nextTier.id && dish.unlockOutlet === "main") : null;
    if (unlocked) unlockRecipe(unlocked, outlet.name + "升級至" + nextTier.name, state.day);
    const specialty = getOutletSpecialty(outlet);
    return response(true, outlet.name + "已升級為「" + nextTier.name + "」；接待容量增加，攤型能源費每夜 +" + money(nextTier.dailyUtilities) + "。新招牌「" + specialty.name + "」售價 NT$ " + outletRetailPrice(outlet) + "。" + (unlocked ? "免費解鎖新菜色「" + unlocked.name + "」！" : "已開放該業態的升級商品。") + "保險於每期第 1 夜結帳。");
  }

  function toggleAccidentCoverage(outletId) {
    if (state.phase !== "prep") return response(false, "職災加保只能在開門前調整。", false);
    const outlet = (state.outlets || []).find((item) => item.id === outletId);
    if (!outlet) return response(false, "找不到這間店面。", false);
    if (getOutletTier(outlet).id === "dapaidang") return response(false, "大排檔由雇主統一編列職災、勞保與健保費，不能關閉。", false);
    const employees = outlet.id === "main" ? DATA.staff.length + state.hiredCrew : (outlet.manager ? 1 : 0);
    if (!outlet.accidentCoverage && employees <= 0) return response(false, "目前沒有由店家聘用的人員可加保。", false);
    outlet.accidentCoverage = !outlet.accidentCoverage;
    if (!outlet.accidentCoverage) return response(true, outlet.name + "已取消雇主加保職災；員工仍需自行安排基本保障。下期不再列入雇主保費。");
    return response(true, outlet.name + "已啟用雇主職災加保；估計每期 " + money(employees * INSURANCE_RATES.accidentPerEmployee) + "，於每期第 1 夜入帳。");
  }

  function recordEmployeeDeparture(outlet, employeeName) {
    const cycleStart = Math.floor((Number(state.day) - 1) / 30) * 30 + 1;
    const snapshot = state.insuranceSnapshot;
    if (!snapshot || Number(snapshot.periodStartDay) !== cycleStart || Number(state.day) <= cycleStart) return 0;
    const outletPolicy = (snapshot.outlets || []).find((item) => item.outletId === outlet.id);
    if (!outletPolicy || outletPolicy.employees <= 0) return 0;
    const remainingDays = Math.max(0, Number(snapshot.periodEndDay) - Number(state.day));
    if (!remainingDays) return 0;
    const ratio = remainingDays / 30;
    const breakdown = Object.fromEntries(["accident", "labor", "health"].map((key) => [key,
      Math.max(0, Math.round((Number(outletPolicy.perEmployee?.[key]) || 0) * ratio))]));
    const amount = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    if (!amount) return 0;
    const sequence = (state.orphanPolicies || []).length + 1;
    state.orphanPolicies ||= [];
    state.orphanPolicies.push({ id: "orphan-policy-" + state.day + "-" + sequence,
      outletId: outlet.id, employeeName: String(employeeName || "離職夥伴"), departureDay: state.day,
      periodStartDay: cycleStart, periodEndDay: snapshot.periodEndDay, remainingDays,
      refundBreakdown: breakdown, refundAmount: amount, status: "pending-adjustment" });
    return amount;
  }

  function releaseCrewMember() {
    if (!(["prep", "decision"].includes(state.phase))) return response(false, "人員異動只能在營業前或每週決策時處理。", false);
    if (Number(state.hiredCrew) <= 0) return response(false, "目前沒有額外聘用的全職夥伴可辦理離職。", false);
    const main = (state.outlets || []).find((outlet) => outlet.id === "main");
    const refund = main ? recordEmployeeDeparture(main, "夜嵐全職夥伴") : 0;
    state.hiredCrew = Math.max(0, Number(state.hiredCrew) - 1);
    const cycleStart = Math.floor((Number(state.day) - 1) / 30) * 30 + 1;
    const periodEndDay = cycleStart + 29;
    return response(true, "已完成一位全職夥伴離職交接；每夜薪資減少 NT$ 90。" + (refund
      ? "估計未到期雇主保費 NT$ " + refund + " 將於第 " + periodEndDay + " 夜期末工作底稿調整為應收款，次期首夜收款。"
      : "本期沒有可回收的雇主保費，或保險仍由員工自行投保。"));
  }

  function hireOutletManager(outletId) {
    if (state.phase !== "decision") return response(false, "店長招募安排在每週經營決策時處理。", false);
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
    resetDailyFeaturedDish();
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
      recordExpense(state, "5400", "設備維修｜" + outlet.name, cost);
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
        const capacity = getOutletCapacity(outlet);
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
          supplyName = getOutletSpecialty(outlet).name;
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
        food, utilities: wasActive ? DATA.economy.outletUtilities + getOutletTier(outlet).dailyUtilities : 0,
        managerPayroll: outlet.manager ? DATA.economy.managerWage : 0,
        rent: 38,
        net: sales - food - (wasActive ? DATA.economy.outletUtilities + getOutletTier(outlet).dailyUtilities : 0) - (outlet.manager ? DATA.economy.managerWage : 0) - 38
      };
    });
  }
  return { buyOutletStock, toggleOutlet, dismissOutletManager, upgradeOutletEquipment, upgradeOutletSafety, upgradeStallTier,
    toggleAccidentCoverage, releaseCrewMember, hireOutletManager, resolveManagerEvent, simulateOutletOperations };
}

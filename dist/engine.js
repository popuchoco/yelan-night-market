import { DATA, createOutletInventory, getOutletProduct, getOutletSpecialty, outletAvailableStock, outletRetailPrice } from "./data.js";
import { ACQUISITION_TYPES, ENDINGS, WEEKLY_OPTIONS, isAcquisitionTypeAvailable, isWeeklyDecisionDay, selectEnding, weeklyOptionCost } from "./campaign.js";
import {
  createLedger, fixedOperatingCost, getFoodCost, getPurchasePrice, getTonightGuests, hasBrandAlliance,
  ledgerIncome, ledgerNet, freshState, loadState, marketCardChoice, money, saveState, staffCost,
  todayEvent, todayMarketCard, todayStory, getUnlockedDishes
} from "./state.js";
import { getMonthlyInsurance, getNextStallTier, getOutletCapacity, getOutletTier, getTierReadiness, hasCurrentCoverage, isInsuranceBillingDay, INSURANCE_RATES, OUTLET_SAFETY_EQUIPMENT } from "./safety.js";
import {
  closeDepreciation, closeMonthlyStatements, closeWeeklyWorksheet, closeInsuranceRefundAdjustments, collectInsuranceRefundReceivables,
  getDailyCashbookSummary, recordAssetPurchase, recordExpense, recordInventoryPurchase, recordLoanDraw,
  recordLoanRepayment, recordOperatingClose, recordRefund, recordSale,
  recordInsuranceClaimAccrual, collectInsuranceClaims
} from "./accounting.js";
import { evaluateAchievements, normalizeAchievementState } from "./achievements.js";
import { createWeeklyFocus, getLegacyWeeklyFocus, getWeeklyFocusDefinition, getWeeklyFocusIdForDecision, recordWeeklyFocusProgress, resolveWeeklyFocus } from "./progression.js";
import { createBranchActions } from "./engine/branches.js";
import { createEventActions } from "./engine/events.js";

const capAt = (value, max) => Math.min(max, value);

function createInsuranceCoverageSnapshot(state) {
  const periodStartDay = Math.floor((Number(state.day) - 1) / 30) * 30 + 1;
  return {
    periodStartDay,
    periodEndDay: periodStartDay + 29,
    outlets: (Array.isArray(state.outlets) ? state.outlets : []).map((outlet) => {
      const insurance = getMonthlyInsurance(state, outlet);
      const employees = insurance.employees;
      return { outletId: outlet.id, employees,
        perEmployee: employees ? {
          accident: insurance.accident / employees,
          labor: insurance.labor / employees,
          health: insurance.health / employees
        } : { accident: 0, labor: 0, health: 0 },
        covered: { accident: insurance.accident > 0, product: insurance.product > 0, public: insurance.public > 0 } };
    })
  };
}

/**
 * Create a deterministic-testable, deliberately mutable simulation engine.
 * State is mutated in place so the scene, UI, and engine share one live world;
 * browser actions wrap these mutations in a JSON snapshot rollback boundary.
 * @param {ReturnType<typeof freshState>} state
 * @param {{ random?: () => number }} [options]
 */
export function createGameEngine(state, { random = Math.random } = {}) {
  if (!state.weeklyFocus) state.weeklyFocus = getLegacyWeeklyFocus(state.day, state.decisions);
  const guests = () => getTonightGuests(state);
  const event = () => todayEvent(state);
  const pendingAchievementAwards = [];
  const weeklyFocusMilestoneNotices = [];
  let trackedWeeklyFocusKey = state.weeklyFocus ? state.weeklyFocus.id + ":" + state.weeklyFocus.startDay : "";
  let lastWeeklyFocusProgress = Math.max(0, Number(state.weeklyFocus?.progress) || 0);
  function collectWeeklyFocusMilestone() {
    const focus = state.weeklyFocus;
    const key = focus ? focus.id + ":" + focus.startDay : "";
    if (key !== trackedWeeklyFocusKey) {
      trackedWeeklyFocusKey = key;
      lastWeeklyFocusProgress = Math.max(0, Number(focus?.progress) || 0);
      return;
    }
    if (!focus || focus.resolved) return;
    const progress = Math.max(0, Math.min(Number(focus.target) || 0, Number(focus.progress) || 0));
    const target = Math.max(1, Number(focus.target) || 1);
    const definition = getWeeklyFocusDefinition(focus.id);
    const title = definition?.title || "本週經營焦點";
    if (lastWeeklyFocusProgress < target && progress >= target) {
      weeklyFocusMilestoneNotices.push("本週焦點達標｜" + title + "，今晚結算時會記下成果。");
    } else if (lastWeeklyFocusProgress < Math.ceil(target / 2) && progress >= Math.ceil(target / 2)) {
      weeklyFocusMilestoneNotices.push("本週焦點過半｜" + title + "，已完成 " + progress + " / " + target + "。");
    }
    lastWeeklyFocusProgress = progress;
  }
  const response = (ok, message, changed = ok) => {
    if (ok) {
      pendingAchievementAwards.push(...evaluateAchievements(state));
      collectWeeklyFocusMilestone();
    }
    return { ok, changed, message };
  };

  function markJournalViewed() {
    state.achievements = normalizeAchievementState(state.achievements);
    if (state.achievements.viewedJournal) return response(true, "", false);
    state.achievements.viewedJournal = true;
    return response(true, "", true);
  }

  function markStatementViewed(statementId) {
    const validStatements = ["income", "equity", "position", "cashflow"];
    if (!validStatements.includes(statementId)) return response(false, "找不到這份財務報表。", false);
    if (!(state.accounting?.monthlyReports || []).length) return response(false, "第一期結帳後才能查閱財務報表。", false);
    state.achievements = normalizeAchievementState(state.achievements);
    if (state.achievements.viewedStatements.includes(statementId)) return response(true, "", false);
    state.achievements.viewedStatements.push(statementId);
    return response(true, "", true);
  }

  function markAchievementListSeen() {
    state.achievements = normalizeAchievementState(state.achievements);
    state.achievements.pending = [];
  }

  function drainAchievementAwards() {
    return Array.from(new Set(pendingAchievementAwards.splice(0, pendingAchievementAwards.length)));
  }

  function randomUnit() {
    const value = Number(random());
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
  }

  function unlockRecipe(recipe, source, day = state.day) {
    if (!recipe || state.unlockedRecipes.includes(recipe.id)) return false;
    state.unlockedRecipes.push(recipe.id);
    state.recipeLog ||= [];
    state.recipeLog.push({ day, recipeId: recipe.id, source, acquisitionCost: 0 });
    state.recipeLog = state.recipeLog.slice(-100);
    return true;
  }

  function recordGuestRecipeFeedback(guest) {
    if (!guest?.secretRecipeId) return null;
    state.recipeGoodVisits ||= {};
    const guestId = guest.id || guest.name;
    const visits = Number(state.recipeGoodVisits[guestId]) || 0;
    state.recipeGoodVisits[guestId] = visits + 1;
    if (visits + 1 < 2 || randomUnit() >= 0.38) return null;
    const recipe = DATA.dishes.find((dish) => dish.id === guest.secretRecipeId);
    return unlockRecipe(recipe, guest.name + "・" + guest.hometown + "家鄉食譜秘笈", state.day) ? recipe : null;
  }

  function resetDailyFeaturedDish() {
    const menu = getUnlockedDishes(state);
    state.selectedDish = menu.length ? menu[(state.day - 1) % menu.length].index : 0;
  }

  const { rollSafetyIncident, applyPromotionOutcome, resolveClosingSurprises, claimSettlementNotes } = createEventActions({ state, randomUnit });

  function openDoors() {
    if (state.phase !== "prep") return response(false, "現在不是開門準備時段。");
    if (todayMarketCard(state) && !marketCardChoice(state)) return response(false, "先處理今晚的市集公告卡，再掛燈迎客。", false);
    if (state.managerEvent) return response(false, "先處理店長送來的重大營運事件，再開始今晚營業。", false);
    const mainOutlet = (state.outlets || []).find((outlet) => outlet.id === "main");
    const mainReadiness = getTierReadiness(state, mainOutlet, getOutletTier(mainOutlet).id);
    if (!mainReadiness.ready) return response(false, "主店攤型安全條件不足，請先補齊：「" + mainReadiness.missing.join("、") + "」。", false);
    state.phase = "service";
    state.customerIndex = 0;
    state.revenue = 0;
    state.results = [];
    state.reportChoice = null;
    state.ledger = createLedger(state);
    const promotionMessage = applyPromotionOutcome();
    if (isInsuranceBillingDay(state.day)) state.insuranceSnapshot = createInsuranceCoverageSnapshot(state);
    simulateOutletOperations();
    if ((state.outlets || []).some((outlet) => outlet.id !== "main" && Number(outlet.lastResult?.day) === Number(state.day) && Number(outlet.lastResult?.units) > 0)) {
      recordWeeklyFocusProgress(state.weeklyFocus, "branch-night");
    }
    const fixed = fixedOperatingCost(state.ledger);
    state.coins -= fixed;
    state.coins += state.ledger.subsidies || 0;
    recordOperatingClose(state, state.ledger);
    const refundRecovery = collectInsuranceRefundReceivables(state, state.day);
    if (refundRecovery) state.coins += refundRecovery;
    const claimRecovery = collectInsuranceClaims(state, state.day);
    if (claimRecovery) {
      state.coins += claimRecovery;
      state.ledger.insuranceClaimReceipts += claimRecovery;
    }
    if (state.loanPrincipal > 0) state.loanNights = (Number(state.loanNights) || 0) + 1;
    if (state.ledger.fees) state.fame = Math.max(0, state.fame - 2);
    else if (event().id === "inspection") state.fame = capAt(state.fame + 1, 100);
    if (marketCardChoice(state) === "promote" || marketCardChoice(state) === "deep-clean") state.fame = capAt(state.fame + 1, 100);
    const incident = rollSafetyIncident();
    const insuranceTotal = state.ledger.insuranceAccident + state.ledger.insuranceLabor + state.ledger.insuranceHealth + state.ledger.insuranceProduct + state.ledger.insurancePublic;
    return response(true, "租金、人事、能源與活動費用 " + money(fixed) + " 已扣" + (insuranceTotal ? "，含本期保險 " + money(insuranceTotal) : "") + (refundRecovery ? "；已收回保險退費款 " + money(refundRecovery) : "") + (claimRecovery ? "；收到前次保險理賠 " + money(claimRecovery) : "") + (promotionMessage ? "；" + promotionMessage : "") + (incident ? "。現場有一件安全事件，請先點場景中的事件訊息處理。" : "。街口有人往你的燈牌走來。"));
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
    if (state.safetyIncident?.status === "pending") return response(false, "先處理場景中待辦的安全事件，再繼續接單。", false);
    const dish = DATA.dishes.find((item) => item.id === id);
    const guest = guests()[state.customerIndex];
    if (!dish || !state.unlockedRecipes.includes(dish.id) || state.recalledDishIds.includes(dish.id) || !guest || guest.difficult) return response(false, state.recalledDishIds.includes(dish?.id) ? "這道料理因今晚食安事件已暫時下架。" : "這位客人目前不能點這道料理。", false);
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
    const recipeDiscovery = good ? recordGuestRecipeFeedback(guest) : null;
    state.results.push({ name: guest.name, icon: guest.icon, score, reaction: good ? (score >= 90 ? "剛剛好" : "老闆忙中代班") : "也不錯", mood: guest.mood, good, dish: dish.name,
      ...(recipeDiscovery ? { recipeDiscovery: recipeDiscovery.id } : {}) });
    recordWeeklyFocusProgress(state.weeklyFocus, "served");
    if (good) recordWeeklyFocusProgress(state.weeklyFocus, "good-service");
    state.customerIndex += 1;
    if (state.customerIndex >= guests().length) state.phase = "report";
    const eventText = eventBonus ? "燈節 Bonus +" + money(eventBonus) + "。 " : "";
    return response(true, eventText + (good ? guest.name + "吃得滿足，留下了一句謝謝。" : guest.name + "收下餐點，安靜地笑了笑。") +
      (recipeDiscovery ? "熟客「" + guest.name + "」分享了" + guest.hometown + "家鄉食譜秘笈：「" + recipeDiscovery.name + "」已免費解鎖，售價 NT$ " + recipeDiscovery.price + "。" : ""));
  }

  function resolveSafetyIncident(choice) {
    const incident = state.safetyIncident;
    if (state.phase !== "service" || !incident || incident.status !== "pending") return response(false, "目前沒有待處理的營運安全事件。", false);
    const hasCoverage = hasCurrentCoverage(state, incident.outletId, incident.policy);
    if (choice !== "claim" && choice !== "self") return response(false, "請選擇依保單申請理賠，或由店家自行負擔處置。", false);
    if (choice === "claim" && !hasCoverage) return response(false, "本期沒有這類有效保單；請選擇店家自行處置。", false);
    const expense = Math.max(0, Math.round(incident.expense + (choice === "self" && hasCoverage ? 18 : 0)));
    const claimAmount = choice === "claim" ? Math.min(expense, Math.max(0, Math.round(incident.claim))) : 0;
    state.coins -= expense;
    state.ledger.safetyCosts = (Number(state.ledger.safetyCosts) || 0) + expense;
    recordExpense(state, incident.expenseAccount, incident.title + "｜照護、清消與顧客補償", expense);
    if (claimAmount > 0) {
      const claim = { id: "claim-" + state.day + "-" + incident.id, incidentId: incident.id,
        description: incident.title, policy: incident.policy, amount: claimAmount,
        incidentDay: state.day, payoutDay: state.day + 2, status: "receivable" };
      state.insuranceClaims ||= [];
      state.insuranceClaims.push(claim);
      state.insuranceClaims = state.insuranceClaims.slice(-100);
      recordInsuranceClaimAccrual(state, claim, state.day);
      state.ledger.insuranceClaimRevenue += claimAmount;
    }
    const reputationLoss = choice === "claim" ? Math.max(1, incident.fame - 2) : incident.fame;
    state.fame = Math.max(0, state.fame - reputationLoss);
    state.regulars = Math.max(0, state.regulars - incident.regulars);
    if (incident.dishRecall && incident.dishId) state.recalledDishIds = [incident.dishId];
    incident.status = "resolved";
    incident.choice = choice;
    incident.expensePosted = expense;
    incident.claimAmount = claimAmount;
    if (incident.shutdown) {
      state.outbreakRecoveryUntilDay = state.day + 2;
      state.phase = "report";
      state.customerIndex = guests().length;
      state.results.push({ name: "食品安全停業處置", icon: incident.icon, score: 0, reaction: "停止出餐・封存與清消", mood: incident.description, good: false });
    }
    const resultText = claimAmount
      ? "照護與清消支出 " + money(expense) + " 已入帳；保險理賠 " + money(claimAmount) + " 先列應收款，預計第 " + (state.day + 2) + " 夜收款。口碑下降 " + reputationLoss + "。"
      : "店家自行負擔處置 " + money(expense) + "，已依安全事件科目入帳；口碑下降 " + reputationLoss + "。";
    return response(true, incident.title + "已處理。" + resultText + (incident.dishRecall ? " 受影響的「" + (incident.affectedDishName || "當夜餐點") + "」暫時下架。" : "") +
      (incident.shutdown ? "今晚停止出餐，接下來兩夜客流略降。" : ""));
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
    if (state.phase !== "prep") return response(false, "開門後不能進行設備升級。", false);
    const item = DATA.upgrades.find((upgrade) => upgrade.id === id);
    if (!item || state.upgrades[id] || state.coins < item.cost) return response(false, "現金不足，或這項設備已經添置。", false);
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

  const { buyOutletStock, toggleOutlet, dismissOutletManager, upgradeOutletEquipment, upgradeOutletSafety, upgradeStallTier,
    toggleAccidentCoverage, releaseCrewMember, hireOutletManager, resolveManagerEvent, simulateOutletOperations } =
    createBranchActions({ state, response, unlockRecipe, resetDailyFeaturedDish });

  function selectDish(index) {
    if (state.phase !== "prep") return response(false, "開門後不能更換招牌菜。", false);
    const selected = Number(index);
    if (!Number.isInteger(selected) || selected < 0 || selected >= DATA.dishes.length || !state.unlockedRecipes.includes(DATA.dishes[selected].id)) return response(false, "這道菜尚未解鎖或不存在。", false);
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
    if (id === "acquire" && !isAcquisitionTypeAvailable(state, targetType)) {
      const message = Number(state.acquisitions) >= 4
        ? "第五次接手限定船埠麵線，才能解鎖東堤小巷；其他業態目前無法使用最後一個接手名額。"
        : "這項攤位尚未開放；完成現有四間鄰攤的接手後，才能拓展到東堤小巷。";
      return response(false, message, false);
    }
    const allianceBefore = hasBrandAlliance(state);
    state.coins -= cost;
    if (id === "expand") {
      state.expansions += 1;
      state.cozy = capAt(state.cozy + 5, 100);
      recordAssetPurchase(state, { id: "expansion-" + state.expansions + "-day-" + state.day, name: "戶外桌區裝修 " + state.expansions, cost,
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
        tier: "mobile", accidentCoverage: false, safety: { fire: 0, ventilation: 0, coldStorage: 0 },
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
    const focusId = getWeeklyFocusIdForDecision(id);
    state.weeklyFocus = createWeeklyFocus(focusId, state.day);
    state.phase = "prep";
    resetDailyFeaturedDish();
    const focus = getWeeklyFocusDefinition(focusId);
    const transition = !allianceBefore && hasBrandAlliance(state)
      ? "夜市品牌聯盟成立：每夜多一桌聯盟來客，聯合採購享進價 9 折。"
      : (id === "hold" ? "保留現金，照目前規模進入新的一週。" : decisionName + "已完成，往後每夜固定成本與客流效果同步更新。");
    const districtNotice = id === "acquire" && targetType === "noodle" ? " 東堤小巷已開放；相機已帶你看見新區域，可平移探索並點選船埠麵線管理。" : "";
    return response(true, transition + districtNotice + " 本週焦點：" + focus.title + "。" );
  }

  function nextNight() {
    if (state.phase !== "report" || !state.reportChoice) return response(false, "先完成今晚的打烊選擇。", false);
    const closingEvents = resolveClosingSurprises();
    const finishedDay = state.day;
    const net = ledgerNet(state.ledger);
    if (state.weeklyFocus?.id === "hold" && Number(state.coins) > 0 && Number(state.loanTakenDay) < Number(state.weeklyFocus.startDay)) {
      recordWeeklyFocusProgress(state.weeklyFocus, "solvent-night");
    }
    const weeklyFocusResult = finishedDay % 7 === 0
      ? resolveWeeklyFocus(state.weeklyFocus, { closingDay: finishedDay, coins: state.coins, loanTakenDay: state.loanTakenDay }) : null;
    if (weeklyFocusResult?.success) {
      state.fame = capAt(state.fame + 2, 100);
      state.regulars = capAt(state.regulars + 1, 24);
    }
    const marketCard = todayMarketCard(state);
    const selectedMarketChoice = marketCard
      ? marketCard.choices.find((choice) => choice.id === marketCardChoice(state))
      : null;
    const journalEntry = { day: state.day, event: event().name, title: todayStory(state).title,
      choice: state.reportChoice === "paperboat" ? "把紙船放回港灣" : "替熟客留了一張窗邊桌",
      marketCard: marketCard ? marketCard.name : null,
      marketChoice: selectedMarketChoice ? selectedMarketChoice.name : null,
      safetyIncident: state.safetyIncident ? {
        title: state.safetyIncident.title, choice: state.safetyIncident.choice || null,
        expense: Number(state.safetyIncident.expensePosted) || 0, claim: Number(state.safetyIncident.claimAmount) || 0,
        affectedDishName: state.safetyIncident.affectedDishName || null,
        dishRecall: !!state.safetyIncident.dishRecall, shutdown: !!state.safetyIncident.shutdown
      } : null,
      claimSettlements: claimSettlementNotes(finishedDay),
      closingEvents,
      promotionOutcome: state.marketCardOutcome?.summary || null,
      recipesUnlocked: (Array.isArray(state.recipeLog) ? state.recipeLog : [])
        .filter((entry) => Number(entry.day) === Number(state.day)).map((entry) => entry.recipeId),
      net, guests: state.results.map((result) => result.name), goodGuests: state.results.filter((result) => result.good).length,
      ...(weeklyFocusResult ? { weeklyFocus: weeklyFocusResult } : {}) };
    state.journal.unshift(journalEntry);
    state.journal = state.journal.slice(0, 30);
    state.campaignNet = (Number(state.campaignNet) || 0) + net;
    closeDepreciation(state, finishedDay);
    const insuranceAdjustment = finishedDay % 30 === 0 ? closeInsuranceRefundAdjustments(state, finishedDay) : null;
    const monthlyClose = finishedDay % 30 === 0 ? closeMonthlyStatements(state, finishedDay) : null;
    if (monthlyClose) {
      monthlyClose.insuranceRefundAdjustments = insuranceAdjustment;
      monthlyClose.outcomeId = selectEnding({ ...state, campaignNet: monthlyClose.totals.profit });
      monthlyClose.outcome = ENDINGS[monthlyClose.outcomeId];
    }
    const weeklyClose = finishedDay % 7 === 0 || finishedDay % 30 === 0
      ? closeWeeklyWorksheet(state, finishedDay, { periodEnd: finishedDay % 30 === 0, insuranceAdjustment }) : null;
    if (weeklyClose && weeklyFocusResult) weeklyClose.weeklyFocus = weeklyFocusResult;
    const cashbook = getDailyCashbookSummary(state, finishedDay);
    journalEntry.cashbook = {
      ...cashbook,
      sales: Math.max(0, Math.round(Number(state.ledger?.sales) || 0)),
      tips: Math.max(0, Math.round(Number(state.ledger?.tips) || 0)),
      activity: Math.max(0, Math.round((Number(state.ledger?.bonus) || 0) + (Number(state.ledger?.storyBonus) || 0))),
      guestCount: state.results.length,
      satisfiedCount: state.results.filter((result) => result.good).length,
      focus: state.weeklyFocus ? {
        title: getWeeklyFocusDefinition(state.weeklyFocus.id)?.title || "本週經營焦點",
        progress: Math.max(0, Number(state.weeklyFocus.progress) || 0),
        target: Math.max(1, Number(state.weeklyFocus.target) || 1),
        resolved: !!state.weeklyFocus.resolved,
        success: !!state.weeklyFocus.success
      } : null
    };
    state.customerIndex = 0;
    state.revenue = 0;
    state.results = [];
    state.reportChoice = null;
    state.ledger = null;
    state.safetyIncident = null;
    state.recalledDishIds = [];
    state.shiftPurchases = 0;
    state.marketChoiceDay = 0;
    state.marketCardChoice = null;
    state.marketCardOutcome = null;
    state.day = finishedDay + 1;
    const weeklyDecision = isWeeklyDecisionDay(state.day);
    state.phase = weeklyDecision ? "decision" : "prep";
    if (weeklyDecision && state.outlets.some((outlet) => outlet.id !== "main" && outlet.manager && outlet.active)) {
      const managerBranches = state.outlets.filter((outlet) => outlet.id !== "main" && outlet.manager && outlet.active);
      const outlet = managerBranches[Math.floor((state.day / 7) % managerBranches.length)];
      const type = ["equipment", "complaint", "festival"][Math.floor((state.day - 8) / 7) % 3];
      const incidents = {
        equipment: { title: "設備故障，待維修", description: outlet.name + "回報營運設備運轉不穩。要安排打烊後維修，或先讓店長下週降載營運？", choices: [{ id: "repair", name: "安排維修・NT$ 85" }, { id: "defer", name: "暫緩處理・下週少接一單" }] },
        complaint: { title: "分店客訴升級", description: outlet.name + "遇到一位不滿排隊安排的客人。由總部核准補償，或請店長當面說明？", choices: [{ id: "compensate", name: "核准補償・NT$ 55・口碑回升" }, { id: "explain", name: "由店長說明・不支出" }] },
        festival: { title: "收到慶典合作邀約", description: outlet.name + "獲邀參與下週夜市慶典；可以投入宣傳換取營收 Bonus，或維持日常節奏。", choices: [{ id: "promote", name: "接受邀約・NT$ 70・下夜 Bonus +NT$ 130" }, { id: "decline", name: "婉拒邀約・不增加成本" }] }
      };
      state.managerEvent = { ...incidents[type], id: "manager-event-" + state.day, type, outletId: outlet.id };
    }
    resetDailyFeaturedDish();
    const closingMessage = closingEvents.length ? "打烊發現：" + closingEvents.map((item) => item.message).join(" ") + " " : "";
    const focusMessage = weeklyFocusResult ? " " + weeklyFocusResult.message : "";
    if (monthlyClose) return response(true, closingMessage + "第 " + monthlyClose.period + " 期已結帳，財務報表與本期故事走向「" + monthlyClose.outcome.title + "」已歸檔。夜市持續營業，第 " + state.day + " 夜開始。" + (weeklyClose?.balanced ? " 本週試算平衡。" : "") + focusMessage);
    if (weeklyClose) return response(true, closingMessage + "第 " + weeklyClose.week + " 週工作底稿已歸檔，試算" + (weeklyClose.balanced ? "平衡" : "待核對") + "；新的一週開始前，請選擇經營方向。" + focusMessage);
    return response(true, closingMessage + (weeklyDecision
      ? "第 " + (state.day - 1) + " 夜結束。新的一週開始前，選擇擴大店家、招募人手、併購攤販，或暫時保留現金。"
      : "新的一晚開始了，港邊又亮起幾盞燈。"));
  }

  function restartCampaign() {
    const fresh = freshState();
    pendingAchievementAwards.length = 0;
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
    weeklyFocusMilestoneNotices.length = 0;
    trackedWeeklyFocusKey = state.weeklyFocus ? state.weeklyFocus.id + ":" + state.weeklyFocus.startDay : "";
    lastWeeklyFocusProgress = Math.max(0, Number(state.weeklyFocus?.progress) || 0);
    return response(true, "新的夜市世界已開張。先備料、排班，再掛燈迎客。");
  }

  return { openDoors, chooseMarketCard, borrowWorkingCapital, repayWorkingCapital, serveDish, resolveComplaint, resolveSafetyIncident, buyStock, upgradeEquipment, buyUpgrade, toggleStaff, selectDish, chooseStory, chooseWeeklyDecision, nextNight, restartCampaign,
    buyOutletStock, toggleOutlet, upgradeOutletEquipment, upgradeOutletSafety, upgradeStallTier, toggleAccidentCoverage, hireOutletManager, dismissOutletManager, resolveManagerEvent,
    releaseCrewMember,
    markJournalViewed, markStatementViewed, markAchievementListSeen, drainAchievementAwards,
    drainWeeklyFocusMilestones: () => weeklyFocusMilestoneNotices.splice(0),
    getEvent: event, getGuests: guests, getStaffCost: () => staffCost(state), getIncome: () => state.ledger ? ledgerIncome(state.ledger) : 0 };
}


import { DATA, createOutletInventory, getOutletProduct, getOutletSpecialty, outletAvailableStock, outletRetailPrice } from "./data.js";
import { ACQUISITION_TYPES, ENDINGS, WEEKLY_OPTIONS, isWeeklyDecisionDay, selectEnding, weeklyOptionCost } from "./campaign.js";
import {
  createLedger, fixedOperatingCost, getFoodCost, getPurchasePrice, getTonightGuests, hasBrandAlliance,
  ledgerIncome, ledgerNet, freshState, loadState, marketCardChoice, money, saveState, staffCost,
  todayEvent, todayMarketCard, todayStory, getUnlockedDishes
} from "./state.js";
import { getMonthlyInsurance, getNextStallTier, getOutletCapacity, getOutletSafetyLevel, getOutletTier, getTierReadiness, hasCurrentCoverage, isInsuranceBillingDay, INSURANCE_RATES, OUTLET_SAFETY_EQUIPMENT } from "./safety.js";
import {
  closeDepreciation, closeMonthlyStatements, closeWeeklyWorksheet, closeInsuranceRefundAdjustments, collectInsuranceRefundReceivables,
  recordAssetPurchase, recordExpense, recordInventoryPurchase, recordLoanDraw,
  recordLoanRepayment, recordOperatingClose, recordRefund, recordSale,
  recordInsuranceClaimAccrual, collectInsuranceClaims, recordCashVariance, postJournal
} from "./accounting.js";
import { evaluateAchievements, normalizeAchievementState } from "./achievements.js";

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
  const guests = () => getTonightGuests(state);
  const event = () => todayEvent(state);
  const pendingAchievementAwards = [];
  const response = (ok, message, changed = ok) => {
    if (ok) pendingAchievementAwards.push(...evaluateAchievements(state));
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

  function rollSafetyIncident() {
    state.safetyIncident = null;
    state.recalledDishIds = [];
    const main = (state.outlets || []).find((outlet) => outlet.id === "main");
    const fire = getOutletSafetyLevel(state, main, "fire");
    const ventilation = getOutletSafetyLevel(state, main, "ventilation");
    const coldStorage = getOutletSafetyLevel(state, main, "coldStorage");
    const risk = Math.max(0.035, 0.14 - fire * 0.025 - ventilation * 0.012 - coldStorage * 0.022);
    if (randomUnit() >= risk) return null;
    const incidents = DATA.safetyIncidents;
    const totalWeight = incidents.reduce((sum, item) => sum + item.weight, 0);
    let cursor = randomUnit() * totalWeight;
    const selected = incidents.find((item) => (cursor -= item.weight) < 0) || incidents[incidents.length - 1];
    const unlocked = getUnlockedDishes(state).map(({ dish }) => dish);
    const affectedDish = selected.dishRecall && unlocked.length
      ? unlocked[Math.floor(randomUnit() * unlocked.length)] : null;
    state.safetyIncident = { ...selected, status: "pending", day: state.day, outletId: "main",
      dishId: affectedDish?.id || null, affectedDishName: affectedDish?.name || null };
    return state.safetyIncident;
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

  function applyPromotionOutcome() {
    state.marketCardOutcome = null;
    const card = todayMarketCard(state);
    const choiceId = marketCardChoice(state);
    let outcomes = null;
    if (card?.id === "media-interview" && choiceId === "accept-interview") {
      outcomes = [
        { limit: 0.18, guestBonus: 0, fameChange: -2, summary: "採訪片段被剪成意外花絮，口碑 −2，今晚沒有額外來客。" },
        { limit: 0.72, guestBonus: 1, fameChange: 2, summary: "節目播出後有一桌觀眾循著招牌來訪，口碑 +2。" },
        { limit: 1, guestBonus: 2, fameChange: 4, summary: "採訪暖心片段意外傳開，兩桌觀眾循著招牌來訪，口碑 +4。" }
      ];
    } else if (card?.id === "celebrity-visit" && choiceId === "host-visit") {
      outcomes = [
        { limit: 0.16, guestBonus: 0, fameChange: 0, summary: "主持人臨時改了行程；接待費仍列為宣傳支出，沒有帶來額外客流。" },
        { limit: 0.62, guestBonus: 1, fameChange: 2, summary: "主持人低調到訪並分享照片，一桌粉絲循線來訪，口碑 +2。" },
        { limit: 1, guestBonus: 3, fameChange: 4, summary: "到訪短片快速傳開，三桌新客循著打卡點來訪，口碑 +4。" }
      ];
    } else if (card?.id === "paid-promotion" && ["buy-ad", "buy-placement"].includes(choiceId)) {
      outcomes = choiceId === "buy-ad" ? [
        { limit: 0.2, guestBonus: 0, fameChange: -1, summary: "短影音受眾不太對盤；行銷費已入帳，曝光反應普通，口碑 −1。" },
        { limit: 0.72, guestBonus: 1, fameChange: 1, summary: "短影音帶來一桌新客，口碑 +1。" },
        { limit: 1, guestBonus: 2, fameChange: 3, summary: "短影音被大量分享，兩桌新客循線來訪，口碑 +3。" }
      ] : [
        { limit: 0.22, guestBonus: 0, fameChange: -2, summary: "節目置入與觀眾期待不合；行銷費已入帳，口碑 −2，沒有額外來客。" },
        { limit: 0.62, guestBonus: 2, fameChange: 2, summary: "節目置入帶來兩桌觀眾，口碑 +2。" },
        { limit: 1, guestBonus: 3, fameChange: 4, summary: "節目置入成為熱門話題，三桌觀眾循線來訪，口碑 +4。" }
      ];
    }
    if (!outcomes) return "";
    const draw = randomUnit();
    const outcome = outcomes.find((item) => draw < item.limit) || outcomes[outcomes.length - 1];
    state.marketCardOutcome = { day: state.day, cardId: card.id, summary: outcome.summary,
      guestBonus: outcome.guestBonus, fameChange: outcome.fameChange };
    state.fame = Math.max(0, Math.min(100, Number(state.fame) + outcome.fameChange));
    return outcome.summary;
  }

  function resolveClosingSurprises() {
    const resolved = [];
    const chance = randomUnit();
    if (chance < DATA.economy.counterfeitProbability) {
      const amount = 80 + Math.floor(randomUnit() * 4) * 20;
      state.coins -= amount;
      state.ledger.cashShort += amount;
      recordCashVariance(state, "short", "收銀時發現一張假鈔／假幣，面額 " + money(amount), amount);
      resolved.push({ kind: "counterfeit", amount, message: "打烊驗鈔發現假鈔／假幣，短少 " + money(amount) + "，已列現金短溢損失。" });
    } else if (chance < DATA.economy.counterfeitProbability + DATA.economy.underchargeProbability) {
      const amount = 35 + Math.floor(randomUnit() * 4) * 15;
      state.coins -= amount;
      state.ledger.cashShort += amount;
      recordCashVariance(state, "short", "加價購漏收／少收款 " + money(amount), amount);
      resolved.push({ kind: "undercharge", amount, message: "對帳發現一筆加價購漏收／少收 " + money(amount) + "，列現金短溢損失。" });
    } else if (chance < DATA.economy.counterfeitProbability + DATA.economy.underchargeProbability + DATA.economy.cashOverageProbability) {
      const amount = 20 + Math.floor(randomUnit() * 4) * 10;
      state.coins += amount;
      state.ledger.cashOver += amount;
      recordCashVariance(state, "over", "收銀盤點發現未能辨認來源的溢收 " + money(amount), amount);
      resolved.push({ kind: "cash-over", amount, message: "收銀盤點多出 " + money(amount) + "，暫列現金短溢收益；若能辨認為顧客溢付款，應轉列退款負債並退還。" });
    } else if (chance < DATA.economy.counterfeitProbability + DATA.economy.underchargeProbability + DATA.economy.cashOverageProbability + DATA.economy.customerOverchargeProbability) {
      const amount = 40 + Math.floor(randomUnit() * 4) * 15;
      state.coins += amount;
      state.ledger.sales += amount;
      recordSale(state, { dishName: "加價購・錯誤收款", price: amount });
      state.coins -= amount;
      state.ledger.refunds += amount;
      recordRefund(state, amount);
      resolved.push({ kind: "customer-overcharge", amount, message: "發現一筆加價購多收 " + money(amount) + "；已退回並以銷貨折讓調整，不留下額外收益。" });
    }

    if (randomUnit() < DATA.economy.secretShopperProbability) {
      const results = Array.isArray(state.results) ? state.results : [];
      const positiveRate = results.length ? results.filter((result) => result.good).length / results.length : 0;
      const positive = randomUnit() < 0.28 + positiveRate * 0.52;
      const fameChange = positive ? 3 : -2;
      state.fame = Math.max(0, Math.min(100, Number(state.fame) + fameChange));
      resolved.push({ kind: "secret-shopper", outcome: positive ? "positive" : "negative",
        message: positive ? "秘密客留下好評，稱讚餐點與招呼都很到位；口碑 +3。" : "秘密客留下負評，提到等待與服務細節；口碑 −2。" });
    }

    if (randomUnit() < DATA.economy.secretInspectionProbability) {
      const hood = Number(state.equipment?.hood) || 0;
      const cooler = Number(state.equipment?.cooler) || 0;
      const awning = Number(state.equipment?.awning) || 0;
      const quality = Array.isArray(state.results) && state.results.length
        ? state.results.filter((result) => result.good).length / state.results.length : 0;
      const passChance = Math.min(0.86, 0.32 + hood * 0.12 + cooler * 0.1 + awning * 0.06 + quality * 0.18);
      const passed = randomUnit() < passChance;
      if (passed) {
        const reward = 50;
        state.coins += reward;
        state.ledger.subsidies += reward;
        postJournal(state, "秘密衛生稽查通過獎勵", [{ account: "1000", debit: reward }, { account: "4020", credit: reward }],
          { category: "operating", amount: reward });
        state.fame = Math.min(100, Number(state.fame) + 2);
        resolved.push({ kind: "secret-inspection", outcome: "pass", amount: reward,
          message: "秘密衛生稽查通過，獲得市集獎勵 " + money(reward) + "、口碑 +2。" });
      } else {
        const fine = 85;
        state.coins -= fine;
        state.ledger.fees += fine;
        recordExpense(state, "5400", "秘密衛生稽查・臨時整改罰款", fine);
        state.fame = Math.max(0, Number(state.fame) - 2);
        resolved.push({ kind: "secret-inspection", outcome: "fail", amount: fine,
          message: "秘密衛生稽查發現備料標示／工作檯整理未達標，整改罰款 " + money(fine) + "、口碑 −2。" });
      }
    }
    return resolved;
  }

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
    if (state.coins < nextTier.buildCost) return response(false, "現金不足，無法支付攤型改建費 " + money(nextTier.buildCost) + "。", false);
    outlet.tier = nextTier.id;
    state.coins -= nextTier.buildCost;
    recordAssetPurchase(state, { id: outlet.id + "-stall-tier-" + nextTier.id + "-day-" + state.day,
      name: outlet.name + "｜" + nextTier.name + "改建", cost: nextTier.buildCost,
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
    state.phase = "prep";
    resetDailyFeaturedDish();
    if (!allianceBefore && hasBrandAlliance(state)) return response(true, "夜市品牌聯盟成立：每夜多一桌聯盟來客，聯合採購享進價 9 折。");
    return response(true, id === "hold" ? "保留現金，照目前規模進入新的一週。" : decisionName + "已完成，往後每夜固定成本與客流效果同步更新。");
  }

  function nextNight() {
    if (state.phase !== "report" || !state.reportChoice) return response(false, "先完成今晚的打烊選擇。", false);
    const closingEvents = resolveClosingSurprises();
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
      safetyIncident: state.safetyIncident ? {
        title: state.safetyIncident.title, choice: state.safetyIncident.choice || null,
        expense: Number(state.safetyIncident.expensePosted) || 0, claim: Number(state.safetyIncident.claimAmount) || 0
      } : null,
      closingEvents,
      promotionOutcome: state.marketCardOutcome?.summary || null,
      recipesUnlocked: (Array.isArray(state.recipeLog) ? state.recipeLog : [])
        .filter((entry) => Number(entry.day) === Number(state.day)).map((entry) => entry.recipeId),
      net, guests: state.results.map((result) => result.name) });
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
        equipment: { title: "設備開始異音", description: outlet.name + "回報營運設備運轉不穩。要安排打烊後維修，或讓店長下週先降載營運？", choices: [{ id: "repair", name: "安排維修・NT$ 85" }, { id: "defer", name: "暫緩處理・下週少接一單" }] },
        complaint: { title: "分店客訴升級", description: outlet.name + "遇到一位不滿排隊安排的客人。由總部核准補償，或請店長當面說明？", choices: [{ id: "compensate", name: "核准補償・NT$ 55・口碑回升" }, { id: "explain", name: "由店長說明・不支出" }] },
        festival: { title: "收到慶典合作邀約", description: outlet.name + "獲邀參與下週夜市慶典；可以投入宣傳換取營收 Bonus，或維持日常節奏。", choices: [{ id: "promote", name: "接受邀約・NT$ 70・下夜 Bonus +NT$ 130" }, { id: "decline", name: "婉拒邀約・不增加成本" }] }
      };
      state.managerEvent = { ...incidents[type], id: "manager-event-" + state.day, type, outletId: outlet.id };
    }
    resetDailyFeaturedDish();
    const closingMessage = closingEvents.length ? "打烊發現：" + closingEvents.map((item) => item.message).join(" ") + " " : "";
    if (monthlyClose) return response(true, closingMessage + "第 " + monthlyClose.period + " 期已結帳，財務報表與本期故事走向「" + monthlyClose.outcome.title + "」已歸檔。夜市持續營業，第 " + state.day + " 夜開始。" + (weeklyClose?.balanced ? " 本週試算平衡。" : ""));
    if (weeklyClose) return response(true, closingMessage + "第 " + weeklyClose.week + " 週工作底稿已歸檔，試算" + (weeklyClose.balanced ? "平衡" : "待核對") + "；新的一週開始前，請選擇經營方向。");
    return response(true, closingMessage + (weeklyDecision
      ? "第 " + (state.day - 1) + " 夜結束。新的一週開始前，選擇擴大店家、招募人手、併購攤販，或暫時保留現金。"
      : "新的一晚開始了，港邊又亮起幾盞燈。"));
  }

  function restartCampaign() {
    const fresh = freshState();
    pendingAchievementAwards.length = 0;
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
    return response(true, "新的夜市世界已開張。先備料、排班，再掛燈迎客。");
  }

  return { openDoors, chooseMarketCard, borrowWorkingCapital, repayWorkingCapital, serveDish, resolveComplaint, resolveSafetyIncident, buyStock, upgradeEquipment, buyUpgrade, toggleStaff, selectDish, chooseStory, chooseWeeklyDecision, nextNight, restartCampaign,
    buyOutletStock, toggleOutlet, upgradeOutletEquipment, upgradeOutletSafety, upgradeStallTier, toggleAccidentCoverage, hireOutletManager, dismissOutletManager, resolveManagerEvent,
    releaseCrewMember,
    markJournalViewed, markStatementViewed, markAchievementListSeen, drainAchievementAwards,
    getEvent: event, getGuests: guests, getStaffCost: () => staffCost(state), getIncome: () => state.ledger ? ledgerIncome(state.ledger) : 0 };
}


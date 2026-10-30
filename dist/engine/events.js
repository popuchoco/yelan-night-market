import { DATA } from "../data.js";
import { getOutletSafetyLevel } from "../safety.js";
import { getUnlockedDishes, marketCardChoice, money, todayMarketCard } from "../state.js";
import { postJournal, recordCashVariance, recordExpense, recordRefund, recordSale } from "../accounting.js";

export function createEventActions({ state, randomUnit }) {
  function claimSettlementNotes(day) {
    const settled = (Array.isArray(state.insuranceClaims) ? state.insuranceClaims : [])
      .filter((claim) => claim?.status === "collected" && Number(claim.collectionDay) === Number(day));
    return settled.map((claim) => {
      const incident = DATA.safetyIncidents.find((item) => item.id === claim.incidentId);
      return {
        title: String(claim.description || incident?.title || "營運事故"),
        amount: Math.max(0, Math.round(Number(claim.amount) || 0)),
        story: incident?.claimSettlementStory || "理賠款已收回；後續改善事項留在夜市交班紀錄。"
      };
    });
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
        recordExpense(state, "5400", "秘密衛生稽查・限期改善罰款", fine);
        state.fame = Math.max(0, Number(state.fame) - 2);
        resolved.push({ kind: "secret-inspection", outcome: "fail", amount: fine,
          message: "秘密衛生稽查發現備料標示／工作檯整理未達標，限期改善罰款 " + money(fine) + "、口碑 −2。" });
      }
    }
    return resolved;
  }

  return { rollSafetyIncident, applyPromotionOutcome, resolveClosingSurprises, claimSettlementNotes };
}

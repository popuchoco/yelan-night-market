import { DATA } from "./data.js";

// Weekly focus connects the existing investment choices with daily operations.
// It is optional pressure: missing a focus never deducts cash or reputation.
export const WEEKLY_FOCUSES = Object.freeze({
  opening: Object.freeze({
    id: "opening", title: "讓巷口記住夜嵐", icon: "🏮", target: 18, activity: "served",
    description: "本週完成 18 位客人的點餐服務。"
  }),
  expand: Object.freeze({
    id: "expand", title: "讓新桌區熱鬧起來", icon: "🪑", target: 24, activity: "served",
    description: "本週完成 24 位客人的點餐服務，讓新座位迎來街坊。"
  }),
  hire: Object.freeze({
    id: "hire", title: "陪新夥伴站穩崗位", icon: "🧑🏻‍🍳", target: 12, activity: "good-service",
    description: "本週讓 12 位客人吃得滿意，熟悉新夥伴的服務節奏。"
  }),
  acquire: Object.freeze({
    id: "acquire", title: "讓新攤融入巷口", icon: "🏮", target: 3, activity: "branch-night",
    description: "本週讓分店至少有 3 個營業夜完成商品銷售。"
  }),
  hold: Object.freeze({
    id: "hold", title: "替小店留一點餘裕", icon: "🧭", target: 5, activity: "solvent-night",
    description: "本週至少 5 夜維持現金為正，且不新增週轉借款。"
  })
});

const FOCUS_BY_DECISION = Object.freeze({
  expand: "expand",
  hire: "hire",
  acquire: "acquire",
  hold: "hold"
});

export function getWeeklyFocusDefinition(id) {
  return WEEKLY_FOCUSES[id] || null;
}

export function getOnboardingTier(day) {
  return Math.max(1, Math.floor(Number(day) || 1)) <= 7 ? "business-only" : "full";
}

function focusUnit(id) {
  return id === "acquire" || id === "hold" ? "夜" : "桌";
}

const FIRST_WEEK_EVENT_CUES = Object.freeze({
  festival: "燈節會多一桌旅人並帶來活動 Bonus；先確認備料是否足夠。",
  complaint: "尖峰等候容易引發客訴；先確認備料與人手，營業中可從事件入口處理。",
  rain: "雨夜能源支出較高；先確認帆布棚與爐火設備。",
  supplier: "今晚食材進價上漲；先盤點庫存，只補真正缺少的品項。",
  "street-music": "巷口演奏會提高每桌小費；備料到位即可，不必為活動額外支出。",
  "market-sale": "今晚有聯合採購折扣；先確認缺料再補，避免囤貨。",
  inspection: "今晚有設備巡查；開門前檢查爐台、排煙與安全設備。",
  blackout: "臨時接電會增加費用；開門前確認照明與爐台設備。"
});

function firstWeekStockCue(stock) {
  if (!stock || typeof stock !== "object") return "";
  const low = DATA.ingredients.filter((ingredient) => {
    const quantity = Number(stock[ingredient.id]);
    return Number.isFinite(quantity) && quantity <= 1;
  });
  if (!low.length) return "";
  const items = low.slice(0, 2).map((ingredient) => {
    const quantity = Math.max(0, Math.floor(Number(stock[ingredient.id]) || 0));
    return ingredient.name + (quantity === 0 ? "缺貨" : "剩 " + quantity + " 份");
  });
  const extra = low.length > 2 ? "，另有 " + (low.length - 2) + " 項偏低" : "";
  return "備料提醒：" + items.join("、") + extra + "。";
}

/** Read-only nightly guidance derived from the current focus, event and stock. */
export function getTonightHint(state, { event = null } = {}) {
  const day = Math.max(1, Math.floor(Number(state?.day) || 1));
  const phase = state?.phase || "prep";
  const onboardingTier = getOnboardingTier(day);
  const focus = state?.weeklyFocus;
  const definition = focus && !focus.resolved ? WEEKLY_FOCUSES[focus.id] : null;
  const progress = definition ? Math.max(0, Math.min(Number(focus.target) || definition.target, Number(focus.progress) || 0)) : 0;
  const target = definition ? Math.max(1, Number(focus.target) || definition.target) : 0;
  const remaining = definition ? Math.max(0, target - progress) : null;
  const unit = definition ? focusUnit(definition.id) : "";
  let headline = "先熟悉今晚的營運節奏";
  let action = "確認備料與班表，再掛燈迎客。";
  let contextLine = "";

  const focusAction = !definition || remaining === 0 ? "" : (
    definition.id === "opening" || definition.id === "expand" ? "再接待 " + remaining + " 桌"
      : definition.id === "hire" ? "再讓 " + remaining + " 桌客人滿意"
        : definition.id === "acquire" ? "讓分店再營業 " + remaining + " 夜"
          : "再維持現金為正 " + remaining + " 夜，且不新增週轉金");

  if (phase === "service") {
    headline = focusAction && ["opening", "expand", "hire"].includes(definition?.id)
      ? focusAction + "，推進本週焦點"
      : "先招呼眼前客人，讓今晚營運順順走";
    action = "優先選有庫存的推薦餐點；售完時改選其他料理。";
  } else if (phase === "report") {
    headline = "替今晚留下心意，再準備迎接明晚";
    action = "選一段手記，回看這一夜留下的營運結果。";
  } else if (phase === "prep") {
    if (focusAction) headline = focusAction + "，推進本週焦點";
    else if (definition && remaining === 0) headline = "本週焦點已達標，今晚穩定營運即可";
    action = onboardingTier === "business-only"
      ? "先確認備料與班表，再掛燈迎客。進階帳務和保險仍可隨時查看。"
      : "確認備料與班表，準備掛燈迎客。";
    if (onboardingTier === "business-only") {
      const eventCue = FIRST_WEEK_EVENT_CUES[event?.id] || "";
      const stockCue = firstWeekStockCue(state?.stock);
      contextLine = [eventCue, stockCue].filter(Boolean).join(" ");
    }
  }

  let focusLine = definition ? "本週焦點・" + definition.title + "・" + progress + " / " + target + " " + unit : "尚未設定本週焦點";
  if (definition && remaining > 0) focusLine += "・還差 " + remaining + " " + unit;
  else if (definition) focusLine += "・已達標";

  return { day, phase, onboardingTier, focusId: definition?.id || null,
    focusTitle: definition?.title || "本週經營焦點", progress, target, remaining, unit,
    headline, action, contextLine, focusLine };
}

export function getWeeklyFocusIdForDecision(decisionId) {
  return FOCUS_BY_DECISION[decisionId] || "hold";
}

export function createWeeklyFocus(id, startDay, target = null) {
  const definition = WEEKLY_FOCUSES[id] || WEEKLY_FOCUSES.opening;
  const safeTarget = Math.max(1, Math.min(definition.target, Math.floor(Number(target) || definition.target)));
  return { id: definition.id, startDay: Math.max(1, Math.floor(Number(startDay) || 1)),
    progress: 0, target: safeTarget, resolved: false, success: false, result: null };
}

export function normalizeWeeklyFocus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const definition = WEEKLY_FOCUSES[value.id];
  if (!definition) return null;
  const target = Math.max(1, Math.min(definition.target, Math.floor(Number(value.target) || definition.target)));
  const resolved = !!value.resolved;
  const result = value.result && typeof value.result === "object" && !Array.isArray(value.result)
    ? (() => {
        const resultProgress = Math.max(0, Math.min(target, Math.floor(Number(value.result.progress) || 0)));
        const remaining = Math.max(0, target - resultProgress);
        const status = value.result.success ? "complete" : (remaining > 0 && remaining <= 2 ? "near" : "missed");
        const unit = focusUnit(definition.id);
        const summary = String(value.result.summary || (status === "complete"
          ? "本週焦點達成，口碑與熟客有所成長。"
          : status === "near" ? "只差 " + remaining + " " + unit + "；本週沒有懲罰，下週可再試。"
            : "本週完成 " + resultProgress + " / " + target + "，沒有額外扣款。"));
        return {
        id: definition.id,
        title: definition.title,
        success: !!value.result.success,
        progress: resultProgress,
        target,
        remaining,
        unit,
        status,
        summary: summary.slice(0, 220),
        startDay: Math.max(1, Math.floor(Number(value.result.startDay) || Number(value.startDay) || 1)),
        message: String(value.result.message || "").slice(0, 220),
        resolvedDay: Math.max(0, Math.floor(Number(value.result.resolvedDay) || 0))
      };
      })()
    : null;
  return {
    id: definition.id,
    startDay: Math.max(1, Math.floor(Number(value.startDay) || 1)),
    progress: Math.max(0, Math.min(target, Math.floor(Number(value.progress) || 0))),
    target,
    resolved,
    success: resolved && !!value.success,
    result: resolved ? result : null
  };
}

export function recordWeeklyFocusProgress(focus, activity) {
  const definition = WEEKLY_FOCUSES[focus?.id];
  if (!definition || focus.resolved || definition.activity !== activity) return focus;
  focus.progress = Math.min(focus.target, Math.max(0, Number(focus.progress) || 0) + 1);
  return focus;
}

export function resolveWeeklyFocus(focus, { closingDay, coins, loanTakenDay = 0 } = {}) {
  const definition = WEEKLY_FOCUSES[focus?.id];
  const day = Math.max(0, Math.floor(Number(closingDay) || 0));
  if (!definition || focus.resolved || day < focus.startDay || day % 7 !== 0) return null;
  const noNewLoan = focus.id !== "hold" || Number(loanTakenDay) < focus.startDay;
  const solvent = Number(coins) > 0;
  const success = focus.progress >= focus.target && noNewLoan && (focus.id !== "hold" || solvent);
  const reward = "口碑 +2・熟客 +1";
  const message = success
    ? "本週焦點「" + definition.title + "」完成，街坊記住了你的用心（" + reward + "）。"
    : "本週焦點「" + definition.title + "」完成 " + focus.progress + " / " + focus.target + "；沒有額外扣款，下週再接著努力。";
  const progress = Math.max(0, Math.floor(Number(focus.progress) || 0));
  const remaining = Math.max(0, focus.target - progress);
  const status = success ? "complete" : (remaining > 0 && remaining <= 2 ? "near" : "missed");
  const unit = focusUnit(definition.id);
  const summary = success
    ? "本週焦點達成，口碑 +2、熟客 +1。"
    : status === "near" ? "只差 " + remaining + " " + unit + "；本週沒有懲罰，下週可再試。"
      : "本週完成 " + progress + " / " + focus.target + "，沒有額外扣款。";
  const result = { id: definition.id, title: definition.title, success,
    progress, target: focus.target, remaining, unit, status, summary,
    startDay: focus.startDay, message, resolvedDay: day };
  focus.resolved = true;
  focus.success = success;
  focus.result = result;
  return result;
}

export function getLegacyWeeklyFocus(day, decisions = []) {
  const currentDay = Math.max(1, Math.floor(Number(day) || 1));
  const weekStart = Math.floor((currentDay - 1) / 7) * 7 + 1;
  // Older saves have no focus history. At a fresh decision boundary, wait for
  // the player to choose the direction before creating this week's objective.
  if (currentDay > 1 && currentDay % 7 === 1 && !decisions.some((item) => item && Number(item.day) === currentDay)) return null;
  const decision = decisions.filter((item) => item && Number(item.day) >= weekStart && Number(item.day) <= currentDay)
    .sort((a, b) => Number(b.day) - Number(a.day))[0];
  const focusId = decision ? getWeeklyFocusIdForDecision(decision.id) : "opening";
  const nightsRemaining = 7 - ((currentDay - 1) % 7);
  const target = Math.ceil(WEEKLY_FOCUSES[focusId].target * nightsRemaining / 7);
  return createWeeklyFocus(focusId, currentDay, target);
}

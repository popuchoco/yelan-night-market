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
    ? {
        id: definition.id,
        title: definition.title,
        success: !!value.result.success,
        progress: Math.max(0, Math.min(target, Math.floor(Number(value.result.progress) || 0))),
        target,
        startDay: Math.max(1, Math.floor(Number(value.result.startDay) || Number(value.startDay) || 1)),
        message: String(value.result.message || "").slice(0, 220),
        resolvedDay: Math.max(0, Math.floor(Number(value.result.resolvedDay) || 0))
      }
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
  const result = { id: definition.id, title: definition.title, success,
    progress: Math.max(0, Math.floor(Number(focus.progress) || 0)), target: focus.target,
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

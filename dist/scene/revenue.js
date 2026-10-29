const EMPTY_REVENUE = Object.freeze({
  sales: 0,
  tips: 0,
  activity: 0,
  subsidies: 0,
  insuranceClaimRevenue: 0,
  cashOver: 0,
  other: 0,
  adjustments: 0,
  total: 0
});

const amount = (value) => Math.max(0, Math.round(Number(value) || 0));

/** Revenue shown in the scene is gross operating income, not profit or cash balance. */
export function getRevenueBreakdown(ledger) {
  const sales = amount(ledger?.sales);
  const tips = amount(ledger?.tips);
  const activity = amount(ledger?.bonus) + amount(ledger?.storyBonus);
  const subsidies = amount(ledger?.subsidies);
  const insuranceClaimRevenue = amount(ledger?.insuranceClaimRevenue);
  const cashOver = amount(ledger?.cashOver);
  const other = subsidies + insuranceClaimRevenue + cashOver;
  const adjustments = amount(ledger?.cashShort) + amount(ledger?.refunds);
  return { sales, tips, activity, subsidies, insuranceClaimRevenue, cashOver, other, adjustments, total: sales + tips + activity };
}

function activeNight(state) {
  return state.phase === "service" || state.phase === "report";
}

function outletRevenueById(state) {
  return new Map((Array.isArray(state.outlets) ? state.outlets : [])
    .filter((outlet) => outlet && outlet.id !== "main" && Number(outlet.lastResult?.day) === Number(state.day))
    .map((outlet) => [outlet.id, amount(outlet.lastResult?.sales)]));
}

/**
 * Tracks transient, non-persisted income feedback and draws each transaction over its stall.
 * The ledger remains the source of truth; this renderer never writes to game state.
 */
export function createRevenueRenderer(api) {
  const { state, ctx, view, drawRoundRect, eventAnchor } = api;
  let day = Number(state.day);
  let ledgerRef = state.ledger;
  let previous = activeNight(state) ? getRevenueBreakdown(state.ledger) : { ...EMPTY_REVENUE };
  let previousOutlets = activeNight(state) ? outletRevenueById(state) : new Map();
  let target = { ...previous };
  let displayed = { ...previous };
  let lastTime = 0;
  const pulses = [];
  const announcements = [];
  const pulseDuration = 1350;

  function announce(text) {
    if (!text) return;
    announcements.push(text);
    if (announcements.length > 6) announcements.shift();
  }

  function pushPulse(value, label, outletId, time, motionSuppressed = false) {
    const signedAmount = Math.round(Number(value) || 0);
    if (!signedAmount) return;
    const sign = signedAmount > 0 ? "+" : "−";
    const spokenAmount = "新台幣 " + Math.abs(signedAmount) + " 元";
    const note = label.includes("補助") || label.includes("理賠") || label.includes("盤盈")
      ? "；另列其他收入，不併入今晚營業收入。"
      : (signedAmount < 0 ? "；作為收銀差異或退款另列，不列為營收。" : "。" );
    announce(label + "，" + sign + spokenAmount + note);
    if (motionSuppressed) return;
    pulses.push({ amount: signedAmount, label, outletId: outletId || "main", startedAt: time });
    if (pulses.length > 10) pulses.shift();
  }

  function resetNight() {
    day = Number(state.day);
    ledgerRef = state.ledger;
    previous = { ...EMPTY_REVENUE };
    previousOutlets = new Map();
    target = { ...EMPTY_REVENUE };
    displayed = { ...EMPTY_REVENUE };
    pulses.length = 0;
    lastTime = 0;
  }

  function update(time, motionSuppressed = false) {
    if (Number(state.day) !== day) resetNight();
    if (!activeNight(state) || !state.ledger) {
      target = { ...EMPTY_REVENUE };
      displayed = { ...EMPTY_REVENUE };
      previous = { ...EMPTY_REVENUE };
      previousOutlets = new Map();
      ledgerRef = state.ledger;
      lastTime = time;
      return getDisplay();
    }

    if (state.ledger !== ledgerRef) {
      // A new ledger is created when the doors open; start this night's visual totals at zero.
      ledgerRef = state.ledger;
      previous = { ...EMPTY_REVENUE };
      previousOutlets = new Map();
    }

    const current = getRevenueBreakdown(state.ledger);
    const outletValues = outletRevenueById(state);
    let branchDelta = 0;
    for (const [outletId, currentValue] of outletValues) {
      const delta = currentValue - (previousOutlets.get(outletId) || 0);
      if (delta <= 0) continue;
      branchDelta += delta;
      const outlet = state.outlets.find((item) => item.id === outletId);
      pushPulse(delta, (outlet?.name || "分店") + "・自動營運", outletId, time, motionSuppressed);
    }

    const salesDelta = current.sales - previous.sales;
    const tipsDelta = current.tips - previous.tips;
    const activityDelta = current.activity - previous.activity;
    const mainDelta = salesDelta + tipsDelta + activityDelta - branchDelta;
    if (mainDelta > 0) {
      const labels = [];
      if (salesDelta > 0) labels.push("商品銷售");
      if (tipsDelta > 0) labels.push("小費");
      if (activityDelta > 0) labels.push("活動／手記收入");
      pushPulse(mainDelta, labels.join("＋") || "主店營業收入", "main", time, motionSuppressed);
    }

    const otherSources = [
      ["subsidies", "補助收入"],
      ["insuranceClaimRevenue", "保險理賠應收"],
      ["cashOver", "收銀盤盈・其他收入"]
    ];
    otherSources.forEach(([key, label]) => {
      const delta = amount(state.ledger[key]) - amount(ledgerRef === state.ledger ? previous[key] : 0);
      if (delta > 0) pushPulse(delta, label, "main", time, motionSuppressed);
    });

    const shortDelta = current.adjustments - previous.adjustments;
    if (shortDelta > 0) pushPulse(-shortDelta, "收銀短溢／退款調整", "main", time, motionSuppressed);

    target = current;
    previous = current;
    previousOutlets = outletValues;
    const elapsed = lastTime ? Math.max(0, Math.min(0.12, (time - lastTime) / 1000)) : 0.016;
    lastTime = time;
    if (motionSuppressed) displayed = { ...target };
    else {
      const ease = 1 - Math.exp(-elapsed * 8.5);
      Object.keys(target).forEach((key) => {
        const difference = target[key] - displayed[key];
        displayed[key] = Math.abs(difference) < 0.5 ? target[key] : displayed[key] + difference * ease;
      });
    }
    return getDisplay();
  }

  function draw(time, motionSuppressed = false) {
    if (motionSuppressed) return;
    for (let index = pulses.length - 1; index >= 0; index--) {
      const pulse = pulses[index];
      const progress = (time - pulse.startedAt) / pulseDuration;
      if (progress >= 1) { pulses.splice(index, 1); continue; }
      if (progress < 0) continue;
      const sameOutletAbove = pulses.slice(index + 1).filter((item) => item.outletId === pulse.outletId && time - item.startedAt < pulseDuration).length;
      const anchor = eventAnchor(pulse.outletId);
      const rise = 32 * progress;
      const width = Math.min(Math.max(148, pulse.label.length * 8 + 94), Math.max(128, view.w - 24));
      const height = 42;
      const x = Math.max(width / 2 + 10, Math.min(view.w - width / 2 - 10, anchor.x));
      const y = Math.max(94, Math.min(view.h - 112, anchor.y + 40 - rise - sameOutletAbove * 27));
      const alpha = Math.max(0, 1 - progress * progress * 0.92);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = "#080e0d99";
      ctx.shadowBlur = 13;
      ctx.shadowOffsetY = 4;
      drawRoundRect(x - width / 2, y - height / 2, width, height, 12, "#142622f2", pulse.amount < 0 ? "#e98c68aa" : "#edc77c99");
      ctx.shadowColor = "transparent";
      ctx.fillStyle = pulse.amount < 0 ? "#e98c68" : "#edc77c";
      ctx.beginPath();
      ctx.arc(x - width / 2 + 16, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = pulse.amount < 0 ? "#f2aa8a" : "#f6dda0";
      ctx.font = "800 13px system-ui, sans-serif";
      const prefix = pulse.amount < 0 ? "−" : "+";
      ctx.fillText(prefix + "NT$ " + Math.abs(pulse.amount).toLocaleString("zh-TW"), x - width / 2 + 29, y - 6, width - 39);
      ctx.fillStyle = "#c1cdbd";
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.fillText(pulse.label, x - width / 2 + 29, y + 10, width - 39);
      ctx.restore();
    }
  }

  function getDisplay() {
    return { ...displayed, day, settled: state.phase === "report" };
  }

  function drainAnnouncements() {
    return announcements.splice(0, announcements.length);
  }

  function showNotice(value, label, outletId = "main", time = lastTime, motionSuppressed = false) {
    if (Number(state.day) !== day) resetNight();
    pushPulse(value, label, outletId, time, motionSuppressed);
  }

  return { update, draw, getDisplay, drainAnnouncements, showNotice, reset: resetNight };
}

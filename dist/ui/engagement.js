import { ACHIEVEMENTS } from "../achievements.js";
import { getDailyCashbookSummary } from "../accounting.js";
import { hasCurrentCoverage, getMonthlyInsurance, monthlyInsuranceTotals } from "../safety.js";
import { knownRecurringOperatingCost } from "../state.js";
import { getOnboardingTier, getTonightHint, getWeeklyFocusDefinition, getWeeklyFocusIdForDecision } from "../progression.js";

/** Small, read-only feedback surfaces that connect night, week, and period loops. */
export function createEngagementRenderer({
  state, CAMPAIGN_DAYS, campaignCycleDay,
  getStory, money, moneyNet, button, el, append, helper
}) {
  function previousNightRecap() {
    if (state.phase !== "prep" && state.phase !== "decision") return null;
    const previousDay = Math.max(0, Number(state.day) - 1);
    if (!previousDay) return null;
    const entry = (Array.isArray(state.journal) ? state.journal : []).find((item) => Number(item?.day) === previousDay);
    if (!entry) return null;
    const cashbook = entry.cashbook || getDailyCashbookSummary(state, previousDay);
    const card = el("section", "night-recap", null, { "aria-label": "前一夜現金簿摘要" });
    const heading = el("div", "night-recap-heading");
    append(heading, el("span", "night-recap-kicker", "昨夜現金簿"),
      el("b", "", "第 " + previousDay + " 夜・營運小結"));
    card.append(heading);
    if (cashbook?.available) {
      const metrics = el("div", "night-recap-metrics");
      [
        ["現金收入", money(cashbook.income), "income"],
        ["現金支出", money(cashbook.expenses), "expense"],
        ["淨流入", moneyNet(cashbook.net), cashbook.net >= 0 ? "income" : "expense"]
      ].forEach(([label, value, tone]) => {
        const metric = el("div", "night-recap-metric " + tone);
        append(metric, el("span", "", label), el("b", "", value));
        metrics.append(metric);
      });
      card.append(metrics);
    } else {
      card.append(helper("這份舊手記沒有完整現金簿分錄，以下只顯示已保存的營運摘要。", "night-recap-legacy"));
    }
    const detail = el("p", "night-recap-detail");
    const cashDetails = cashbook?.sales !== undefined
      ? "商品 " + money(cashbook.sales) + "・小費 " + money(cashbook.tips) + "・活動／手記 " + money(cashbook.activity)
      : "結帳淨額 " + moneyNet(Number(entry.net) || 0);
    append(detail, el("span", "", cashDetails),
      el("span", "", "服務 " + (Number(cashbook?.satisfiedCount) || Number(entry.goodGuests) || 0) + " / " +
        (Number(cashbook?.guestCount) || (Array.isArray(entry.guests) ? entry.guests.length : 0)) + " 桌"));
    card.append(detail);
    if (cashbook?.focus?.title) {
      const focus = cashbook.focus;
      card.append(el("p", "night-recap-focus", "週焦點・" + focus.title + "　" + focus.progress + " / " + focus.target +
        (focus.resolved ? (focus.success ? "・已完成" : "・本週未達成，沒有懲罰") : "・持續累積")));
    }
    return card;
  }

  function tonightPriority() {
    if (state.phase === "decision") return null;
    const hint = getTonightHint(state);
    const card = el("section", "tonight-priority", null, {
      "aria-label": "今晚一件事",
      "data-onboarding-tier": hint.onboardingTier
    });
    append(card,
      el("span", "tonight-priority-kicker", hint.onboardingTier === "business-only" ? "今晚一件事・先熟悉小店" : "今晚一件事"),
      el("h3", "tonight-priority-title", hint.headline),
      el("p", "tonight-priority-action", hint.action));
    if (hint.target > 0) {
      const focus = el("div", "tonight-priority-focus");
      const copy = el("span", "tonight-priority-focus-copy", hint.focusLine);
      const track = el("div", "tonight-priority-track", null, {
        role: "progressbar", "aria-label": hint.focusTitle,
        "aria-valuemin": 0, "aria-valuemax": hint.target, "aria-valuenow": hint.progress
      });
      track.append(el("span", "", null, { style: "transform:scaleX(" + Math.max(0, Math.min(1, hint.progress / hint.target)) + ")" }));
      append(focus, copy, track);
      card.append(focus);
    }
    if (getOnboardingTier(state.day) === "business-only") {
      card.append(el("span", "tonight-priority-onboarding", "第一週先熟悉備料、出餐與打烊；進階資料仍可從上方分頁隨時查看。"));
    }
    return card;
  }

  function recoveryNotice() {
    const untilDay = Math.max(0, Number(state.outbreakRecoveryUntilDay) || 0);
    if ((state.phase !== "prep" && state.phase !== "decision") || untilDay < Number(state.day)) return null;
    const remaining = untilDay - Number(state.day) + 1;
    return el("aside", "recovery-notice", "食安清消／客流恢復期｜接下來 " + remaining + " 夜客流各少 1 桌；第 " +
      (untilDay + 1) + " 夜起恢復。", { role: "status", "aria-live": "polite" });
  }

  function periodOpeningRecap() {
    if (Number(state.day) <= CAMPAIGN_DAYS || campaignCycleDay(state.day) !== 1) return null;
    const story = getStory();
    const report = (Array.isArray(state.accounting?.monthlyReports) ? state.accounting.monthlyReports : [])
      .find((item) => Number(item?.endDay) === Number(state.day) - 1);
    if (!story && !report) return null;
    const section = el("section", "period-opening-recap");
    append(section, el("span", "period-opening-kicker", "新一期・第 " + Math.floor((Number(state.day) - 1) / CAMPAIGN_DAYS + 1) + " 期"),
      el("h3", "", story?.title || "帳本翻到新的一頁"),
      el("p", "", story?.story || "上一期的營運紀錄已歸檔；新的夜市週期從今晚繼續。"));
    if (report) {
      const outcome = report.outcome?.title || "本期結帳完成";
      section.append(el("p", "period-opening-result", "上一期走向・" + outcome + "　｜　結帳淨利 " + moneyNet(report.totals?.profit)));
      section.append(button("重看上一期財報", "open-report", { id: "monthly" }, false, "period-opening-report"));
    }
    return section;
  }

  function weeklyMilestoneRecap() {
    if (state.phase !== "decision") return null;
    const lowerBound = Number(state.day) - 7;
    const recent = ACHIEVEMENTS.filter((item) => {
      const record = state.achievements?.unlocked?.[item.id];
      return record && Number(record.day) > lowerBound && Number(record.day) <= Number(state.day);
    });
    if (!recent.length) return null;
    const section = el("section", "weekly-milestone-recap");
    append(section, el("span", "weekly-milestone-kicker", "本週新記下的里程碑"),
      el("p", "", recent.map((item) => item.icon + " " + item.title).join("　・　")));
    return section;
  }

  function riskChainRecap() {
    if (state.phase !== "decision") return null;
    const day = Math.max(1, Number(state.day) || 1);
    const recentIncidents = (Array.isArray(state.journal) ? state.journal : [])
      .filter((entry) => Number(entry?.day) >= day - 7 && Number(entry?.day) < day && entry?.safetyIncident?.title);
    const pendingClaims = (Array.isArray(state.insuranceClaims) ? state.insuranceClaims : [])
      .filter((claim) => claim?.status === "receivable" && Number(claim.amount) > 0);
    const claimTotal = pendingClaims.reduce((sum, claim) => sum + Math.max(0, Number(claim.amount) || 0), 0);
    const nextClaimDay = pendingClaims.length
      ? Math.min(...pendingClaims.map((claim) => Math.max(1, Number(claim.payoutDay) || day))) : null;
    const cycleStart = Math.floor((day - 1) / CAMPAIGN_DAYS) * CAMPAIGN_DAYS + 1;
    const snapshotReady = Number(state.insuranceSnapshot?.periodStartDay) === cycleStart;
    const expectedPolicies = [];
    (Array.isArray(state.outlets) ? state.outlets : []).forEach((outlet) => {
      const coverage = getMonthlyInsurance(state, outlet);
      const prefix = outlet?.name || "店面";
      if (coverage.mandatoryEmployerCoverage) {
        expectedPolicies.push({ outlet, policy: "accident", label: prefix + "・職災" });
        expectedPolicies.push({ outlet, policy: "labor", label: prefix + "・勞保" });
        expectedPolicies.push({ outlet, policy: "health", label: prefix + "・健保" });
      } else if (coverage.accident > 0) {
        expectedPolicies.push({ outlet, policy: "accident", label: prefix + "・雇主職災加保" });
      }
      if (coverage.product > 0) expectedPolicies.push({ outlet, policy: "product", label: prefix + "・產品責任" });
      if (coverage.public > 0) expectedPolicies.push({ outlet, policy: "public", label: prefix + "・公共意外" });
    });
    const snapshotOutlet = (outletId) => (state.insuranceSnapshot?.outlets || []).find((item) => item.outletId === outletId);
    const policyCovered = (outlet, policy) => {
      if (!snapshotReady) return false;
      if (policy === "labor" || policy === "health") {
        return Number(snapshotOutlet(outlet.id)?.perEmployee?.[policy]) > 0;
      }
      return hasCurrentCoverage(state, outlet.id, policy);
    };
    const coveredCount = expectedPolicies.filter((item) => policyCovered(item.outlet, item.policy)).length;
    const gaps = expectedPolicies.filter((item) => !policyCovered(item.outlet, item.policy)).map((item) => item.label);
    const premium = monthlyInsuranceTotals(state).total;
    const section = el("details", "risk-chain-card", null, { "aria-label": "營運風險與保險追蹤" });
    const summary = el("summary", "risk-chain-summary");
    const overview = pendingClaims.length
      ? "近 7 夜 " + recentIncidents.length + " 件事故・待收 " + money(claimTotal)
      : "近 7 夜 " + recentIncidents.length + " 件事故・無待收理賠";
    append(summary,
      el("span", "risk-chain-kicker", "本週風險追蹤"),
      el("b", "risk-chain-summary-line", overview),
      el("span", "risk-chain-hint", "展開查看保障與保費"));
    section.append(summary);
    const details = el("div", "risk-chain-details");
    append(details, el("h3", "", "事故、保障與理賠會跨夜延續"));
    const metrics = el("div", "risk-chain-metrics");
    const incidentMetric = el("div", "risk-chain-metric", null, { "aria-label": "近七夜事故" });
    const claimsMetric = el("div", "risk-chain-metric", null, { "aria-label": "待收理賠" });
    const premiumMetric = el("div", "risk-chain-metric", null, { "aria-label": "下期保費估算" });
    const incidentText = recentIncidents.length
      ? recentIncidents.slice(0, 2).map((entry) => "第 " + entry.day + " 夜・" + entry.safetyIncident.title).join("；")
      : "近 7 夜沒有重大安全事件";
    const claimText = pendingClaims.length
      ? pendingClaims.length + " 件・待收 " + money(claimTotal) + "・最近預計第 " + nextClaimDay + " 夜入帳"
      : "目前沒有待收理賠款";
    append(incidentMetric, el("span", "", "近 7 夜"), el("b", "", incidentText));
    append(claimsMetric, el("span", "", "理賠追蹤"), el("b", "", claimText));
    append(premiumMetric, el("span", "", "下期保費估算"), el("b", "", money(premium) + " / 期"));
    append(metrics, incidentMetric, claimsMetric, premiumMetric);
    details.append(metrics);
    let coverageText;
    if (!expectedPolicies.length) coverageText = "目前沒有雇主或第三人責任保費項目；流動／固定攤位未由雇主加保的員工仍須自行安排保障。";
    else if (!snapshotReady) coverageText = "本期保障快照尚未建立；首夜開門時會依當時攤型、人力與保單確認。";
    else if (gaps.length) coverageText = "本期已生效 " + coveredCount + " / " + expectedPolicies.length + " 項適用保障；尚未生效：「" + gaps.join("、") + "」。保單異動於下期首夜重新確認。";
    else coverageText = "本期已生效 " + coveredCount + " / " + expectedPolicies.length + " 項適用保障；保費不會消除事故、清消停業或口碑影響。";
    details.append(el("p", "risk-chain-coverage", coverageText));
    details.append(el("p", "risk-chain-note", recentIncidents.length
      ? "手記會留下處置，理賠款則在核認後延後入帳；口碑、熟客與食安恢復仍按各自規則變化。"
      : "安全設備降低部分事故機率，保單協助分攤合格處置費；兩者都不能讓風險歸零。"));
    section.append(details);
    return section;
  }

  function investmentPreview(option, cost, capped, insufficient, currentFixedCost) {
    const projectedCash = Math.max(0, Number(state.coins) - (Number(cost) || 0));
    const addedRecurring = Math.max(0, Number(option.recurring) || 0);
    const projectedFixed = Math.max(0, currentFixedCost) + addedRecurring;
    const projectedRunway = projectedFixed > 0 ? Math.floor(projectedCash / projectedFixed) : null;
    const preview = el("div", "decision-preview" + (projectedRunway !== null && projectedRunway <= 5 ? " is-tight" : ""));
    if (capped) preview.textContent = "目前場景已達容量，無法再投入。";
    else if (insufficient) preview.textContent = "現金不足，這項投資目前無法執行。";
    else {
      const focus = getWeeklyFocusDefinition(getWeeklyFocusIdForDecision(option.id));
      append(preview,
        el("span", "", "投資後每夜固定承諾約 " + money(projectedFixed) + "（月保費按 30 夜攤提）"),
        el("span", "", addedRecurring
          ? "每夜新增 " + money(addedRecurring) + "；接下來 7 夜約增加 " + money(addedRecurring * 7) + " 固定支出"
          : "不增加每夜固定支出"),
        ...(addedRecurring ? [el("span", "", "至少需新增同額每夜貢獻才能打平固定成本；尚未扣食材與事件費。") ] : []),
        ...(projectedRunway === null ? [] : [el("span", "", "扣除一次性投入後，現金按固定承諾估算可支應約 " + projectedRunway + " 夜")]),
        el("span", "decision-preview-caveat", "估算非保證：只計固定支出，未含備料、事件／事故與分店營運變動。"),
        ...(option.id === "acquire" ? [el("span", "", "分店開門後另加每日能源費；店長薪資與升級／保險依實際安排計入。") ] : []),
        ...(focus ? [el("span", "", "本週焦點預覽：" + focus.title + "・0 / " + focus.target)] : []));
    }
    return preview;
  }

  return {
    tonightPriority,
    previousNightRecap,
    recoveryNotice,
    periodOpeningRecap,
    weeklyMilestoneRecap,
    riskChainRecap,
    currentFixedCost: () => knownRecurringOperatingCost(state),
    investmentPreview
  };
}

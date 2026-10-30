import { ACHIEVEMENTS } from "../achievements.js";
import { getDailyCashbookSummary } from "../accounting.js";
import { getWeeklyFocusDefinition, getWeeklyFocusIdForDecision } from "../progression.js";

/** Small, read-only feedback surfaces that connect night, week, and period loops. */
export function createEngagementRenderer({
  state, CAMPAIGN_DAYS, campaignCycleDay, fixedOperatingCost, createLedger,
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

  function investmentPreview(option, cost, capped, insufficient, currentFixedCost) {
    const projectedCash = Math.max(0, Number(state.coins) - (Number(cost) || 0));
    const projectedFixed = Math.max(0, currentFixedCost) + (Number(option.recurring) || 0);
    const projectedRunway = projectedFixed > 0 ? Math.floor(projectedCash / projectedFixed) : null;
    const preview = el("p", "decision-preview" + (projectedRunway !== null && projectedRunway <= 5 ? " is-tight" : ""));
    if (capped) preview.textContent = "目前場景已達容量，無法再投入。";
    else if (insufficient) preview.textContent = "現金不足，這項投資目前無法執行。";
    else {
      const focus = getWeeklyFocusDefinition(getWeeklyFocusIdForDecision(option.id));
      append(preview,
        el("span", "", "投資後已知每夜固定成本約 " + money(projectedFixed)),
        el("span", "", projectedRunway === null ? "目前固定成本為 0" : "以目前現金推估可支應約 " + projectedRunway + " 夜"),
        ...(focus ? [el("span", "", "本週焦點預覽：" + focus.title + "・0 / " + focus.target)] : []));
    }
    return preview;
  }

  return {
    previousNightRecap,
    recoveryNotice,
    periodOpeningRecap,
    weeklyMilestoneRecap,
    currentFixedCost: () => Math.max(0, fixedOperatingCost(createLedger())),
    investmentPreview
  };
}

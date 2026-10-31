// avoid-ai-design-ignore-file: I2, SD4d - food, character, and event marks are in-world content; middle dots separate compact order and ledger facts.
import { DATA, getOutletProduct, getOutletSpecialty, outletAvailableStock, outletRetailPrice } from "./data.js";
import { ACQUISITION_GROUPS, ACQUISITION_TYPES, CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, WEEKLY_DECISION_DAYS, WEEKLY_OPTIONS, acquisitionGroupCounts, campaignCycleDay, isAcquisitionTypeAvailable, weeklyOptionCost } from "./campaign.js";
import { CHART_OF_ACCOUNTS, formatBalance } from "./accounting.js";
import { createReportRenderer } from "./ui/reports.js";
import { createPreparationRenderer } from "./ui/preparation.js";
import { createEngagementRenderer } from "./ui/engagement.js";
import { getOnboardingTier, getWeeklyFocusDefinition } from "./progression.js";
import {
  STALL_TIERS, OUTLET_SAFETY_EQUIPMENT, getMonthlyInsurance, getNextInsuranceBillingDay,
  getOutletEmployeeCount, getOutletSafetyLevel, getOutletTier, getNextStallTier, getTierReadiness,
  hasCurrentCoverage, isInsuranceBillingDay
} from "./safety.js";
import {
  createLedger as createLedgerForState, fixedOperatingCost as ledgerFixedOperatingCost, forecast, getFoodCost as getFoodCostForState,
  hasBrandAlliance,
  getPurchasePrice as getPurchasePriceForState, getTonightGuests as getTonightGuestsForState,
  ledgerIncome, ledgerNet, marketCardChoice, money, staffCost as staffCostForState,
  todayEvent as selectEvent, todayMarketCard, todayStory as selectStory, getUnlockedDishes
} from "./state.js";

// UI nodes are built with DOM APIs so player names, journal entries, and game data
// are always treated as text rather than parsed as markup.
export function createUI(runtime) {
  const { state, saveState, saveStateDetailed } = runtime;
  const { dishes, ingredients, equipment, staff: staffRoles, upgrades } = DATA;
  let activeTab = "ops";
  let journalView = "daily";
  let reportStatement = "income";
  let selectedReportPeriod = null;
  let selectedWeek = null;
  let selectedMonthEnd = null;
  let selectedJournalDay = null;
  let selectedOutletId = null;

  function el(tag, className, text, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (attrs) {
      Object.keys(attrs).forEach(function(key) {
        if (key === "dataset") Object.assign(node.dataset, attrs.dataset);
        else if (key in node) node[key] = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }
  function append(parent, ...children) {
    children.flat().forEach(function(child) {
      if (child) parent.append(child);
    });
    return parent;
  }
  function fragment(...children) {
    return append(document.createDocumentFragment(), ...children);
  }
  function setTab(tab) { activeTab = tab; }
  function setOutletTarget(id) { selectedOutletId = id || null; }
  function todayEvent() { return selectEvent(state); }
  function todayStory() { return selectStory(state); }
  function getTonightGuests() { return getTonightGuestsForState(state); }
  function staffCost() { return staffCostForState(state); }
  function getPurchasePrice(item) { return getPurchasePriceForState(state, item); }
  function getFoodCost(dish) { return getFoodCostForState(state, dish); }
  function createLedger() { return createLedgerForState(state); }

  const engagementRenderer = createEngagementRenderer({
    state, CAMPAIGN_DAYS, campaignCycleDay,
    getStory: todayStory,
    money, moneyNet, button, el, append, helper
  });

  const reportRenderer = createReportRenderer({
    state, dishes, CHART_OF_ACCOUNTS, formatBalance, CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, WEEKLY_DECISION_DAYS,
    campaignCycleDay, money, moneyNet, ledger, el, append, fragment, subhead, helper, storyCard, button,
    getJournalView: () => journalView,
    getReportStatement: () => reportStatement,
    getSelectedJournalDay: () => selectedJournalDay,
    getSelectedReportPeriod: () => selectedReportPeriod,
    getSelectedWeek: () => selectedWeek,
    getSelectedMonthEnd: () => selectedMonthEnd
  });
  const renderJournal = () => reportRenderer.renderJournal();
  const getJournalReportInfo = () => reportRenderer.getJournalReportInfo();
  const renderJournalReport = () => reportRenderer.renderJournalReport();

  function getWorldEventInfo() {
    if (state.phase === "service" && state.safetyIncident?.status === "pending") {
      const incident = state.safetyIncident;
      const policyName = incident.policy === "accident" ? "職災保險" : (incident.policy === "public" ? "公共意外責任險" : "食品業者產品責任險");
      const covered = hasCurrentCoverage(state, incident.outletId, incident.policy);
      return { kind: "safety-incident", icon: incident.icon, label: incident.category === "workplace" ? "職安事件・待處理" : "營運安全事件・待處理",
        title: incident.title, description: incident.description + (incident.affectedDishName ? " 受影響品項：「" + incident.affectedDishName + "」。" : "") +
          (covered ? " 本期已投保" + policyName + "，可選擇提出理賠。" : " 本期未有對應的" + policyName + "保障，可由店家自行負擔。"),
        tone: "negative", pending: true, anchorOutletId: incident.outletId, incident, covered, policyName };
    }
    if (state.phase === "service") {
      const guest = getTonightGuests()[state.customerIndex];
      if (guest && guest.difficult) {
        return { kind: "complaint", icon: guest.icon || "😤", label: "現場客訴・需要處理", title: guest.name + "提出客訴",
          description: guest.line, tone: "negative", pending: true, anchorOutletId: "main" };
      }
    }
    const card = todayMarketCard(state);
    if (card) {
      const choiceId = marketCardChoice(state);
      const choice = choiceId && card.choices.find(function(item) { return item.id === choiceId; });
      const pending = state.phase === "prep" && !choice;
      return { kind: "market-card", icon: card.icon, label: pending ? "市集公告・待選方案" : "市集公告・今晚消息",
        title: card.name, description: state.marketCardOutcome?.cardId === card.id && Number(state.marketCardOutcome.day) === Number(state.day)
          ? state.marketCardOutcome.summary : (choice ? choice.detail : card.description),
        tone: card.tone, pending: pending, anchorOutletId: "main", card: card, choice: choice };
    }
    const event = todayEvent();
    return { kind: "market", icon: event.icon, label: event.tone === "negative" ? "夜市突發狀況" : "今晚夜市消息",
      title: event.name, description: event.description, tone: event.tone, pending: false, anchorOutletId: "main", event: event };
  }

  function getOutletWorldEvents() {
    const branches = (state.outlets || []).filter(function(outlet) { return outlet && outlet.id !== "main"; });
    const events = [];
    if (state.managerEvent) {
      const outlet = branches.find(function(item) { return item.id === state.managerEvent.outletId; });
      if (outlet) events.push({ id: "manager:" + outlet.id, kind: "manager", outletId: outlet.id,
        icon: "⚠️", label: "重大事件", title: state.managerEvent.title,
        description: state.managerEvent.description, tone: "negative", pending: true });
    }
    branches.forEach(function(outlet) {
      if (state.managerEvent && state.managerEvent.outletId === outlet.id) return;
      if (outlet.autoPaused) {
        events.push({ id: "stockout:" + outlet.id, kind: "stockout", outletId: outlet.id,
          icon: "📦", label: "補貨暫停", title: "備料耗盡・營業暫停",
          description: outlet.name + "的商品庫存已用完，分店自動暫停營業。點開可補貨並重新開店。",
          tone: "negative", pending: true });
      } else if (Number(outlet.efficiencyPenalty) > 0) {
        events.push({ id: "equipment:" + outlet.id, kind: "equipment", outletId: outlet.id,
          icon: "🛠️", label: "設備降載", title: "設備維修延後",
          description: outlet.name + "暫以降載方式營運；可在分店設備管理中檢視狀態。",
          tone: "caution", pending: false });
      } else if (Number(outlet.nextNightBonus) > 0) {
        events.push({ id: "bonus:" + outlet.id, kind: "bonus", outletId: outlet.id,
          icon: "🎉", label: "營收加成", title: "分店慶典 Bonus",
          description: outlet.name + "下次營業將獲得 NT$ " + Math.round(Number(outlet.nextNightBonus)) + " 慶典加成。",
          tone: "positive", pending: false });
      }
    });
    return events;
  }

  function renderWorldEventContent() {
    const info = getWorldEventInfo();
    if (info.kind === "safety-incident" && state.safetyIncident?.status === "pending") {
      const incident = state.safetyIncident;
      const panel = el("section", "world-event-options negative");
      const status = el("div", "incident-policy-status");
      append(status,
        el("span", "incident-status-icon", incident.icon),
        el("div", "incident-status-copy",
          info.covered ? "本期保單有效・" + info.policyName : "本期未投保・" + info.policyName),
        el("span", "incident-status-pill", info.covered ? "可申請理賠" : "自費處置"));
      panel.append(status);
      panel.append(el("p", "incident-guidance",
        incident.category === "outbreak"
          ? "先停止出餐、封存可疑批次並安排清消與顧客照護。處理完成後可查看今晚結算。"
          : (incident.dishRecall ? "先安置顧客、下架受影響品項，再完成照護與清消。" : "先暫停受影響工作區，確認人員與顧客安全，再安排照護。")));
      const choices = el("div", "manager-event-choices");
      if (info.covered) {
        choices.append(button("依保單處理並申請理賠　+" + money(incident.claim) + " 應收",
          "resolve-safety-incident", { choice: "claim" }, false, "primary-button"));
      }
      choices.append(button((info.covered ? "店家自行負擔　−" : "完成自費處置　−") + money(incident.expense + (info.covered ? 18 : 0)),
        "resolve-safety-incident", { choice: "self" }, false, "secondary-button"));
      panel.append(choices);
      panel.append(helper("處置費立即列入相應安全／補償科目；理賠先借記應收保險理賠款，預計兩夜後收款。理賠不會取消事件造成的口碑影響。", "helper-copy"));
      return panel;
    }
    if (state.managerEvent) {
      const incident = el("section", "world-event-options");
      incident.append(el("span", "manager-event-kicker", "總部決策・選擇處理方式"));
      const choices = el("div", "manager-event-choices");
      (state.managerEvent.choices || []).forEach(function(choice) {
        const insufficient = state.managerEvent.type === "equipment" && choice.id === "repair" ? state.coins < 85 :
          (state.managerEvent.type === "complaint" && choice.id === "compensate" ? state.coins < 55 :
            (state.managerEvent.type === "festival" && choice.id === "promote" ? state.coins < 70 : false));
        choices.append(button(choice.name, "resolve-manager-event", { choice: choice.id }, insufficient,
          choice.id === "explain" || choice.id === "defer" || choice.id === "decline" ? "secondary-button" : "primary-button"));
      });
      incident.append(choices);
      return incident;
    }
    if (info.kind === "market-card") {
      const panel = el("section", "world-event-options" + (info.tone === "negative" ? " negative" : ""));
      if (info.choice) {
        const result = el("div", "market-announcement-result");
        append(result, el("b", "", "今晚已選擇：" + info.choice.name),
          el("span", "", info.choice.detail + "。"),
          el("span", "announcement-result-preview", marketChoicePreview(info.card, info.choice)));
        panel.append(result);
      } else if (state.phase === "prep") {
        const choices = el("div", "market-announcement-choices");
        info.card.choices.forEach(function(choice) {
          const action = button("", "choose-market-card", { id: choice.id }, choice.cost > 0 && state.coins < choice.cost, "announcement-choice");
          append(action, el("span", "announcement-choice-name", choice.name),
            el("span", "announcement-choice-detail", choice.detail),
            el("span", "announcement-choice-preview", marketChoicePreview(info.card, choice)));
          choices.append(action);
        });
        panel.append(choices);
      } else {
        panel.append(helper(state.phase === "decision"
          ? "完成本週經營方向後，再選擇今晚公告卡的處理方式。"
          : "本夜公告卡選擇已隨營業流程鎖定。", "market-announcement-result"));
      }
      return panel;
    }
    const summary = el("section", "world-event-impact" + (info.tone === "negative" ? " negative" : ""));
    append(summary, el("span", "world-event-impact-icon", info.icon), el("div", "world-event-impact-copy"));
    const copy = summary.querySelector(".world-event-impact-copy");
    append(copy, el("b", "", "今晚營運事件"),
      el("p", "", state.phase === "service"
        ? "事件效果會在今晚營運中反映，營收與支出會隨打烊結算入帳。"
        : "事件效果會在開門與今晚營運中反映，相關金額會列入帳本。"));
    return summary;
  }

  function button(label, action, data, disabled, className) {
    return el("button", className || "secondary-button", label, {
      type: "button", disabled: !!disabled,
      dataset: Object.assign({ action: action }, data || {})
    });
  }
  function subhead(title, detail, compact) {
    return append(el("div", compact ? "subhead compact" : "subhead"),
      el("h3", "", title), el("span", "", detail));
  }
  function helper(text, className) {
    return el("p", className || "helper-copy", text);
  }
  function ledger(rows, net) {
    const card = el("div", "ledger-card");
    rows.forEach(function(row) {
      const line = el("div", "ledger-line" + (row.tone ? " " + row.tone : ""));
      append(line, el("span", "", row.label), el("b", "", row.value));
      card.append(line);
    });
    if (net) {
      const line = el("div", "ledger-net");
      append(line, el("span", "", net.label),
        el("b", net.negative ? "negative" : "", net.value));
      card.append(line);
    }
    return card;
  }
  function guestRow(guest, status, current) {
    const row = el("div", "guest-row" + (current ? " current" : ""));
    const statusNode = el("span", "guest-status" + (current ? " current" : ""), status);
    append(row, el("span", "guest-avatar", guest.icon));
    const info = el("span", "guest-info");
    append(info, el("span", "guest-name", guest.name), el("span", "guest-need", guest.needLabel));
    return append(row, info, statusNode);
  }
  function managerItem(icon, name, note, meta, actionNode) {
    const item = el("article", "manager-item");
    const copy = el("span", "manager-copy");
    append(copy, el("span", "manager-name", name), el("span", "manager-note", note));
    if (meta) copy.append(el("span", "manager-meta", meta));
    return append(item, el("span", "manager-icon", icon), copy, actionNode);
  }
  function moneyNet(value) {
    return (value < 0 ? "−" : "+") + money(Math.abs(value));
  }
  function eventCard(event) {
    const card = el("article", "event-card" + (event.tone === "negative" ? " negative" : ""));
    const copy = el("div", "event-copy");
    append(copy,
      el("div", "event-label", "TONIGHT IN THE MARKET"),
      el("div", "event-name", event.name),
      el("div", "event-desc", event.description));
    return append(card, el("div", "event-icon", event.icon), copy);
  }
  function marketAnnouncement() {
    const card = todayMarketCard(state);
    if (!card) return null;
    const currentChoice = state.marketChoiceDay === state.day
      ? card.choices.find(function(item) { return item.id === state.marketCardChoice; })
      : null;
    const panel = el("section", "market-announcement" + (card.tone === "negative" ? " negative" : ""));
    const heading = el("div", "market-announcement-head");
    append(heading, el("span", "market-announcement-icon", card.icon),
      el("div", "", null, { className: "market-announcement-copy" }));
    const copy = heading.querySelector(".market-announcement-copy");
    append(copy, el("span", "market-announcement-label", "市集公告卡・第 " + state.day + " 夜"),
      el("h3", "", card.name), el("p", "", card.description));
    panel.append(heading);
    if (currentChoice) {
      const result = el("div", "market-announcement-result");
      append(result, el("b", "", "今晚已選擇：" + currentChoice.name),
        el("span", "", currentChoice.detail + "。"),
        el("span", "announcement-result-preview", marketChoicePreview(card, currentChoice)));
      panel.append(result);
    } else if (state.phase === "prep") {
      const choices = el("div", "market-announcement-choices");
      card.choices.forEach(function(choice) {
        const action = button("", "choose-market-card", { id: choice.id }, choice.cost > 0 && state.coins < choice.cost, "announcement-choice");
        append(action, el("span", "announcement-choice-name", choice.name),
          el("span", "announcement-choice-detail", choice.detail),
          el("span", "announcement-choice-preview", marketChoicePreview(card, choice)));
        choices.append(action);
      });
      panel.append(choices);
    } else {
      panel.append(helper(state.phase === "decision"
        ? "完成本週經營方向後，再選擇今晚公告卡的處理方式。"
        : "本夜公告卡選擇已隨營業流程鎖定。", "market-announcement-result"));
    }
    return panel;
  }
  function marketChoicePreview(card, choice) {
    if (state.marketCardOutcome?.cardId === card.id && Number(state.marketCardOutcome.day) === Number(state.day)) {
      return "隨機成效：" + state.marketCardOutcome.summary;
    }
    if (card.id === "tourist-surge") {
      return choice.id === "promote"
        ? "帳務影響：行銷費 −" + money(DATA.economy.touristPromotionCost) + "；預計多 2 桌，營收與食材成本依實際接待入帳。"
        : "帳務影響：今晚不新增公告卡收入或支出，客流維持原預估。";
    }
    if (card.id === "hygiene-audit") {
      if (choice.id === "deep-clean") return "帳務影響：清潔支出 −" + money(DATA.economy.hygieneQuickCleanCost) + "；免本次限期改善費，口碑 +1。";
      const eventNeedsCorrection = selectEvent(state).id === "inspection";
      const equipmentReady = (Number(state.equipment.hood) || 0) > 0 || (Number(state.equipment.awning) || 0) > 0 || !!state.upgrades.lantern;
      const fee = eventNeedsCorrection && !equipmentReady ? 75 : 0;
      return fee
        ? "帳務影響：目前設備未達稽查條件，今晚可能列限期改善費 −" + money(fee) + "；實際以開門結算為準。"
        : (eventNeedsCorrection
          ? "帳務影響：目前設備符合稽查條件，預估不產生限期改善費。"
          : "帳務影響：今晚不執行衛生稽查，不會產生限期改善費。");
    }
    if (card.id === "rain-subsidy") {
      return choice.id === "claim"
        ? "帳務影響：市集補助收入 +" + money(DATA.economy.rainSubsidy) + "，列入今晚營運收支。"
        : "帳務影響：不申請補助，今晚不新增公告卡收入或支出。";
    }
    if (card.id === "media-interview") return choice.id === "accept-interview"
      ? "帳務影響：無行銷費；播出效果隨機，可能口碑 −2～+4、增加 0～2 桌來客。"
      : "帳務影響：不支出、不改變今晚客流。";
    if (card.id === "celebrity-visit") return choice.id === "host-visit"
      ? "帳務影響：接待行銷費 −" + money(DATA.economy.celebrityVisitCost) + "；到訪或臨時改期隨機，成功可增加來客與口碑。"
      : "帳務影響：不支出、不等待名人行程。";
    if (card.id === "paid-promotion") {
      if (choice.id === "buy-ad") return "帳務影響：行銷費 −" + money(DATA.economy.paidAdCost) + "，借記 5410 行銷及宣傳費；效果隨機，可能口碑 −1～+3、增加 0～2 桌。";
      if (choice.id === "buy-placement") return "帳務影響：行銷費 −" + money(DATA.economy.productPlacementCost) + "，借記 5410 行銷及宣傳費；效果隨機，可能口碑 −2～+4、增加 0～3 桌。";
      return "帳務影響：不新增行銷費，保留現金與備料彈性。";
    }
    return "帳務影響：" + choice.detail;
  }
  function storyCard(title, text, className) {
    const card = el("div", className || "story-card");
    append(card, el("h3", "", title), el("p", "", text));
    return card;
  }

  function fixedOperatingCost(value) { return ledgerFixedOperatingCost(value); }

  function allianceStatus(showProgress) {
    const card = el("section", "alliance-status" + (hasBrandAlliance(state) ? " active" : ""));
    const counts = acquisitionGroupCounts(state.acquisitionTypes);
    const leadingGroup = Object.keys(ACQUISITION_GROUPS).sort(function(a, b) { return (counts[b] || 0) - (counts[a] || 0); })[0];
    if (hasBrandAlliance(state)) {
      append(card, el("b", "", "夜市品牌聯盟・已成立"),
        el("span", "", "持續加成：每夜多 1 桌聯盟來客，聯合採購進價 9 折。"));
    } else if (showProgress) {
      append(card, el("b", "", "夜市品牌聯盟・籌備中"),
        el("span", "", "條件：先擴店，再接手 2 間同屬餐飲或遊戲體驗的店。現況：擴店 " + state.expansions + " 次・" +
          ACQUISITION_GROUPS[leadingGroup] + "店 " + (counts[leadingGroup] || 0) + " / 2。"));
    } else return null;
    return card;
  }

  function campaignMeter() {
    const cycleDay = campaignCycleDay(state.day);
    const period = Math.floor((state.day - 1) / CAMPAIGN_DAYS) + 1;
    const meter = el("div", "campaign-meter", null, { role: "progressbar", "aria-label": "本期三十夜財務期間進度", "aria-valuemin": 0, "aria-valuemax": CAMPAIGN_DAYS, "aria-valuenow": cycleDay });
    const label = el("div", "campaign-meter-label");
    append(label, el("span", "", "持續經營・第 " + state.day + " 夜"),
      el("b", "", "第 " + period + " 期・" + cycleDay + " / " + CAMPAIGN_DAYS + " 夜"));
    const track = el("div", "campaign-meter-track");
    track.append(el("span", "", null, { style: "width:" + Math.round(cycleDay / CAMPAIGN_DAYS * 100) + "%" }));
    return append(meter, label, track);
  }

  function weeklyFocusCard({ recap = false } = {}) {
    const focus = state.weeklyFocus;
    if (recap) {
      if (!focus?.resolved || !focus.result) {
        const waiting = el("section", "weekly-focus weekly-focus-waiting");
        append(waiting, el("span", "weekly-focus-kicker", "新的一週・經營焦點"),
          el("p", "weekly-focus-copy", "選好本週經營方向後，會依你的選擇帶入一項輕量目標；沒有額外扣款或失敗懲罰。"));
        return waiting;
      }
      const result = focus.result;
      const remaining = Math.max(0, Number(result.target) - Number(result.progress));
      const status = result.status || (result.success ? "complete" : (remaining > 0 && remaining <= 2 ? "near" : "missed"));
      const card = el("section", "weekly-focus weekly-focus-recap" + (status === "complete" ? " is-success" : (status === "near" ? " is-near" : " is-missed")));
      const heading = el("div", "weekly-focus-heading");
      const recapMessage = !result.success && remaining > 0 && remaining <= 2
        ? (result.summary || "只差 " + remaining + " " + (result.unit || (focus.id === "acquire" || focus.id === "hold" ? "夜" : "桌")) + "；本週沒有扣款，下週可再試。")
        : (result.summary || result.message);
      const resultLabel = status === "complete" ? "本週達標" : (status === "near" ? "差一點點" : "本週回顧");
      append(heading, el("b", "", resultLabel + "｜" + result.title),
        el("span", "weekly-focus-count", result.progress + " / " + result.target));
      append(card, el("span", "weekly-focus-kicker", "七夜經營小結・第 " + result.startDay + "–" + result.resolvedDay + " 夜"),
        heading,
        el("p", "weekly-focus-copy", recapMessage));
      return card;
    }
    if (!focus || focus.resolved) return null;
    const definition = getWeeklyFocusDefinition(focus.id);
    if (!definition) return null;
    const progress = Math.max(0, Math.min(focus.target, Number(focus.progress) || 0));
    const card = el("section", "weekly-focus", null, { "aria-label": "本週經營焦點" });
    const heading = el("div", "weekly-focus-heading");
    append(heading, el("b", "", definition.icon + "　本週焦點・" + definition.title),
      el("span", "weekly-focus-count", progress + " / " + focus.target));
    const bar = el("div", "weekly-focus-track", null, { role: "progressbar", "aria-label": definition.title,
      "aria-valuemin": 0, "aria-valuemax": focus.target, "aria-valuenow": progress });
    bar.append(el("span", "", null, { style: "transform:scaleX(" + (progress / focus.target) + ")" }));
    const milestone = progress >= focus.target
      ? "已達標，打烊結算時會記下成果。"
      : (progress >= Math.ceil(focus.target / 2) ? "本週焦點已過半，維持目前節奏即可。" : "完成一半後會收到進度提醒；未完成不會受罰。");
    append(card, heading, bar, el("p", "weekly-focus-copy", definition.description),
      el("span", "weekly-focus-status", milestone),
      el("span", "weekly-focus-reward", "完成可得口碑 +2、熟客 +1；未完成不扣款、不扣口碑。"));
    return card;
  }

  function renderWeeklyDecision() {
    const decision = el("section", "weekly-decision");
    append(decision,
      subhead("新的一週・經營方向", "第 " + state.day + " 夜開始前", true),
      helper("每完成七夜結算一次週轉工作底稿；下一週可擴店、招募人手、併購、培養分店店長或保留現金。店長接手日常營運，總部只需決定重大事件。", "helper-copy manager-intro"));
    const summary = el("div", "decision-summary");
    const currentFixedCost = engagementRenderer.currentFixedCost();
    append(summary, el("span", "", "可用現金"), el("b", "", money(state.coins)),
      el("span", "", "目前每夜固定承諾"), el("b", "", money(currentFixedCost)));
    const runway = currentFixedCost > 0 ? Math.floor(Number(state.coins) / currentFixedCost) : null;
    if (runway !== null) append(summary, el("span", "", "現金固定承諾續航"), el("b", runway <= 5 ? "decision-runway-tight" : "", runway + " 夜"));
    if (runway !== null) summary.append(el("span", "decision-runway-note", "估算非保證：只計固定支出，未含備料、事件／事故與分店營運變動。"));
    decision.append(summary);
    const riskRecap = engagementRenderer.riskChainRecap();
    if (riskRecap) decision.append(riskRecap);
    const finance = el("section", "finance-panel");
    const debt = Number(state.loanPrincipal) || 0;
    const interest = debt ? createLedger().interest : 0;
    const loanNights = Math.max(0, Number(state.loanNights) || 0);
    const weeklyInterest = debt ? Math.max(0,
      Math.round((loanNights + 7) * debt * DATA.economy.loanWeeklyRate / 7) -
      Math.round(loanNights * debt * DATA.economy.loanWeeklyRate / 7)) : 0;
    const financeCopy = el("div", "finance-copy");
    append(financeCopy, el("span", "finance-kicker", "港邊合作金庫"),
      el("h3", "", debt ? "週轉額度使用中" : "低利週轉金"),
      el("p", "", debt
        ? "未償本金 " + money(debt) + "・本夜利息 " + money(interest) + "。若保留本金至下週決策前，未來 7 夜利息估算 " + money(weeklyInterest) + "（不含還款）。" +
          (state.day <= state.loanTakenDay ? "完成本夜營業後，可於下次週轉決策還款。" : "可在本次週轉決策一次還清本金。") +
          ""
        : (state.loanUsed
          ? "本世界已使用過一次週轉額度。若已還清，仍不會再次開放。"
          : "可申請一次 " + money(DATA.economy.loanPrincipal) + " 營運週轉金；週利率 " +
            Math.round(DATA.economy.loanWeeklyRate * 100) + "%，依營業夜攤提利息，之後可提前還清。")));
    let financeAction = null;
    if (debt) {
      financeAction = button("償還本金 " + money(debt), "repay-loan", {},
        state.coins < debt || (state.loanTakenDay && state.day <= state.loanTakenDay), "finance-action");
    } else if (!state.loanUsed) {
      financeAction = button("申請週轉金 +" + money(DATA.economy.loanPrincipal), "borrow-loan", {}, false, "finance-action");
    }
    append(finance, financeCopy, financeAction);
    decision.append(finance);
    if (state.managerEvent) {
      const incident = el("section", "manager-event-card");
      append(incident, el("span", "manager-event-kicker", "總部決策・店長回報"),
        el("h3", "", state.managerEvent.title),
        el("p", "", state.managerEvent.description));
      const choices = el("div", "manager-event-choices");
      state.managerEvent.choices.forEach(function(choice) {
        choices.append(button(choice.name, "resolve-manager-event", { choice: choice.id },
          state.managerEvent.type === "equipment" && choice.id === "repair" ? state.coins < 85 :
            (state.managerEvent.type === "complaint" && choice.id === "compensate" ? state.coins < 55 :
              (state.managerEvent.type === "festival" && choice.id === "promote" ? state.coins < 70 : false)),
          choice.id === "explain" || choice.id === "defer" || choice.id === "decline" ? "secondary-button" : "primary-button"));
      });
      incident.append(choices);
      decision.append(incident);
    }
    const branches = (Array.isArray(state.outlets) ? state.outlets : []).filter(function(outlet) { return outlet.id !== "main"; });
    const activeLocations = 1 + branches.filter(function(outlet) { return outlet.active; }).length;
    const availableManagers = branches.filter(function(outlet) { return outlet.active && !outlet.manager; });
    const managerPanel = el("section", "manager-hiring-panel");
    const managerHeading = el("div", "manager-hiring-heading");
    append(managerHeading, el("div", "", "分店自動營運"),
      el("span", "", activeLocations + " 間營業中・店長薪資 " + money(DATA.economy.managerWage) + " / 夜"));
    managerPanel.append(managerHeading);
    if (!branches.length) {
      managerPanel.append(helper("先併購一間鄰攤並替它備料、開門；夜嵐主店 + 1 間分店達到兩店規模後，就能招募店長。", "helper-copy"));
    } else if (activeLocations < 2) {
      managerPanel.append(helper("至少兩間店同時營業，才會開放店長職缺。到「攤位」管理分店，先補備料並開門。", "helper-copy"));
    } else if (!availableManagers.length) {
      managerPanel.append(helper("目前所有營業分店都有店長；日常人事、備料節奏與營運由店長自動處理。", "helper-copy"));
    } else {
      const managerList = el("div", "manager-hiring-list");
      availableManagers.forEach(function(outlet) {
        const cost = DATA.economy.managerHireCost + branches.filter(function(item) { return item.manager; }).length * 140;
        const row = el("div", "manager-hiring-row");
        const copy = el("div", "manager-hiring-copy");
        append(copy, el("b", "", outlet.name),
          el("span", "", "招募訓練 " + money(cost) + "・每夜薪資 " + money(DATA.economy.managerWage)));
        row.append(copy);
        row.append(button("聘請店長", "hire-outlet-manager", { outletId: outlet.id }, state.coins < cost, "manager-hire-button"));
        managerList.append(row);
      });
      managerPanel.append(managerList);
    }
    decision.append(managerPanel);
    const alliance = allianceStatus(true);
    if (alliance) decision.append(alliance);
    const grid = el("div", "decision-grid");
    Object.values(WEEKLY_OPTIONS).forEach(function(option) {
      const cost = weeklyOptionCost(state, option.id);
      const capped = cost === null;
      const insufficient = !capped && state.coins < cost;
      const card = el("article", "decision-card" + (option.id === "hold" ? " conservative" : ""));
      const header = el("div", "decision-card-head");
      append(header, el("span", "decision-icon", option.icon), el("h3", "", option.name));
      const recurring = option.recurring ? "往後每夜固定增加 " + money(option.recurring) : "不增加每夜固定成本";
      const price = capped ? "此項發展已達場景容量" : (cost ? option.label + " ｜ " + money(cost) : option.label + " ｜ 免費");
      append(card, header, el("span", "decision-cost", price), el("p", "", option.effect),
        el("span", "decision-recurring", recurring));
      card.append(engagementRenderer.investmentPreview(option, cost, capped, insufficient, currentFixedCost));
      if (option.id === "acquire" && !capped) {
        const targets = el("div", "acquisition-targets");
        Object.values(ACQUISITION_TYPES).filter(function(target) { return target.selectable && isAcquisitionTypeAvailable(state, target.id); }).forEach(function(target) {
          const action = button("", "choose-weekly", { id: option.id, targetType: target.id }, insufficient,
            "decision-action acquisition-action");
          append(action,
            el("span", "acquisition-choice-title", target.icon + " 接手 " + target.name),
            el("span", "acquisition-choice-product", target.productName + "・" + money(target.price) + "/" + target.unit));
          action.title = target.note;
          targets.append(action);
        });
        if (Number(state.acquisitions) >= 4) {
          card.append(helper("第 5 次接手限定船埠麵線（一次性 NT$ 1,480、每夜租金 NT$ 38），確保能解鎖東堤小巷；新攤位可點擊管理，商品、備料與自動營運沿用分店系統。", "helper-copy"));
        } else {
          card.append(helper("完成現有 4 間鄰攤的接手後，可選擇船埠麵線拓展到東堤小巷；目前仍可先經營其他業態。", "helper-copy"));
        }
        card.append(targets);
      } else {
        const action = button(capped ? "場景容量已滿" : (insufficient ? "現金不足" : (cost ? "投資 " + money(cost) : "維持現狀・繼續")),
          "choose-weekly", { id: option.id }, capped || insufficient, "decision-action");
        card.append(action);
      }
      grid.append(card);
    });
    decision.append(grid);
    return decision;
  }

  function renderOverview() {
    const event = todayEvent();
    const outlook = forecast(state);
    const parts = [campaignMeter()];
    if (state.phase === "decision") {
      parts.push(weeklyFocusCard({ recap: true }));
      const milestoneRecap = engagementRenderer.weeklyMilestoneRecap();
      if (milestoneRecap) parts.push(milestoneRecap);
      const periodRecap = engagementRenderer.periodOpeningRecap();
      if (periodRecap) parts.push(periodRecap);
      const nightRecap = engagementRenderer.previousNightRecap();
      if (nightRecap) parts.push(nightRecap);
      const recovery = engagementRenderer.recoveryNotice();
      if (recovery) parts.push(recovery);
      parts.push(eventCard(event));
      const announcement = marketAnnouncement();
      if (announcement) parts.push(announcement);
      parts.push(renderWeeklyDecision());
      return fragment(parts);
    }
    const priority = engagementRenderer.tonightPriority();
    if (priority) parts.push(priority);
    const periodRecap = engagementRenderer.periodOpeningRecap();
    if (periodRecap) parts.push(periodRecap);
    const nightRecap = engagementRenderer.previousNightRecap();
    if (nightRecap) parts.push(nightRecap);
    const recovery = engagementRenderer.recoveryNotice();
    if (recovery) parts.push(recovery);
    const alliance = allianceStatus(false);
    if (alliance) parts.push(alliance);
    if (state.loanPrincipal > 0 && state.phase === "prep") {
      parts.push(el("div", "finance-note",
        "週轉本金 " + money(state.loanPrincipal) + "・今晚利息 " + money(outlook.ledger.interest) + "；可在下次週轉決策提前還清。"));
    }
    parts.push(eventCard(event));
    const announcement = marketAnnouncement();
    if (announcement) parts.push(announcement);
    parts.push(subhead(state.phase === "prep" ? "開門前損益預估" : "今晚營運帳本",
      String(outlook.guests.length).padStart(2, "0") + " 桌客流"));

    if (state.phase === "prep") {
      const prepRows = [
        { label: "租金（含拓展 / 併購）", value: "−" + money(outlook.ledger.rent + outlook.ledger.expansionRent + outlook.ledger.acquisitionRent) },
        { label: "排班薪資", value: "−" + money(outlook.ledger.labor) },
        ...(outlook.ledger.managerPayroll ? [{ label: "分店店長薪資", value: "−" + money(outlook.ledger.managerPayroll) }] : []),
        { label: "水電瓦斯", value: "−" + money(outlook.ledger.water + outlook.ledger.electricity + outlook.ledger.gas) },
        ...(outlook.ledger.outletUtilities ? [{ label: "分店營運能源", value: "−" + money(outlook.ledger.outletUtilities) }] : []),
        ...(outlook.ledger.stallUtilities ? [{ label: "攤型能源費", value: "−" + money(outlook.ledger.stallUtilities) }] : []),
        ...insuranceLedgerRows(outlook.ledger),
        ...(outlook.ledger.insuranceRecovery ? [{ label: "保險退費應收款回收", value: "+" + money(outlook.ledger.insuranceRecovery), tone: "income" }] : []),
        ...(outlook.ledger.fees ? [{ label: "活動改善費", value: "−" + money(outlook.ledger.fees) }] : []),
        ...(outlook.ledger.marketing ? [{ label: "觀光行銷", value: "−" + money(outlook.ledger.marketing) }] : []),
        ...(outlook.ledger.preparation ? [{ label: "衛生快清", value: "−" + money(outlook.ledger.preparation) }] : []),
        ...(outlook.ledger.interest ? [{ label: "週轉金利息", value: "−" + money(outlook.ledger.interest) }] : []),
        ...(outlook.ledger.subsidies ? [{ label: "市集雨天補助", value: "+" + money(outlook.ledger.subsidies), tone: "income" }] : []),
        ...(outlook.outletSales ? [{ label: "分店自動營收 / Bonus", value: "+" + money(outlook.outletSales), tone: "income" }] : []),
        { label: "預估食材耗用", value: "−" + money(outlook.food), tone: "outflow" },
        { label: "預估小費 / 活動 Bonus", value: "+" + money(outlook.tips + outlook.bonus), tone: "income" }
      ];
      const prepLedger = ledger(prepRows, { label: "預估營業淨額", value: moneyNet(outlook.net), negative: outlook.net < 0 });
      if (getOnboardingTier(state.day) === "business-only") {
        const details = el("details", "onboarding-detail");
        const summary = el("summary", "onboarding-detail-summary");
        append(summary, el("span", "onboarding-detail-label", "開門前收支估算"),
          el("b", "", "預估淨額 " + moneyNet(outlook.net)),
          el("small", "", "租金、人事、能源、備料與分店營運都已納入・展開查看明細"));
        append(details, summary, prepLedger);
        parts.push(details);
      } else parts.push(prepLedger);
      parts.push(helper("租金、人事與能源在開門時扣款；保險於每期第 1 夜（第 1、31、61 夜⋯）結帳。分店依備料預估自動營收，實際耗用按加權平均成本入帳。"));
      parts.push(subhead("開門前快速檢查", "一切準備好了嗎？"));

      const list = el("div", "guest-list");
      const stock = el("div", "guest-row");
      const stockInfo = el("span", "guest-info");
      append(stock, el("span", "guest-avatar", "🥬"));
      append(stockInfo, el("span", "guest-name", "備料現況"),
        el("span", "guest-need", "雞湯 " + (state.stock.chicken || 0) + " ｜ 海味 " + (state.stock.seafood || 0) + " ｜ 茶點 " + (state.stock.tea || 0)));
      append(stock, stockInfo, el("span", "guest-status", outlook.paying + " 桌"));
      const staff = el("div", "guest-row");
      const staffInfo = el("span", "guest-info");
      const staffNames = staffRoles.filter(function(person) { return state.staff[person.id]; }).map(function(person) { return person.name; });
      append(staff, el("span", "guest-avatar", "👥"));
      append(staffInfo, el("span", "guest-name", "今晚班表"),
        el("span", "guest-need", (staffNames.join("、") || "老闆") + (staffCost() ? " 已排" : " 由老闆代班")));
      append(staff, staffInfo, el("span", "guest-status", money(staffCost())));
      append(list, stock, staff);
      parts.push(list);
      const quick = el("div", "button-row");
      append(quick, button("🥬 補備食材", "panel-tab", { tab: "stock" }),
        button("👥 調整班表", "panel-tab", { tab: "staff" }));
      parts.push(quick);
      const open = el("div", "button-row");
      open.append(button("🏮 掛燈迎客，開始營業", "open-doors", {}, false, "primary-button full-width"));
      parts.push(open);
    } else if (state.phase === "service") {
      const guests = getTonightGuests();
      const active = guests[state.customerIndex];
      const serviceRows = [
        { label: "餐點營收", value: "+" + money(state.ledger.sales), tone: "income" },
        { label: "小費 / 活動", value: "+" + money(state.ledger.tips + state.ledger.bonus), tone: "income" },
        ...(state.ledger.subsidies ? [{ label: "公告卡補助", value: "+" + money(state.ledger.subsidies), tone: "income" }] : []),
        ...insuranceLedgerRows(state.ledger),
        ...(state.ledger.insuranceRecovery ? [{ label: "保險退費應收款回收", value: "+" + money(state.ledger.insuranceRecovery), tone: "income" }] : []),
        { label: "食材耗用", value: "−" + money(state.ledger.food), tone: "outflow" },
        ...(state.ledger.safetyCosts ? [{ label: "安全事件處置", value: "−" + money(state.ledger.safetyCosts), tone: "outflow" }] : []),
        ...(state.ledger.insuranceClaimRevenue ? [{ label: "保險理賠（應收）", value: "+" + money(state.ledger.insuranceClaimRevenue), tone: "income" }] : []),
        ...(state.ledger.insuranceClaimReceipts ? [{ label: "前期理賠收款", value: "+" + money(state.ledger.insuranceClaimReceipts), tone: "income" }] : []),
        { label: "固定與安全支出已扣", value: "−" + money(fixedOperatingCost(state.ledger)) }
      ];
      const serviceLedger = ledger(serviceRows);
      if (getOnboardingTier(state.day) === "business-only") {
        const details = el("details", "onboarding-detail onboarding-service-ledger");
        const summary = el("summary", "onboarding-detail-summary");
        append(summary, el("span", "onboarding-detail-label", "今晚收支"),
          el("b", "", "收入 " + money(ledgerIncome(state.ledger)) + "・食材耗用 " + money(state.ledger.food)),
          el("small", "", "展開查看完整收支與保險明細"));
        append(details, summary, serviceLedger);
        parts.push(details);
      } else parts.push(serviceLedger);
      parts.push(subhead("正在排隊的客人", "點場景裡發光的人接單"));
      const queue = el("div", "guest-list");
      guests.forEach(function(guest, index) {
        const current = index === state.customerIndex;
        queue.append(guestRow(guest, index < state.customerIndex ? "已招待" : (current ? "輪到他" : "排隊中"), current));
      });
      parts.push(queue);
      if (active) {
        const row = el("div", "button-row");
        row.append(button((active.difficult ? "處理現場客訴" : "接待 " + active.name + " 點餐") + "　",
          "call-next", {}, false, "primary-button full-width"));
        parts.push(row, helper("在斜俯視場景點擊正在發光的客人，也能直接打開點餐 / 客訴處理。"));
      }
      parts.push(subhead("營業中的場景事件", "已服務 " + state.customerIndex + " / " + guests.length + " 桌"));
      parts.push(helper("店員會在櫃台後移動，客人走向櫃台並依序排隊；火爐、煙霧、雨勢與燈節光點都在夜市裡即時演出。"));
    } else {
      const net = ledgerNet(state.ledger || createLedger());
      const totals = "今晚有把利潤留在小店。";
      const opening = net >= 0 ? totals : "今晚先把人情與開銷記好。";
      const entry = el("div", "story-card");
      append(entry, el("h3", "", "打烊結算 ｜ 第 " + String(state.day).padStart(2, "0") + " 夜"),
        el("p", "", (net >= 0 ? opening : opening) + " " + event.name + "。總收入 " + money(ledgerIncome(state.ledger)) +
          "；食材耗用 " + money(state.ledger.food) + "；固定成本 " +
          money(fixedOperatingCost(state.ledger)) +
          "。庫存採購 " + money(state.ledger.purchase) + " 是現金流，已入庫部分不重複列為耗用。"));
      entry.append(ledger([], { label: "今晚營業淨額", value: moneyNet(net), negative: net < 0 }));
      parts.push(entry, subhead("今晚的小小岔路", "選一個帶去明晚的心意"));
      const story = todayStory();
      const choice = storyCard(story.icon + "　" + story.title, story.text);
      const options = el("div", "button-row");
      append(options,
        button("把紙船放回港灣　+2 口碑", "choose-story", { id: "paperboat" }, !!state.reportChoice),
        button("替熟客留桌　+NT$ 80", "choose-story", { id: "window" }, !!state.reportChoice));
      choice.append(options);
      parts.push(choice);
      const next = el("div", "button-row");
      next.append(button(state.reportChoice ? "收進手記，準備明晚" : "先選一個今晚的心意", "next-night", {}, !state.reportChoice, "primary-button full-width"));
      parts.push(next);
    }
    return fragment(parts);
  }

  function insuranceLedgerRows(ledger) {
    const rows = [
      ["職災保險", ledger.insuranceAccident],
      ["雇主勞保", ledger.insuranceLabor],
      ["雇主健保", ledger.insuranceHealth],
      ["產品責任險", ledger.insuranceProduct],
      ["公共意外險", ledger.insurancePublic]
    ].filter(([, amount]) => Number(amount) > 0);
    if (!rows.length) return [];
    return [{ label: isInsuranceBillingDay(state.day) ? "本期保險費（首夜）" : "保險費", value: "−" + money(rows.reduce((sum, [, amount]) => sum + amount, 0)) }];
  }

  function insuranceDueLabel() {
    const dueDay = getNextInsuranceBillingDay(state.day);
    return dueDay === state.day ? "今晚開門時入帳" : "第 " + dueDay + " 夜開門時入帳";
  }

  function renderTierPlanning() {
    const section = el("section", "tier-planning");
    section.append(subhead("攤型發展規劃", "流動攤販 → 固定攤販 → 大排檔", true));
    section.append(helper("店面依序整修升級，不可跳級。安全設備、經營規模與人手都達標後才能施工；裝修支出列為資產並按日提列折舊。", "helper-copy manager-intro"));
    const outlets = (Array.isArray(state.outlets) ? state.outlets : []);
    outlets.forEach((outlet) => {
      const current = getOutletTier(outlet);
      const next = getNextStallTier(outlet);
      const card = el("article", "tier-plan-card");
      const head = el("div", "tier-plan-head");
      append(head, el("div", "tier-plan-title", outlet.name), el("span", "tier-plan-badge", current.name));
      card.append(head);
      const track = el("ol", "tier-track", null, { "aria-label": outlet.name + "攤型進度" });
      STALL_TIERS.forEach((tier) => {
        const stage = el("li", tier.id === current.id ? "current" : (STALL_TIERS.findIndex((item) => item.id === tier.id) < STALL_TIERS.findIndex((item) => item.id === current.id) ? "complete" : ""));
        stage.append(el("span", "tier-track-dot", ""), el("span", "tier-track-label", tier.name));
        track.append(stage);
      });
      card.append(track);
      card.append(el("p", "tier-plan-meta", "每日接待容量 " + (outlet.id === "main" ? "主店客流加成 +" + current.guestBonus + " 桌" : "最多 " + (outlet.manager ? 2 : 1) + " 筆基本生意" + (current.guestBonus ? "，攤型加成 +" + current.guestBonus : "")) + "・攤型能源費 " + money(current.dailyUtilities) + "/夜"));
      if (!next) {
        card.append(el("p", "tier-plan-finished", "已達最高營業型態；維持設備保養並留意每期保險結帳。"));
      } else {
        const readiness = getTierReadiness(state, outlet, next.id);
        const preview = getMonthlyInsurance(state, { ...outlet, tier: next.id });
        const currentInsurance = getMonthlyInsurance(state, outlet);
        const requirements = el("ul", "tier-requirements", null, { "aria-label": "升級條件" });
        readiness.requirements.forEach((requirement) => {
          requirements.append(el("li", requirement.ready ? "ready" : "missing", (requirement.ready ? "✓ " : "○ ") + requirement.label));
        });
        card.append(el("p", "tier-plan-next", "下一階段：" + next.name + "・整修資本支出 " + money(next.buildCost) + "・能源 +" + money(next.dailyUtilities) + "/夜"));
        card.append(requirements);
        card.append(el("p", "tier-plan-meta", "目前每期保費 " + money(currentInsurance.total) + " → 升級後預估 " + money(preview.total) + "（" + insuranceDueLabel() + "）"));
        card.append(button(readiness.ready ? "整修升級為「" + next.name + "」" : "先補齊升級條件", "upgrade-stall-tier", { outletId: outlet.id },
          state.phase !== "prep" || !readiness.ready || state.coins < next.buildCost, "manager-action tier-upgrade-action"));
      }
      section.append(card);
    });
    return section;
  }

  function renderBranchSafety() {
    const branches = (state.outlets || []).filter((outlet) => outlet.id !== "main");
    if (!branches.length) return null;
    const section = el("section", "branch-safety-section");
    section.append(subhead("分店安全設備", "購置後列設備資產", true));
    branches.forEach((outlet) => {
      const isFood = getOutletProduct(outlet.type).group === "food";
      const card = el("article", "branch-safety-card");
      card.append(el("h4", "", outlet.name + "・" + getOutletTier(outlet).name));
      const grid = el("div", "branch-safety-grid");
      OUTLET_SAFETY_EQUIPMENT.filter((item) => item.id !== "coldStorage" || isFood).forEach((item) => {
        const level = getOutletSafetyLevel(state, outlet, item.id);
        const cost = item.costs[level];
        const action = button(cost === undefined ? "已達最高級" : "添購 " + money(cost), "upgrade-outlet-safety",
          { outletId: outlet.id, equipmentId: item.id }, state.phase !== "prep" || cost === undefined || state.coins < cost, "manager-action");
        grid.append(managerItem(item.icon, item.name + " ｜ Lv." + level, item.note, null, action));
      });
      card.append(grid);
      section.append(card);
    });
    return section;
  }

  const prepRenderer = createPreparationRenderer({
    state, ingredients, equipment, staffRoles, dishes, upgrades,
    el, append, fragment, button, subhead, helper, ledger, managerItem, money, formatBalance, staffCost,
    getPurchasePrice, getUnlockedDishes, renderTierPlanning, renderBranchSafety,
    getOutletTier, getMonthlyInsurance, getOutletEmployeeCount, insuranceDueLabel
  });

  function renderOutletManagement() {
    const branches = (Array.isArray(state.outlets) ? state.outlets : []).filter(function(outlet) { return outlet.id !== "main"; });
    const section = el("section", "outlet-management");
    append(section, subhead("接手攤位・分店管理", branches.length + " 間", true));
    if (!branches.length) {
      section.append(helper("目前只有夜嵐主店。每週經營決策可選擇港口炸物、山海果物、花生糖舖或彈珠小屋；各有專屬商品與售價，接手後可獨立補貨、升級、開關店，再培養店長自動營運。", "helper-copy"));
      return section;
    }
    branches.forEach(function(outlet) {
      const product = getOutletProduct(outlet.type);
      const card = el("article", "outlet-card" + (outlet.active ? " operating" : "") +
        (selectedOutletId === outlet.id ? " selected" : ""), null,
        { id: "outlet-card-" + outlet.id, tabIndex: -1 });
      const heading = el("div", "outlet-card-heading");
      const title = el("div", "outlet-card-title");
      append(title, el("h4", "", outlet.name),
        el("span", "outlet-status" + (outlet.active ? " open" : ""),
          outlet.autoPaused ? "備料耗盡・自動暫停" : (outlet.active ? "營業中" : "尚未開門")));
      const staffLine = outlet.manager
        ? "店長自動營運・每夜薪資 " + money(DATA.economy.managerWage)
        : "你親自照看・每夜最多一筆生意";
      append(heading, title, el("span", "outlet-kind", product.typeLabel));
      const specialty = getOutletSpecialty(outlet);
      const summary = el("p", "outlet-summary", getOutletTier(outlet).name + "・" + staffLine + "・主打 " + specialty.name + " " +
        money(outletRetailPrice(outlet)) + "/" + product.unit + "・設備 Lv." + outlet.equipmentLevel + "・口碑 " + outlet.reputation);
      card.append(heading, summary);
      if (outlet.lastResult) {
        card.append(el("div", "outlet-last-result",
          "第 " + outlet.lastResult.day + " 夜｜" +
          (outlet.lastResult.units ? "接待 " + outlet.lastResult.units + " 筆・營收 " + money(outlet.lastResult.sales) : "未有成交") +
          "・分店淨額 " + (outlet.lastResult.net >= 0 ? "+" : "−") + money(Math.abs(outlet.lastResult.net))));
      }
      const supplies = el("div", "outlet-stock-list");
      const choices = product.legacyMixed ? ingredients :
        [{ id: product.stockId, name: specialty.name, icon: product.icon, cost: product.cost, unit: product.unit }];
      choices.forEach(function(item) {
        const cost = getPurchasePrice(item);
        const row = el("div", "outlet-stock-row");
        append(row, el("span", "outlet-stock-name", item.icon + " " + item.name),
          el("b", "outlet-stock-count", String(outlet.stock[item.id] || 0) + " " + (item.unit || "份")),
          button("補貨 " + money(cost), "buy-outlet-stock", { outletId: outlet.id, stockId: item.id },
            state.phase !== "prep" || state.coins < cost, "outlet-small-action"));
        supplies.append(row);
      });
      const actions = el("div", "outlet-actions");
      const available = outletAvailableStock(outlet);
      const nextEquipmentCost = DATA.economy.outletEquipmentCosts[outlet.equipmentLevel];
      append(actions,
        button(outlet.active ? "暫停營業" : "補好備料後開店", "toggle-outlet", { outletId: outlet.id },
          state.phase !== "prep" || (!outlet.active && available <= 0), "outlet-toggle-action"),
        button(nextEquipmentCost ? "升級設備 " + money(nextEquipmentCost) : "設備已滿級", "upgrade-outlet-equipment", { outletId: outlet.id },
          state.phase !== "prep" || !nextEquipmentCost || state.coins < nextEquipmentCost, "outlet-small-action"));
      card.append(supplies, actions);
      if (outlet.manager) {
        card.append(button("解除店長・改回自營", "dismiss-outlet-manager", { outletId: outlet.id },
          state.phase !== "prep", "outlet-manager-action"));
      }
      section.append(card);
    });
    return section;
  }

  function renderStall() {
    const outlook = forecast(state);
    const staffNames = staffRoles.filter(function(person) { return state.staff[person.id]; }).map(function(person) { return person.name; });
    const equipmentLevel = equipment.reduce(function(total, item) {
      return total + (Number(state.equipment[item.id]) || 0);
    }, 0);
    const parts = [subhead("夜嵐攤號・工作台", "第 " + String(state.day).padStart(2, "0") + " 夜", true)];
    const alliance = allianceStatus(false);
    if (alliance) parts.push(alliance);
    const announcement = marketAnnouncement();
    if (announcement) parts.push(announcement);
    parts.push(renderOutletManagement());
    const summary = el("div", "stall-summary-grid");
    [
      ["🥬", (state.stock.chicken || 0) + " / " + (state.stock.seafood || 0) + " / " + (state.stock.tea || 0), "雞湯・海味・茶點庫存"],
      ["⚒", equipmentLevel + " 級", "設備總升級數"],
      ["👥", staffNames.join("、") || "老闆代班", "今晚值班人員"]
    ].forEach(function(item) {
      const card = el("article", "stall-summary");
      append(card, el("span", "", item[0]), el("b", "", item[1]), el("small", "", item[2]));
      summary.append(card);
    });
    parts.push(summary, ledger([
      { label: "攤位租金", value: money(outlook.ledger.rent) },
      { label: "人事成本", value: money(outlook.ledger.labor) },
      { label: "水電瓦斯", value: money(outlook.ledger.water + outlook.ledger.electricity + outlook.ledger.gas) }
    ], { label: "目前預估淨額", value: moneyNet(outlook.net), negative: outlook.net < 0 }));
    parts.push(helper("攤位工作台整合每日營運。開門前可調整備料、設備與班表；開門後，採購與施工會鎖定。"));
    const actions = el("div", "stall-actions");
    append(actions,
      button("🥬 管理備料與菜單 ", "panel-tab", { tab: "stock" }),
      button("⚒ 管理設備 ", "panel-tab", { tab: "equipment" }),
      button("👥 管理排班 ", "panel-tab", { tab: "staff" }));
    parts.push(actions, button(
      state.phase === "prep" ? "🏮 掛燈迎客，開始營業" : (state.phase === "service" ? "接待下一桌" : "查看今晚結算"),
      "main-action", {}, false, "primary-button full-width"));
    return fragment(parts);
  }

  function renderOrderChoices(guest) {
    if (guest.difficult) {
      const parts = [subhead("選擇客訴處理方式", "會記進口碑與帳本")];
      const choices = el("div", "complaint-options");
      [
        ["耐心說明", "不花錢・口碑 −1", "calm", "secondary-button"],
        ["招待小菜", "−" + money(DATA.economy.complaintSnackCost) + "・口碑回升", "snack", "secondary-button"],
        ["退還部分餐費", "退款 −" + money(DATA.economy.complaintRefund), "refund", "danger-button"]
      ].forEach(function(item) {
        const choice = button("", "resolve-complaint", { choice: item[2] }, false, item[3]);
        append(choice, document.createTextNode(item[0]), el("b", "", item[1]));
        choices.append(choice);
      });
      parts.push(choices);
      return fragment(parts);
    }
    const parts = [subhead("替客人挑一道餐點", "推薦會多留小費")];
    const grid = el("div", "dish-choice-grid");
    const menu = getUnlockedDishes(state);
    menu.forEach(function(entry) {
      const dish = entry.dish;
      const recommended = dish.need.indexOf(guest.need) !== -1;
      const recalled = state.recalledDishIds.includes(dish.id);
      const inStock = Number(state.stock[dish.ingredient]) > 0;
      const available = inStock && !recalled;
      const choice = button("", inStock || recalled ? "serve-dish" : "stockout-dish", { id: dish.id }, recalled,
        "dish-choice" + (recommended ? " recommended" : "") + (recalled ? " recalled" : "") + (!inStock && !recalled ? " stockout" : ""));
      const copy = el("span", "dish-choice-copy");
      append(copy,
        el("span", "dish-choice-name", dish.name + (recommended ? " ｜ 投其所好" : "")),
        el("span", "dish-choice-note", recalled ? "今晚食安事件下架・暫停供應" :
          (!inStock ? "備料已售完・點一下查看場景提示" :
            dish.line + " ｜ 庫存 " + (state.stock[dish.ingredient] || 0) + " ｜ 食材 " + money(getFoodCost(dish)))));
      append(choice, el("span", "dish-choice-icon", dish.icon), copy,
        el("span", "dish-choice-price", money(dish.price)));
      grid.append(choice);
    });
    parts.push(grid);
    return fragment(parts);
  }

  function renderUI() {
    const event = todayEvent();
    const period = Math.floor((state.day - 1) / CAMPAIGN_DAYS) + 1;
    const cycleDay = campaignCycleDay(state.day);
    document.getElementById("dayValue").textContent = "第 " + state.day + " 夜・第 " + period + " 期 " + cycleDay + " / " + CAMPAIGN_DAYS;
    document.getElementById("coinsValue").textContent = money(state.coins);
    document.getElementById("fameValue").textContent = String(state.fame);
    document.getElementById("regularValue").textContent = String(state.regulars).padStart(2, "0") + " / 24";
    const phaseText = { prep: "準備中", service: "營業中", report: "已打烊", decision: "週轉決策" }[state.phase] || "準備中";
    document.getElementById("phaseLabel").textContent = phaseText;
    document.getElementById("panelPhase").textContent = { prep: "準備時段", service: "現場營業", report: "打烊結算", decision: "每週經營選擇" }[state.phase] || "準備時段";
    document.querySelector(".world-title").textContent = state.phase === "prep" ? "潮聲近了，準備開門嗎？" :
      (state.phase === "service" ? "燈火亮起，巷口正湧進人潮。" :
        (state.phase === "decision" ? "新的一週，要把夜市帶往哪裡？" : "今晚的帳本，記下了你的選擇。"));
    const worldState = document.getElementById("worldState");
    worldState.classList.toggle("open", state.phase === "service");
    document.getElementById("worldStateText").textContent = state.phase === "prep" ? "備料與排班中" :
      (state.phase === "service" ? "客人走進夜市・營業中" : (state.phase === "decision" ? "本週經營方向待選" : "這一夜已打烊"));
    const mainAction = document.getElementById("mainAction");
    mainAction.textContent = state.phase === "prep" ? "掛燈迎客" : (state.phase === "service" ? "接待下一桌" : (state.phase === "report" ? (state.reportChoice ? "收進手記，準備明晚" : "選擇手記・準備明晚") : "先選擇本週方向"));
    mainAction.disabled = state.phase === "decision";
    mainAction.setAttribute("aria-disabled", String(mainAction.disabled));
    mainAction.dataset.action = "main-action";
    document.querySelectorAll(".panel-tab").forEach(function(tab) {
      tab.classList.toggle("active", tab.dataset.tab === activeTab);
      tab.setAttribute("aria-selected", String(tab.dataset.tab === activeTab));
    });
    document.getElementById("panelContent").setAttribute("aria-labelledby", "tab-" + activeTab);
    const titles = { ops: "今晚營運", stall: "攤位工作台", stock: "備料與菜單", equipment: "設備與升級", staff: "人員排班", journal: "帳務與手記" };
    document.getElementById("panelHeading").textContent = titles[activeTab] || titles.ops;
    const renderers = { ops: renderOverview, stall: renderStall, stock: prepRenderer.renderStock, equipment: prepRenderer.renderEquipment, staff: prepRenderer.renderStaff, journal: renderJournal };
    document.getElementById("panelContent").replaceChildren((renderers[activeTab] || renderOverview)());
    const saveStatus = typeof saveStateDetailed === "function"
      ? saveStateDetailed(state)
      : { ok: saveState(state), reason: "failed" };
    const saveLabel = document.getElementById("saveLabel");
    saveLabel.textContent = saveStatus.ok ? "進度已儲存" : ({
      quota: "儲存空間已滿・進度未儲存",
      unavailable: "瀏覽器儲存不可用",
      "unsupported-version": "新版存檔已保留・不覆寫",
      failed: "儲存失敗・請檢查瀏覽器空間"
    }[saveStatus.reason] || "進度尚未儲存");
    return event;
  }

  function setTabAndRender(tab) { setTab(tab); renderUI(); }
  function setJournalView(view) {
    if (["daily", "weekly", "monthEnd", "monthly", "chart", "stories"].includes(view)) journalView = view;
  }
  function setStatementView(view) {
    if (["income", "equity", "position", "cashflow"].includes(view)) reportStatement = view;
  }
  function setJournalFilter(filter, value) {
    if (filter === "diary-day") selectedJournalDay = Number(value) || null;
    if (filter === "report-period") selectedReportPeriod = Number(value) || null;
    if (filter === "week-report") selectedWeek = value || null;
    if (filter === "month-end-report") selectedMonthEnd = value || null;
  }
  return {
    renderUI: renderUI,
    renderOverview: renderOverview,
    renderOrderChoices: renderOrderChoices,
    getWorldEventInfo: getWorldEventInfo,
    getOutletWorldEvents: getOutletWorldEvents,
    renderWorldEventContent: renderWorldEventContent,
    setTab: setTab,
    setOutletTarget: setOutletTarget,
    setTabAndRender: setTabAndRender,
    setJournalView: setJournalView,
    setStatementView: setStatementView,
    setJournalFilter: setJournalFilter,
    getJournalReportInfo: getJournalReportInfo,
    renderJournalReport: renderJournalReport,
    getTab: function() { return activeTab; }
  };
}

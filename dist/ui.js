// avoid-ai-design-ignore-file: I2, SD4d - food, character, and event marks are in-world content; middle dots separate compact order and ledger facts.
import { DATA, getOutletProduct, outletAvailableStock, outletRetailPrice } from "./data.js";
import { ACQUISITION_GROUPS, ACQUISITION_TYPES, CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, WEEKLY_DECISION_DAYS, WEEKLY_OPTIONS, acquisitionGroupCounts, campaignCycleDay, weeklyOptionCost } from "./campaign.js";
import { CHART_OF_ACCOUNTS, formatBalance } from "./accounting.js";
import {
  createLedger as createLedgerForState, fixedOperatingCost as ledgerFixedOperatingCost, forecast, getFoodCost as getFoodCostForState,
  hasBrandAlliance,
  getPurchasePrice as getPurchasePriceForState, getTonightGuests as getTonightGuestsForState,
  ledgerIncome, ledgerNet, marketCardChoice, money, staffCost as staffCostForState,
  todayEvent as selectEvent, todayMarketCard, todayStory as selectStory
} from "./state.js";

// UI nodes are built with DOM APIs so player names, journal entries, and game data
// are always treated as text rather than parsed as markup.
export function createUI(runtime) {
  const { state, saveState } = runtime;
  const { dishes, ingredients, equipment, staff: staffRoles, upgrades } = DATA;
  let activeTab = "ops";
  let journalView = "daily";
  let reportStatement = "income";
  let selectedReportPeriod = null;
  let selectedWeek = null;
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

  function getWorldEventInfo() {
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
        title: card.name, description: choice ? choice.detail : card.description,
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
    if (card.id === "tourist-surge") {
      return choice.id === "promote"
        ? "帳務影響：行銷費 −" + money(DATA.economy.touristPromotionCost) + "；預計多 2 桌，營收與食材成本依實際接待入帳。"
        : "帳務影響：今晚不新增公告卡收入或支出，客流維持原預估。";
    }
    if (card.id === "hygiene-audit") {
      if (choice.id === "deep-clean") return "帳務影響：清潔支出 −" + money(DATA.economy.hygieneQuickCleanCost) + "；免本次整改費，口碑 +1。";
      const eventNeedsCorrection = selectEvent(state).id === "inspection";
      const equipmentReady = (Number(state.equipment.hood) || 0) > 0 || (Number(state.equipment.awning) || 0) > 0 || !!state.upgrades.lantern;
      const fee = eventNeedsCorrection && !equipmentReady ? 75 : 0;
      return fee
        ? "帳務影響：目前設備未達稽查條件，今晚可能列整改費 −" + money(fee) + "；實際以開門結算為準。"
        : (eventNeedsCorrection
          ? "帳務影響：目前設備符合稽查條件，預估不產生整改費。"
          : "帳務影響：今晚不執行整改稽查，不會產生稽查整改費。");
    }
    if (card.id === "rain-subsidy") {
      return choice.id === "claim"
        ? "帳務影響：市集補助收入 +" + money(DATA.economy.rainSubsidy) + "，列入今晚營運收支。"
        : "帳務影響：不申請補助，今晚不新增公告卡收入或支出。";
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

  function renderWeeklyDecision() {
    const decision = el("section", "weekly-decision");
    append(decision,
      subhead("新的一週・經營方向", "第 " + state.day + " 夜開始前", true),
      helper("每完成七夜結算一次週轉工作底稿；下一週可擴店、招聘、併購、培養分店店長或保留現金。店長接手日常營運，總部只需決定重大事件。", "helper-copy manager-intro"));
    const summary = el("div", "decision-summary");
    append(summary, el("span", "", "可用現金"), el("b", "", money(state.coins)),
      el("span", "", "目前每夜固定營運成本"), el("b", "", money(fixedOperatingCost(createLedger()))));
    decision.append(summary);
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
      managerPanel.append(helper("先併購一間鄰攤並替它備料、開門；夜嵐主店 + 1 間分店達到兩店規模後，就能招聘店長。", "helper-copy"));
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
      if (option.id === "acquire" && !capped) {
        const targets = el("div", "acquisition-targets");
        Object.values(ACQUISITION_TYPES).filter(function(target) { return target.selectable; }).forEach(function(target) {
          const action = button("", "choose-weekly", { id: option.id, targetType: target.id }, insufficient,
            "decision-action acquisition-action");
          append(action,
            el("span", "acquisition-choice-title", target.icon + " 接手 " + target.name),
            el("span", "acquisition-choice-product", target.productName + "・" + money(target.price) + "/" + target.unit));
          action.title = target.note;
          targets.append(action);
        });
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
      parts.push(eventCard(event));
      const announcement = marketAnnouncement();
      if (announcement) parts.push(announcement);
      parts.push(renderWeeklyDecision());
      return fragment(parts);
    }
    if (state.day === 1) {
      const guide = el("aside", "guide-card");
      append(guide, el("b", "", "新手小抄"),
        el("span", "", "先到「攤位」補食材、調班表；開門後點擊發光客人接單。每七夜做一次營運選擇、每三十夜查看財報；夜市不會在第一期結束，世界會持續往前。"));
      parts.push(guide);
    }
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
      parts.push(ledger([
        { label: "租金（含拓展 / 併購）", value: "−" + money(outlook.ledger.rent + outlook.ledger.expansionRent + outlook.ledger.acquisitionRent) },
        { label: "排班薪資", value: "−" + money(outlook.ledger.labor) },
        ...(outlook.ledger.managerPayroll ? [{ label: "分店店長薪資", value: "−" + money(outlook.ledger.managerPayroll) }] : []),
        { label: "水電瓦斯", value: "−" + money(outlook.ledger.water + outlook.ledger.electricity + outlook.ledger.gas) },
        ...(outlook.ledger.outletUtilities ? [{ label: "分店營運能源", value: "−" + money(outlook.ledger.outletUtilities) }] : []),
        ...(outlook.ledger.fees ? [{ label: "活動改善費", value: "−" + money(outlook.ledger.fees) }] : []),
        ...(outlook.ledger.marketing ? [{ label: "觀光行銷", value: "−" + money(outlook.ledger.marketing) }] : []),
        ...(outlook.ledger.preparation ? [{ label: "衛生快清", value: "−" + money(outlook.ledger.preparation) }] : []),
        ...(outlook.ledger.interest ? [{ label: "週轉金利息", value: "−" + money(outlook.ledger.interest) }] : []),
        ...(outlook.ledger.subsidies ? [{ label: "市集雨天補助", value: "+" + money(outlook.ledger.subsidies), tone: "income" }] : []),
        ...(outlook.outletSales ? [{ label: "分店自動營收 / Bonus", value: "+" + money(outlook.outletSales), tone: "income" }] : []),
        { label: "預估食材耗用", value: "−" + money(outlook.food), tone: "outflow" },
        { label: "預估小費 / 活動 Bonus", value: "+" + money(outlook.tips + outlook.bonus), tone: "income" }
      ], { label: "預估營業淨額", value: moneyNet(outlook.net), negative: outlook.net < 0 }));
      parts.push(helper("租金、人事與能源在開門時扣款；分店依備料預估自動營收。採購先扣現金，實際耗用按加權平均成本入帳。"));
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
      parts.push(ledger([
        { label: "餐點營收", value: "+" + money(state.ledger.sales), tone: "income" },
        { label: "小費 / 活動", value: "+" + money(state.ledger.tips + state.ledger.bonus), tone: "income" },
        ...(state.ledger.subsidies ? [{ label: "公告卡補助", value: "+" + money(state.ledger.subsidies), tone: "income" }] : []),
        { label: "食材耗用", value: "−" + money(state.ledger.food), tone: "outflow" },
        { label: "固定支出已扣", value: "−" + money(fixedOperatingCost(state.ledger)) }
      ]));
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
      next.append(button("收進日記，準備明晚", "next-night", {}, !state.reportChoice, "primary-button full-width"));
      parts.push(next);
    }
    return fragment(parts);
  }

  function renderStock() {
    const parts = [
      subhead("備料櫃・即時庫存", "補貨只在開門前", true),
      helper("買進時扣現金，售出時才將該份食材列為耗用成本；供應行情會改變本夜進貨價。", "helper-copy manager-intro")
    ];
    const grid = el("div", "manager-grid");
    ingredients.forEach(function(item) {
      const qty = Number(state.stock[item.id]) || 0;
      const cost = Number(state.stockCost[item.id]) || item.cost;
      const price = getPurchasePrice(item);
      const action = button("補 1 份 ｜ " + money(price), "buy-stock", { id: item.id },
        state.phase !== "prep" || state.coins < price, "manager-action");
      const meta = el("span", "manager-meta");
      append(meta, document.createTextNode("現有 "));
      append(meta, el("b", "", qty), document.createTextNode(" 份 ｜ 平均成本 " + money(cost)));
      const itemNode = managerItem(item.icon, item.name, "配方：" + item.recipe, null, action);
      itemNode.querySelector(".manager-copy").append(meta);
      grid.append(itemNode);
    });
    parts.push(grid, subhead("今晚菜單", "選一道招牌拿額外小費"));
    const menu = el("div", "manager-grid");
    dishes.forEach(function(dish, index) {
      const meta = el("span", "manager-meta");
      append(meta, document.createTextNode("售價 "));
      append(meta, el("b", "", money(dish.price)), document.createTextNode(" ｜ 庫存 " + (state.stock[dish.ingredient] || 0)));
      const itemNode = managerItem(dish.icon, dish.name, dish.line,
        null, button(state.selectedDish === index ? "今晚招牌" : "設為招牌",
          "select-dish", { index: String(index) }, state.phase !== "prep", "manager-action"));
      itemNode.querySelector(".manager-copy").append(meta);
      menu.append(itemNode);
    });
    parts.push(menu);
    return fragment(parts);
  }

  function renderEquipment() {
    const parts = [
      subhead("爐台與攤位設備", "升級提升效率", true),
      helper("設備是一次性投資，營業中不能施工。等級也會直接反映在 2.5D 攤位模型上。", "helper-copy manager-intro")
    ];
    const grid = el("div", "manager-grid");
    equipment.forEach(function(item) {
      const level = Math.max(0, Math.min(item.costs.length, Number(state.equipment[item.id]) || 0));
      const price = item.costs[level];
      const meta = el("span", "manager-meta");
      append(meta, el("b", "", "●".repeat(level) + "○".repeat(item.costs.length - level)),
        document.createTextNode(" ｜ 最高 " + item.costs.length + " 級"));
      const action = button(price ? "升級 " + money(price) : "已滿級", "upgrade-equipment",
        { id: item.id }, state.phase !== "prep" || typeof price !== "number" || state.coins < price, "manager-action");
      const itemNode = managerItem(item.icon, item.name + " ｜ Lv." + level, item.note, null, action);
      itemNode.querySelector(".manager-copy").append(meta);
      grid.append(itemNode);
    });
    parts.push(grid, subhead("夜市改造", "打造熟客的理由"));
    const additions = el("div", "manager-grid");
    upgrades.forEach(function(item) {
      const owned = !!state.upgrades[item.id];
      additions.append(managerItem(item.icon, item.name + (owned ? " ｜ 已添置" : ""), item.note, null,
        button(owned ? "已擁有" : money(item.cost), "buy-upgrade", { id: item.id },
          owned || state.phase !== "prep" || state.coins < item.cost, "manager-action")));
    });
    parts.push(additions, subhead("資產清冊・折舊追蹤", "逐筆記錄購置成本與帳面價值"));
    const assets = Array.isArray(state.accounting?.assets) ? state.accounting.assets : [];
    if (!assets.length) {
      parts.push(helper("目前還沒有資本化資產；購買爐台、設備、改造或擴店後，會在此建立獨立資產卡並按耐用年限提列折舊。"));
    } else {
      const assetGrid = el("div", "asset-register");
      assets.forEach(function(asset) {
        const bookValue = Math.max(asset.residualValue || 0, asset.cost - asset.accumulatedDepreciation);
        const card = el("article", "asset-row");
        const title = el("div", "asset-row-title");
        append(title, el("b", "", asset.name), el("span", "asset-code", asset.category === "intangible" ? "無形資產" : "設備／改良"));
        const values = el("div", "asset-row-values");
        append(values,
          el("span", "", "成本 " + formatBalance(asset.cost)),
          el("span", "", "累計折舊／攤銷 " + formatBalance(asset.accumulatedDepreciation)),
          el("b", "", "帳面金額 " + formatBalance(bookValue)),
          el("span", "", "耐用 " + asset.usefulLifeDays + " 夜・啟用第 " + asset.availableDay + " 夜"));
        append(card, title, values);
        assetGrid.append(card);
      });
      parts.push(assetGrid);
    }
    parts.push(helper("採直線法按每日累計折舊額入帳：成本減殘值後，依設定耐用年限分攤。實際資產年限與殘值可於資料設定調整。", "helper-copy accounting-note"));
    return fragment(parts);
  }

  function renderStaff() {
    const parts = [
      subhead("今晚班表", "開門後鎖定", true),
      helper("排班會列入當夜人事成本；老闆可自行代班，但服務小費和節奏會變慢。", "helper-copy manager-intro")
    ];
    const grid = el("div", "manager-grid");
    staffRoles.forEach(function(person) {
      const assigned = !!state.staff[person.id];
      const meta = el("span", "manager-meta");
      append(meta, document.createTextNode("每夜薪資 "));
      meta.append(el("b", "", money(person.wage)));
      grid.append(managerItem(person.icon, person.name + " ｜ " + person.role,
        assigned ? "穩定服務、完整小費" : "老闆代班，服務表現下降", null,
        button(assigned ? "取消排班" : "加入班表", "toggle-staff", { role: person.id },
          state.phase !== "prep", "manager-action")));
      grid.lastElementChild.querySelector(".manager-copy").append(meta);
    });
    parts.push(grid, subhead("人事預算", "單夜支出"));
    const cook = staffRoles.find(function(person) { return person.id === "cook"; });
    const server = staffRoles.find(function(person) { return person.id === "server"; });
    parts.push(ledger([
      { label: "阿滿・廚房主廚", value: state.staff.cook ? money(cook.wage) : "老闆代班" },
      { label: "小青・外場服務", value: state.staff.server ? money(server.wage) : "老闆代班" }
    ], { label: "今晚排班薪資", value: money(staffCost()), negative: false }));
    return fragment(parts);
  }

  function accountingTable(label, headers, rows) {
    const shell = el("div", "accounting-table-shell", null, { role: "region", "aria-label": label, tabindex: 0 });
    const table = el("table", "accounting-table");
    const mobileList = el("div", "accounting-mobile-list", null, { role: "list", "aria-label": label });
    const head = el("thead");
    const headRow = el("tr");
    headers.forEach(function(title) { headRow.append(el("th", "", title, { scope: "col" })); });
    head.append(headRow);
    const body = el("tbody");
    rows.forEach(function(values) {
      const row = el("tr");
      values.forEach(function(value, index) {
        row.append(el("td", "", value, { dataset: { label: headers[index] || "資料" } }));
      });
      body.append(row);

      const record = el("article", "accounting-mobile-record", null, { role: "listitem" });
      record.append(el("h4", "accounting-mobile-record-title", values[0] || label));
      const details = el("dl", "accounting-mobile-details");
      values.slice(1).forEach(function(value, index) {
        const item = el("div", "accounting-mobile-item");
        append(item, el("dt", "", headers[index + 1] || "資料"), el("dd", "", value));
        details.append(item);
      });
      record.append(details);
      mobileList.append(record);
    });
    table.append(head, body);
    shell.append(table, mobileList);
    return shell;
  }

  function filterSelect(label, action, items, selected) {
    const labelNode = el("label", "accounting-filter");
    append(labelNode, el("span", "", label));
    const select = el("select", "", null, { "aria-label": label, dataset: { action, filter: action } });
    items.forEach(function(item) {
      select.append(el("option", "", item.label, { value: String(item.value), selected: String(item.value) === String(selected) }));
    });
    labelNode.append(select);
    return labelNode;
  }

  function renderDailyJournal() {
    const accounting = state.accounting || {};
    const completedDays = Array.from(new Set((accounting.journal || [])
      .filter((entry) => entry.day > 0 && entry.day < state.day)
      .map((entry) => entry.day))).sort((a, b) => b - a);
    if (!completedDays.length) {
      return fragment(subhead("前一日・日記簿", "打烊後自動歸檔", true),
        storyCard("還沒有已完成的營業日。", "第一晚結束並收進手記後，這裡會出現前一日的會計分錄與營運日記。"));
    }
    const day = completedDays.includes(Number(selectedJournalDay)) ? Number(selectedJournalDay) : completedDays[0];
    const options = completedDays.slice(0, 90).map((value) => ({ value, label: "第 " + value + " 夜・" +
      (accounting.journal || []).filter((entry) => entry.day === value).length + " 筆分錄" }));
    const entries = (accounting.journal || []).filter((entry) => entry.day === day && !entry.opening);
    const rows = [];
    entries.forEach(function(entry) {
      entry.lines.forEach(function(line) {
        const account = CHART_OF_ACCOUNTS.find((item) => item.code === line.account);
        rows.push([entry.description, line.account + " " + (account ? account.name : "未知科目"),
          line.debit ? formatBalance(line.debit) : "—", line.credit ? formatBalance(line.credit) : "—"]);
      });
    });
    const narrative = (state.journal || []).find((entry) => entry.day === day);
    const parts = [
      subhead("前一日・日記簿", "第 " + day + " 夜｜借貸分錄", true),
      filterSelect("選擇營業日", "diary-day", options, day),
      helper("每日交易以借貸相等方式記錄；存貨採買列資產，食材售出時才認列銷貨成本。", "helper-copy accounting-note"),
      accountingTable("第 " + day + " 夜日記簿", ["交易摘要", "會計科目", "借方", "貸方"], rows)
    ];
    if (narrative) {
      const story = el("article", "story-card journal-entry");
      append(story, el("h3", "", narrative.title), el("p", "", narrative.event + "・" + narrative.choice + "・當夜營運淨額 " + moneyNet(narrative.net)));
      if (narrative.marketCard) story.append(el("p", "", "公告卡：" + narrative.marketCard + (narrative.marketChoice ? "・" + narrative.marketChoice : "")));
      if (narrative.guests?.length) story.append(el("p", "", "來客：" + narrative.guests.join("、")));
      parts.push(story);
    }
    return fragment(parts);
  }

  function renderWeeklyWorksheet() {
    const reports = state.accounting?.weeklyReports || [];
    if (!reports.length) return fragment(subhead("每週工作底稿", "第七夜打烊後產生", true),
      storyCard("第一份週底稿尚未結帳。", "完成第 7 夜後，系統會整理試算表、借貸發生額與期末餘額。"));
    const report = reports.find((item) => item.week === Number(selectedWeek)) || reports[reports.length - 1];
    const select = filterSelect("工作週", "week-report", reports.slice().reverse().map((item) => ({
      value: item.week, label: "第 " + item.week + " 週・第 " + item.startDay + "–" + item.endDay + " 夜"
    })), report.week);
    const rows = report.rows.map((row) => [row.code + " " + row.name,
      formatBalance(row.opening), formatBalance(row.debit), formatBalance(row.credit),
      row.closingDebit ? formatBalance(row.closingDebit) : "—",
      row.closingCredit ? formatBalance(row.closingCredit) : "—"]);
    const parts = [
      subhead("每週工作底稿", "第 " + report.week + " 週・第 " + report.startDay + "–" + report.endDay + " 夜", true),
      select,
      el("div", "statement-status " + (report.balanced ? "balanced" : "unbalanced"),
        report.balanced ? "借貸試算平衡" : "借貸差額待核對"),
      accountingTable("第 " + report.week + " 週試算表", ["會計科目", "期初餘額", "借方發生", "貸方發生", "期末借方", "期末貸方"], rows),
      ledger([
        { label: "期末試算借方合計", value: formatBalance(report.trialDebit) },
        { label: "期末試算貸方合計", value: formatBalance(report.trialCredit) }
      ])
    ];
    return fragment(parts);
  }

  function statementRows(report, kind) {
    const p = report.comprehensiveIncome;
    if (kind === "income") return [
      ["餐飲銷貨收入", formatBalance(p.revenue["4000"] || 0)],
      ["服務費及小費收入", formatBalance(p.revenue["4010"] || 0)],
      ["補助及其他營業收入", formatBalance(p.revenue["4020"] || 0)],
      ["退款及銷貨折讓", formatBalance(-p.returns)],
      ["營業收入淨額", formatBalance(p.netRevenue)],
      ...Object.entries(p.expenseBreakdown).map(([code, amount]) => {
        const account = CHART_OF_ACCOUNTS.find((item) => item.code === code);
        return [account ? account.name : code, formatBalance(-amount)];
      }),
      ["營業利益", formatBalance(p.operatingProfit)],
      ["財務成本", formatBalance(-p.financeCosts)],
      ["所得稅費用", formatBalance(-p.incomeTax)],
      ["本期損益", formatBalance(p.profit)],
      ["其他綜合損益（本遊戲未設定）", formatBalance(p.otherComprehensiveIncome)],
      ["本期綜合損益總額", formatBalance(p.totalComprehensiveIncome)]
    ];
    if (kind === "equity") {
      const e = report.equityChanges;
      return [
        ["期初業主投入資本", formatBalance(e.openingCapital)],
        ["本期資本投入", formatBalance(e.capitalContributions)],
        ["期初保留盈餘／累積虧損", formatBalance(e.openingRetainedEarnings)],
        ["本期綜合損益", formatBalance(e.comprehensiveIncome)],
        ["業主提取", formatBalance(-e.drawings)],
        ["期末權益", formatBalance(e.closingEquity)]
      ];
    }
    if (kind === "position") {
      const f = report.financialPosition;
      return [
        ["資產", ""],
        ["現金及約當現金", formatBalance(f.assets.cash)],
        ["存貨－食材", formatBalance(f.assets.inventory)],
        ["設備及租賃改良－成本", formatBalance(f.assets.ppeCost)],
        ["減：累計折舊", formatBalance(-f.assets.ppeDep)],
        ["設備及租賃改良－帳面金額", formatBalance(f.assets.ppeNet)],
        ["攤位經營權－成本", formatBalance(f.assets.rightsCost)],
        ["減：累計攤銷", formatBalance(-f.assets.rightsAmort)],
        ["攤位經營權－帳面金額", formatBalance(f.assets.rightsNet)],
        ["資產總額", formatBalance(f.assets.total)],
        ["負債", ""],
        ["銀行週轉借款", formatBalance(f.liabilities.bankBorrowings)],
        ["銀行透支（負現金餘額重分類）", formatBalance(f.liabilities.bankOverdraft)],
        ["負債總額", formatBalance(f.liabilities.total)],
        ["權益", ""],
        ["業主投入資本", formatBalance(f.equity.capital)],
        ["保留盈餘及本期損益", formatBalance(f.equity.retainedEarnings + f.equity.currentProfit)],
        ["權益總額", formatBalance(f.equity.total)],
        ["負債及權益總額", formatBalance(f.totalLiabilitiesAndEquity)]
      ];
    }
    const c = report.cashFlow;
    return [
      ["營業活動現金流量淨額", formatBalance(c.operating)],
      ["投資活動現金流量淨額", formatBalance(c.investing)],
      ["籌資活動現金流量淨額", formatBalance(c.financing)],
      ["銀行透支變動（列入籌資活動）", formatBalance(c.overdraftChange)],
      ["現金及約當現金淨增加／減少", formatBalance(c.netChange)],
      ["期初現金及約當現金", formatBalance(c.openingCash)],
      ["期末現金及約當現金", formatBalance(c.closingCash)]
    ];
  }

  function renderMonthlyStatements() {
    const reports = state.accounting?.monthlyReports || [];
    if (!reports.length) return fragment(subhead("每三十夜・綜合財務報表", "第 30 夜結帳後產生", true),
      storyCard("第一期尚未結帳。", "夜市不停業；每三十夜只完成一次財務期間結帳，接著繼續下一夜。"));
    const report = reports.find((item) => item.period === Number(selectedReportPeriod)) || reports[reports.length - 1];
    const position = report.financialPosition;
    const profit = report.comprehensiveIncome.totalComprehensiveIncome;
    const summary = el("section", "statement-summary", null, { "aria-label": "第 " + report.period + " 期財報摘要" });
    summary.append(el("span", "statement-summary-heading", "本期摘要"));
    const metrics = el("div", "statement-summary-grid");
    [
      ["本期綜合損益", moneyNet(profit), profit < 0 ? "negative" : "positive"],
      ["期末現金", money(position.assets.cash), ""],
      ["資產總額", money(position.assets.total), ""],
      ["負債總額", money(position.liabilities.total), ""]
    ].forEach(([label, value, tone]) => {
      const item = el("div", "statement-metric");
      append(item, el("span", "statement-metric-label", label),
        el("b", "statement-metric-value" + (tone ? " " + tone : ""), value));
      metrics.append(item);
    });
    summary.append(metrics);
    const select = filterSelect("財務期間", "report-period", reports.slice().reverse().map((item) => ({
      value: item.period, label: "第 " + item.period + " 期・第 " + item.startDay + "–" + item.endDay + " 夜"
    })), report.period);
    const statementTabs = el("div", "statement-picker", null, { role: "group", "aria-label": "選擇財務報表" });
    [
      ["income", "綜合損益表"],
      ["equity", "權益變動表"],
      ["position", "資產負債表"],
      ["cashflow", "現金流量表"]
    ].forEach(([id, name]) => {
      const choice = button(name, "statement-view", { id }, false,
        "statement-picker-button" + (reportStatement === id ? " active" : ""));
      choice.setAttribute("aria-pressed", String(reportStatement === id));
      statementTabs.append(choice);
    });
    const title = { income: "綜合損益表", equity: "權益變動表", position: "資產負債表", cashflow: "現金流量表" }[reportStatement];
    const rows = statementRows(report, reportStatement);
    const parts = [
      subhead(title, "第 " + report.period + " 期・第 " + report.startDay + "–" + report.endDay + " 夜", true),
      summary, select, statementTabs,
      accountingTable(title + "・第 " + report.period + " 期", ["IFRS 導向報表項目", "金額"], rows)
    ];
    if (reportStatement === "position") parts.push(el("div", "statement-status " + (report.financialPosition.balanced ? "balanced" : "unbalanced"),
      report.financialPosition.balanced ? "資產 = 負債 + 權益" : "財務狀況表有差額，請檢查分錄"));
    if (reportStatement === "cashflow") parts.push(el("div", "statement-status " + (report.cashFlow.reconciles ? "balanced" : "unbalanced"),
      report.cashFlow.reconciles ? "現金流量與期初／期末現金勾稽一致" : "現金流量尚未勾稽"));
    if (report.outcome) parts.push(storyCard("本期故事走向｜" + report.outcome.title, report.outcome.text));
    parts.push(helper("報表按遊戲內部 IFRS 導向科目彙整；目前其他綜合損益、所得稅及業主提取未設定，故為零。", "helper-copy accounting-note"));
    return fragment(parts);
  }

  function renderChartOfAccounts() {
    const categories = { asset: "資產", "contra-asset": "資產減項", liability: "負債", equity: "權益",
      income: "收入", "contra-income": "收入減項", expense: "費用" };
    const rows = CHART_OF_ACCOUNTS.map((account) => [account.code, account.name, categories[account.type], account.statement]);
    return fragment(subhead("會計科目表", "遊戲內部 IFRS 導向映射", true),
      helper("IFRS 規範財務報表的表達與揭露，但不指定通用帳號編碼。本專案科目代碼為遊戲內部設計，並非官方 IFRS 科目編號。", "helper-copy accounting-note"),
      accountingTable("夜市會計科目表", ["科目代碼", "科目名稱", "分類", "主要報表"], rows));
  }

  function renderStoryJournal() {
    const currentPeriodStart = Math.floor((state.day - 1) / CAMPAIGN_DAYS) * CAMPAIGN_DAYS + 1;
    const completed = new Set((state.journal || []).filter((entry) => entry.day >= currentPeriodStart)
      .map((entry) => campaignCycleDay(entry.day)));
    const currentCycleDay = campaignCycleDay(state.day);
    const timeline = el("div", "timeline-list");
    CAMPAIGN_CALENDAR.forEach(function(night, index) {
      const day = index + 1;
      const status = completed.has(day) ? "completed" : (day === currentCycleDay ? "current" : "upcoming");
      const row = el("article", "timeline-row " + status);
      const copy = el("span", "timeline-copy");
      append(copy, el("b", "", night.title), el("span", "", night.name));
      const marker = WEEKLY_DECISION_DAYS.includes(day) ? el("span", "timeline-marker", "週轉") : null;
      append(row, el("span", "timeline-day", String(day).padStart(2, "0")), copy, marker,
        el("span", "timeline-status", status === "completed" ? "已完成" : (status === "current" ? "進行中" : "待開啟")));
      timeline.append(row);
      if ([7, 14, 21, 28].includes(day)) timeline.append(el("div", "timeline-week-break", "第 " + (day / 7) + " 週底稿"));
    });
    const parts = [subhead("夜市手記・故事循環", "故事每 30 夜回環，世界與帳務持續前進", true), timeline];
    if (!state.journal.length) parts.push(storyCard("港邊手記還是空白的。", "完成一晚營業、招待客人，並做一個打烊後的小決定，第一段故事就會留在這裡。"));
    (state.journal || []).forEach(function(entry) {
      const item = el("article", "story-card journal-entry");
      append(item, el("h3", "", "第 " + entry.day + " 夜 ｜ " + entry.event),
        el("p", "", entry.title + "　" + entry.choice + " ｜ 淨額 " + moneyNet(entry.net)));
      if (entry.marketCard) item.append(el("p", "", "公告卡：" + entry.marketCard + (entry.marketChoice ? "・" + entry.marketChoice : "")));
      if (entry.guests?.length) item.append(el("p", "", entry.guests.join("、")));
      parts.push(item);
    });
    return fragment(parts);
  }

  const journalReports = {
    daily: { title: "前一日日記簿", description: "逐筆查看借貸分錄與當夜營運手記。", icon: "◷" },
    weekly: { title: "每週工作底稿", description: "檢視試算平衡、借貸發生額與期末餘額。", icon: "▤" },
    monthly: { title: "30 夜財務報表", description: "查閱綜合損益、權益變動、資產負債與現金流量。", icon: "▦" },
    chart: { title: "會計科目表", description: "查看遊戲內部 IFRS 導向科目與報表分類。", icon: "≡" },
    stories: { title: "港邊手記", description: "回顧每夜事件、選擇與經營故事。", icon: "▣" }
  };

  function journalReportStatus(view) {
    const accounting = state.accounting || {};
    if (view === "daily") {
      const days = Array.from(new Set((accounting.journal || []).filter((entry) => entry.day > 0 && entry.day < state.day)
        .map((entry) => entry.day))).sort((a, b) => b - a);
      return days.length ? "最近完成・第 " + days[0] + " 夜" : "完成第一晚營業後開放";
    }
    if (view === "weekly") return accounting.weeklyReports?.length
      ? "已結帳 " + accounting.weeklyReports.length + " 週" : "每 7 夜產生一次";
    if (view === "monthly") return accounting.monthlyReports?.length
      ? "已結帳 " + accounting.monthlyReports.length + " 期" : "完成第 30 夜後產生";
    if (view === "chart") return CHART_OF_ACCOUNTS.length + " 個內部科目";
    return "已記錄 " + (state.journal || []).length + " 夜";
  }

  function renderJournal() {
    const grid = el("div", "report-launch-grid", null, { role: "group", "aria-label": "帳務與手記資料" });
    Object.entries(journalReports).forEach(([id, report]) => {
      const launch = button("", "open-report", { id }, false, "report-launch");
      launch.setAttribute("aria-haspopup", "dialog");
      launch.setAttribute("aria-controls", "reportDialog");
      append(launch,
        el("span", "report-launch-icon", report.icon, { "aria-hidden": "true" }),
        el("span", "report-launch-copy"),
        el("span", "report-launch-arrow", "›", { "aria-hidden": "true" }));
      const copy = launch.querySelector(".report-launch-copy");
      append(copy, el("b", "report-launch-title", report.title),
        el("span", "report-launch-description", report.description),
        el("span", "report-launch-status", journalReportStatus(id)));
      grid.append(launch);
    });
    return fragment(
      subhead("查閱帳務資料", "點選項目以開啟", true),
      helper("報表會在獨立視窗展開；手機版明細改以卡片呈現。可按 Escape 或右上角返回。", "helper-copy report-intro"),
      grid
    );
  }

  function getJournalReportInfo() {
    return journalReports[journalView] || journalReports.daily;
  }

  function renderJournalReport() {
    const view = {
      daily: renderDailyJournal,
      weekly: renderWeeklyWorksheet,
      monthly: renderMonthlyStatements,
      chart: renderChartOfAccounts,
      stories: renderStoryJournal
    }[journalView] || renderDailyJournal;
    return view();
  }

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
      const summary = el("p", "outlet-summary", staffLine + "・主打 " + product.productName + " " +
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
        [{ id: product.stockId, name: product.productName, icon: product.icon, cost: product.cost, unit: product.unit }];
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
    dishes.forEach(function(dish) {
      const recommended = dish.need.indexOf(guest.need) !== -1;
      const available = Number(state.stock[dish.ingredient]) > 0;
      const choice = button("", "serve-dish", { id: dish.id }, !available,
        "dish-choice" + (recommended ? " recommended" : ""));
      const copy = el("span", "dish-choice-copy");
      append(copy,
        el("span", "dish-choice-name", dish.name + (recommended ? " ｜ 投其所好" : "")),
        el("span", "dish-choice-note", dish.line + " ｜ 庫存 " + (state.stock[dish.ingredient] || 0) + " ｜ 食材 " + money(getFoodCost(dish))));
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
    mainAction.textContent = state.phase === "prep" ? "掛燈迎客" : (state.phase === "service" ? "接待下一桌" : (state.phase === "report" ? "收進手記，準備明晚" : "先選擇本週方向"));
    mainAction.disabled = state.phase === "decision";
    mainAction.setAttribute("aria-disabled", String(mainAction.disabled));
    mainAction.dataset.action = "main-action";
    document.querySelectorAll(".panel-tab").forEach(function(tab) {
      tab.classList.toggle("active", tab.dataset.tab === activeTab);
      tab.setAttribute("aria-selected", String(tab.dataset.tab === activeTab));
    });
    document.getElementById("panelContent").setAttribute("aria-labelledby", "tab-" + activeTab);
    const titles = { ops: "今晚營運", stall: "攤位工作台", stock: "備料與菜單", equipment: "設備與改造", staff: "人員排班", journal: "帳務與手記" };
    document.getElementById("panelHeading").textContent = titles[activeTab] || titles.ops;
    const renderers = { ops: renderOverview, stall: renderStall, stock: renderStock, equipment: renderEquipment, staff: renderStaff, journal: renderJournal };
    document.getElementById("panelContent").replaceChildren((renderers[activeTab] || renderOverview)());
    document.getElementById("saveLabel").textContent = saveState(state) ? "進度已儲存" : "瀏覽器未保存進度";
    return event;
  }

  function setTabAndRender(tab) { setTab(tab); renderUI(); }
  function setJournalView(view) {
    if (["daily", "weekly", "monthly", "chart", "stories"].includes(view)) journalView = view;
  }
  function setStatementView(view) {
    if (["income", "equity", "position", "cashflow"].includes(view)) reportStatement = view;
  }
  function setJournalFilter(filter, value) {
    if (filter === "diary-day") selectedJournalDay = Number(value) || null;
    if (filter === "report-period") selectedReportPeriod = Number(value) || null;
    if (filter === "week-report") selectedWeek = Number(value) || null;
  }
  return {
    renderUI: renderUI,
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

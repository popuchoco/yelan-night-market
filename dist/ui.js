import { DATA } from "./data.js";
import {
  createLedger as createLedgerForState, forecast, getFoodCost as getFoodCostForState,
  getPurchasePrice as getPurchasePriceForState, getTonightGuests as getTonightGuestsForState,
  ledgerIncome, ledgerNet, money, staffCost as staffCostForState,
  todayEvent as selectEvent, todayStory as selectStory
} from "./state.js";

// UI nodes are built with DOM APIs so player names, journal entries, and game data
// are always treated as text rather than parsed as markup.
export function createUI(runtime) {
  const { state, saveState } = runtime;
  const { dishes, ingredients, equipment, staff: staffRoles, upgrades } = DATA;
  let activeTab = "ops";

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
  function todayEvent() { return selectEvent(state); }
  function todayStory() { return selectStory(state); }
  function getTonightGuests() { return getTonightGuestsForState(state); }
  function staffCost() { return staffCostForState(state); }
  function getPurchasePrice(item) { return getPurchasePriceForState(state, item); }
  function getFoodCost(dish) { return getFoodCostForState(state, dish); }
  function createLedger() { return createLedgerForState(state); }

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
  function storyCard(title, text, className) {
    const card = el("div", className || "story-card");
    append(card, el("h3", "", title), el("p", "", text));
    return card;
  }

  function renderOverview() {
    const event = todayEvent();
    const outlook = forecast(state);
    const parts = [];
    if (state.day === 3) {
      const guide = el("aside", "guide-card");
      append(guide, el("b", "", "新手小抄"),
        el("span", "", "先到「攤位」補食材、調班表；開門後點擊發光客人接單。遇到客訴可選擇安撫、招待或退款，打烊再選一段手記。"));
      parts.push(guide);
    }
    parts.push(eventCard(event));
    parts.push(subhead(state.phase === "prep" ? "開門前損益預估" : "今晚營運帳本",
      String(outlook.guests.length).padStart(2, "0") + " 桌客流"));

    if (state.phase === "prep") {
      parts.push(ledger([
        { label: "攤位租金", value: "−" + money(outlook.ledger.rent) },
        { label: "排班薪資", value: "−" + money(outlook.ledger.labor) },
        { label: "電費 / 瓦斯", value: "−" + money(outlook.ledger.electricity + outlook.ledger.gas) },
        { label: "預估食材耗用", value: "−" + money(outlook.food), tone: "outflow" },
        { label: "預估小費 / 活動 Bonus", value: "+" + money(outlook.tips + outlook.bonus), tone: "income" }
      ], { label: "預估營業淨額", value: moneyNet(outlook.net), negative: outlook.net < 0 }));
      parts.push(helper("租金、人事與能源在開門時扣款；食材採購先扣現金，實際耗用按庫存成本入帳。"));
      parts.push(subhead("開門前快速檢查", "一切準備好了嗎？"));

      const list = el("div", "guest-list");
      const stock = el("div", "guest-row");
      const stockInfo = el("span", "guest-info");
      append(stock, el("span", "guest-avatar", "🥬"));
      append(stockInfo, el("span", "guest-name", "備料現況"),
        el("span", "guest-need", "雞湯 " + (state.stock.chicken || 0) + " · 海味 " + (state.stock.seafood || 0) + " · 茶點 " + (state.stock.tea || 0)));
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
        { label: "食材耗用", value: "−" + money(state.ledger.food), tone: "outflow" },
        { label: "固定支出已扣", value: "−" + money(state.ledger.rent + state.ledger.labor + state.ledger.electricity + state.ledger.gas) }
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
        row.append(button((active.difficult ? "處理現場客訴" : "接待 " + active.name + " 點餐") + "　→",
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
      append(entry, el("h3", "", "打烊結算 · 第 " + String(state.day).padStart(2, "0") + " 夜"),
        el("p", "", (net >= 0 ? opening : opening) + " " + event.name + "。總收入 " + money(ledgerIncome(state.ledger)) +
          "；食材耗用 " + money(state.ledger.food) + "；固定成本 " +
          money(state.ledger.rent + state.ledger.labor + state.ledger.electricity + state.ledger.gas) +
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
      next.append(button("收進手記，準備明晚　→", "next-night", {}, !state.reportChoice, "primary-button full-width"));
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
      const action = button("補 1 份 · " + money(price), "buy-stock", { id: item.id },
        state.phase !== "prep" || state.coins < price, "manager-action");
      const meta = el("span", "manager-meta");
      append(meta, document.createTextNode("現有 "));
      append(meta, el("b", "", qty), document.createTextNode(" 份 · 平均成本 " + money(cost)));
      const itemNode = managerItem(item.icon, item.name, "配方：" + item.recipe, null, action);
      itemNode.querySelector(".manager-copy").append(meta);
      grid.append(itemNode);
    });
    parts.push(grid, subhead("今晚菜單", "選一道招牌拿額外小費"));
    const menu = el("div", "manager-grid");
    dishes.forEach(function(dish, index) {
      const meta = el("span", "manager-meta");
      append(meta, document.createTextNode("售價 "));
      append(meta, el("b", "", money(dish.price)), document.createTextNode(" · 庫存 " + (state.stock[dish.ingredient] || 0)));
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
        document.createTextNode(" · 最高 " + item.costs.length + " 級"));
      const action = button(price ? "升級 " + money(price) : "已滿級", "upgrade-equipment",
        { id: item.id }, state.phase !== "prep" || typeof price !== "number" || state.coins < price, "manager-action");
      const itemNode = managerItem(item.icon, item.name + " · Lv." + level, item.note, null, action);
      itemNode.querySelector(".manager-copy").append(meta);
      grid.append(itemNode);
    });
    parts.push(grid, subhead("夜市改造", "打造熟客的理由"));
    const additions = el("div", "manager-grid");
    upgrades.forEach(function(item) {
      const owned = !!state.upgrades[item.id];
      additions.append(managerItem(item.icon, item.name + (owned ? " · 已添置" : ""), item.note, null,
        button(owned ? "已擁有" : money(item.cost), "buy-upgrade", { id: item.id },
          owned || state.phase !== "prep" || state.coins < item.cost, "manager-action")));
    });
    parts.push(additions);
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
      grid.append(managerItem(person.icon, person.name + " · " + person.role,
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

  function renderJournal() {
    if (!state.journal.length) {
      return fragment(storyCard("港邊手記還是空白的。", "完成一晚營業、招待客人，並做一個打烊後的小決定，第一段故事就會留在這裡。"));
    }
    const parts = [subhead("夜市營運手記", "最近 " + state.journal.length + " 夜", true)];
    state.journal.forEach(function(entry) {
      const item = el("article", "story-card journal-entry");
      append(item, el("h3", "", "第 " + String(entry.day).padStart(2, "0") + " 夜 · " + entry.event));
      const text = el("p");
      append(text, el("b", "", entry.title),
        document.createTextNode(" "),
        document.createElement("br"),
        document.createTextNode(entry.choice + " · 淨額 " + moneyNet(entry.net)),
        document.createElement("br"),
        document.createTextNode(entry.guests.join("、")));
      item.append(text);
      parts.push(item);
    });
    return fragment(parts);
  }

  function renderStall() {
    const outlook = forecast(state);
    const staffNames = staffRoles.filter(function(person) { return state.staff[person.id]; }).map(function(person) { return person.name; });
    const equipmentLevel = equipment.reduce(function(total, item) {
      return total + (Number(state.equipment[item.id]) || 0);
    }, 0);
    const parts = [subhead("夜嵐攤號・工作台", "第 " + String(state.day).padStart(2, "0") + " 夜", true)];
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
      { label: "水電瓦斯", value: money(outlook.ledger.electricity + outlook.ledger.gas) }
    ], { label: "目前預估淨額", value: moneyNet(outlook.net), negative: outlook.net < 0 }));
    parts.push(helper("攤位工作台整合每日營運。開門前可調整備料、設備與班表；開門後，採購與施工會鎖定。"));
    const actions = el("div", "stall-actions");
    append(actions,
      button("🥬 管理備料與菜單 →", "panel-tab", { tab: "stock" }),
      button("⚒ 管理設備 →", "panel-tab", { tab: "equipment" }),
      button("👥 管理排班 →", "panel-tab", { tab: "staff" }));
    parts.push(actions, button(
      state.phase === "prep" ? "🏮 掛燈迎客，開始營業" : (state.phase === "service" ? "接待下一桌　→" : "查看今晚結算"),
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
        el("span", "dish-choice-name", dish.name + (recommended ? " · 投其所好" : "")),
        el("span", "dish-choice-note", dish.line + " · 庫存 " + (state.stock[dish.ingredient] || 0) + " · 食材 " + money(getFoodCost(dish))));
      append(choice, el("span", "dish-choice-icon", dish.icon), copy,
        el("span", "dish-choice-price", money(dish.price)));
      grid.append(choice);
    });
    parts.push(grid);
    return fragment(parts);
  }

  function renderUI() {
    const event = todayEvent();
    document.getElementById("dayValue").textContent = String(state.day).padStart(2, "0");
    document.getElementById("coinsValue").textContent = money(state.coins);
    document.getElementById("fameValue").textContent = String(state.fame);
    document.getElementById("regularValue").textContent = String(state.regulars).padStart(2, "0") + " / 24";
    document.getElementById("phaseLabel").textContent = state.phase === "prep" ? "準備中" : (state.phase === "service" ? "營業中" : "已打烊");
    document.getElementById("panelPhase").textContent = state.phase === "prep" ? "準備時段" : (state.phase === "service" ? "現場營業" : "打烊結算");
    document.querySelector(".world-title").textContent = state.phase === "prep" ? "潮聲近了，準備開門嗎？" :
      (state.phase === "service" ? "燈火亮起，巷口正湧進人潮。" : "今晚的帳本，記下了你的選擇。");
    const worldState = document.getElementById("worldState");
    worldState.classList.toggle("open", state.phase === "service");
    document.getElementById("worldStateText").textContent = state.phase === "prep" ? "備料與排班中" :
      (state.phase === "service" ? "客人走進夜市・營業中" : "這一夜已打烊");
    const mainAction = document.getElementById("mainAction");
    mainAction.textContent = state.phase === "prep" ? "掛燈迎客　→" : (state.phase === "service" ? "接待下一桌　→" : "準備明晚　→");
    mainAction.dataset.action = "main-action";
    document.querySelectorAll(".panel-tab").forEach(function(tab) {
      tab.classList.toggle("active", tab.dataset.tab === activeTab);
    });
    const titles = { ops: "今晚營運", stall: "攤位工作台", stock: "備料與菜單", equipment: "設備與改造", staff: "人員排班", journal: "港邊手記" };
    document.getElementById("panelHeading").textContent = titles[activeTab] || titles.ops;
    const renderers = { ops: renderOverview, stall: renderStall, stock: renderStock, equipment: renderEquipment, staff: renderStaff, journal: renderJournal };
    document.getElementById("panelContent").replaceChildren((renderers[activeTab] || renderOverview)());
    document.getElementById("saveLabel").textContent = saveState(state) ? "進度已儲存" : "瀏覽器未保存進度";
    return event;
  }

  function setTabAndRender(tab) { setTab(tab); renderUI(); }
  return {
    renderUI: renderUI,
    renderOrderChoices: renderOrderChoices,
    setTab: setTab,
    setTabAndRender: setTabAndRender,
    getTab: function() { return activeTab; }
  };
}

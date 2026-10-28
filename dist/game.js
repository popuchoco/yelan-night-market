import { DATA } from "./data.js";
import { CAMPAIGN_DAYS, ENDINGS, WEEKLY_OPTIONS, WEEKLY_DECISION_DAYS, selectEnding, weeklyOptionCost } from "./campaign.js";
import {
  createLedger, getFoodCost, getPurchasePrice, getTonightGuests, ledgerIncome, ledgerNet,
  freshState, loadState, money, saveState, staffCost, todayEvent, todayStory
} from "./state.js";
import { createScene } from "./scene.js";
import { createUI } from "./ui.js";

const capAt = (value, max) => Math.min(max, value);

export function createGameEngine(state) {
  const guests = () => getTonightGuests(state);
  const event = () => todayEvent(state);
  const response = (ok, message, changed = ok) => ({ ok, changed, message });

  function openDoors() {
    if (state.phase !== "prep") return response(false, "現在不是開門準備時段。");
    state.phase = "service";
    state.customerIndex = 0;
    state.revenue = 0;
    state.results = [];
    state.reportChoice = null;
    state.ledger = createLedger(state);
    const fixed = state.ledger.rent + state.ledger.expansionRent + state.ledger.acquisitionRent + state.ledger.labor + state.ledger.water + state.ledger.electricity + state.ledger.gas + state.ledger.fees;
    state.coins -= fixed;
    if (state.ledger.fees) state.fame = Math.max(0, state.fame - 2);
    else if (event().id === "inspection") state.fame = capAt(state.fame + 1, 100);
    return response(true, "租金、人事、能源與活動費用 " + money(fixed) + " 已扣。街口有人往你的燈牌走來。");
  }

  function serveDish(id) {
    if (state.phase !== "service") return response(false, "目前沒有營業中的訂單。", false);
    const dish = DATA.dishes.find((item) => item.id === id);
    const guest = guests()[state.customerIndex];
    if (!dish || !guest || guest.difficult) return response(false, "這位客人目前不能點這道料理。", false);
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

    const score = good ? ((state.staff.cook && state.staff.server) || state.hiredCrew > 0 ? 100 : 84) : 68;
    state.fame += good ? (score >= 90 ? 2 : 1) : 1;
    if (good) {
      state.cozy = capAt(state.cozy + 2, 100);
      if (score >= 90) state.regulars = capAt(state.regulars + 1, 24);
    }
    state.results.push({ name: guest.name, icon: guest.icon, score, reaction: good ? (score >= 90 ? "剛剛好" : "老闆忙中代班") : "也不錯", mood: guest.mood, good, dish: dish.name });
    state.customerIndex += 1;
    if (state.customerIndex >= guests().length) state.phase = "report";
    const eventText = eventBonus ? "燈節 Bonus +" + money(eventBonus) + "。 " : "";
    return response(true, eventText + (good ? guest.name + "吃得滿足，留下了一句謝謝。" : guest.name + "收下餐點，安靜地笑了笑。"));
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
      state.fame += 1;
      state.cozy = capAt(state.cozy + 1, 100);
      score = 92;
      reaction = "小菜化解客訴";
    } else if (choice === "refund") {
      state.coins -= economy.complaintRefund;
      state.ledger.refunds += economy.complaintRefund;
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
    return response(true, item.name + "升至 Lv." + (level + 1) + "，模型與營運效果已更新。");
  }

  function buyUpgrade(id) {
    if (state.phase !== "prep") return response(false, "開門後不能改造。", false);
    const item = DATA.upgrades.find((upgrade) => upgrade.id === id);
    if (!item || state.upgrades[id] || state.coins < item.cost) return response(false, "現金不足，或這項改造已經添置。", false);
    state.coins -= item.cost;
    state.upgrades[id] = true;
    if (id === "lantern") state.cozy = capAt(state.cozy + 8, 100);
    if (id === "old-radio") state.fame += 6;
    return response(true, item.name + "已添置，夜市多了一個讓人留下來的理由。");
  }

  function toggleStaff(role) {
    if (state.phase !== "prep" || !Object.prototype.hasOwnProperty.call(state.staff, role)) return response(false, "目前不能調整這個班表。", false);
    state.staff[role] = !state.staff[role];
    return response(true, state.staff[role] ? "已加入今晚班表。" : "改由老闆代班，薪資省下但服務小費會下降。");
  }

  function selectDish(index) {
    if (state.phase !== "prep") return response(false, "開門後不能更換招牌菜。", false);
    const selected = Number(index);
    if (!Number.isInteger(selected) || selected < 0 || selected >= DATA.dishes.length) return response(false, "找不到這道招牌菜。", false);
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
    }
    return response(true, id === "paperboat" ? "紙船漂進港灣，手記多了一頁。" : "替熟客留了窗邊桌，收到 NT$ 80 心意。");
  }

  function chooseWeeklyDecision(id) {
    if (state.phase !== "decision") return response(false, "目前不是本週投資決策時段。", false);
    const option = WEEKLY_OPTIONS[id];
    const cost = weeklyOptionCost(state, id);
    if (!option || cost === null) return response(false, "這項發展已達目前規模上限，請選其他方向。", false);
    if (state.coins < cost) return response(false, "現金不足，請選擇暫不投資或其他負擔較低的方向。", false);
    state.coins -= cost;
    if (id === "expand") {
      state.expansions += 1;
      state.cozy = capAt(state.cozy + 5, 100);
    } else if (id === "hire") {
      state.hiredCrew += 1;
      state.fame = capAt(state.fame + 2, 100);
    } else if (id === "acquire") {
      state.acquisitions += 1;
      state.fame = capAt(state.fame + 5, 100);
      state.regulars = capAt(state.regulars + 1, 24);
    }
    state.decisions.push({ day: state.day, id, name: option.name, cost });
    state.phase = "prep";
    state.selectedDish = (state.day - 1) % DATA.dishes.length;
    return response(true, id === "hold" ? "保留現金，照目前規模進入新的一週。" : option.name + "已完成，往後每夜固定成本與客流效果同步更新。");
  }

  function nextNight() {
    if (state.phase !== "report" || !state.reportChoice) return response(false, "先完成今晚的打烊選擇。", false);
    const finishedDay = state.day;
    const net = ledgerNet(state.ledger);
    state.journal.unshift({ day: state.day, event: event().name, title: todayStory(state).title,
      choice: state.reportChoice === "paperboat" ? "把紙船放回港灣" : "替熟客留了一張窗邊桌",
      net, guests: state.results.map((result) => result.name) });
    state.journal = state.journal.slice(0, 30);
    state.campaignNet = (Number(state.campaignNet) || 0) + net;
    state.customerIndex = 0;
    state.revenue = 0;
    state.results = [];
    state.reportChoice = null;
    state.ledger = null;
    state.shiftPurchases = 0;
    if (finishedDay >= CAMPAIGN_DAYS) {
      state.endingId = selectEnding(state);
      state.phase = "ending";
      return response(true, "三十夜經營告一段落：" + ENDINGS[state.endingId].title + "。你的選擇已寫進港邊的結局。");
    }
    state.day = finishedDay + 1;
    const weeklyDecision = WEEKLY_DECISION_DAYS.includes(state.day);
    state.phase = weeklyDecision ? "decision" : "prep";
    state.selectedDish = (state.day - 1) % DATA.dishes.length;
    return response(true, weeklyDecision
      ? "第 " + (state.day - 1) + " 夜結束。新的一週開始前，選擇擴大店家、招聘人手、併購攤販，或暫時保留現金。"
      : "新的一晚開始了，港邊又亮起幾盞燈。");
  }

  function restartCampaign() {
    const fresh = freshState();
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
    return response(true, "新的三十夜經營開始了。先備料、排班，再掛燈迎客。");
  }

  return { openDoors, serveDish, resolveComplaint, buyStock, upgradeEquipment, buyUpgrade, toggleStaff, selectDish, chooseStory, chooseWeeklyDecision, nextNight, restartCampaign,
    getEvent: event, getGuests: guests, getStaffCost: () => staffCost(state), getIncome: () => state.ledger ? ledgerIncome(state.ledger) : 0 };
}

function boot() {
  const state = loadState();
  const engine = createGameEngine(state);
  let toastTimer = 0;
  let lastFrame = 0;
  let audioContext = null;
  let soundEnabled = false;
  try { soundEnabled = localStorage.getItem("yelan-sound-enabled") === "true"; } catch {}
  const ui = createUI({ state, saveState });
  const scene = createScene({ state, todayEvent: () => todayEvent(state), getTonightGuests: () => getTonightGuests(state) });
  let orderReturnFocus = null;

  function playTone(kind = "tap") {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      audioContext = audioContext || new AudioContext();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const frequency = kind === "success" ? 660 : (kind === "open" ? 520 : 390);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.17);
    } catch {}
  }

  function syncMotionControl() {
    const button = document.querySelector('[data-action="toggle-pause"]');
    if (!button) return;
    button.disabled = scene.motionReduced;
    button.setAttribute("aria-pressed", String(scene.motionReduced || scene.paused));
    button.textContent = scene.motionReduced ? "低動態：依系統" : (scene.paused ? "▶ 恢復場景" : "Ⅱ 暫停場景");
    button.title = scene.motionReduced ? "已依作業系統減少動態效果" : "暫停或恢復夜市場景動畫";
  }
  function renderUI() { ui.renderUI(); syncMotionControl(); }
  document.addEventListener("scene-motion-change", syncMotionControl);
  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    scene.showToast(message);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }
  function showResult(result, refresh = true) {
    if (result.changed && refresh) renderUI();
    if (result.message) toast(result.message);
    if (result.ok) playTone("success");
  }
  function openDoors() {
    const result = engine.openDoors();
    if (result.ok) { scene.spawnGuests(); ui.setTab("ops"); }
    showResult(result);
  }
  function openOrder(index) {
    if (state.phase !== "service") return;
    const guests = engine.getGuests();
    if (index !== state.customerIndex) { toast("先完成櫃台前這一桌，再招呼後面的客人。"); return; }
    const guest = guests[index];
    if (!guest) return;
    orderReturnFocus = document.activeElement;
    document.getElementById("orderKicker").textContent = guest.difficult ? "CUSTOMER COMPLAINT" : "CUSTOMER AT THE COUNTER";
    document.getElementById("orderTitle").textContent = guest.icon + "　" + guest.name;
    document.getElementById("orderMeta").textContent = guest.role + " · " + guest.needLabel;
    document.getElementById("orderQuote").textContent = "「" + guest.line + "」";
    document.getElementById("orderChoices").replaceChildren(ui.renderOrderChoices(guest));
    document.getElementById("orderModal").hidden = false;
    document.querySelector('[data-action="close-order"]').focus();
    playTone("open");
  }
  function closeOrder() {
    document.getElementById("orderModal").hidden = true;
    const fallback = state.phase === "service"
      ? document.querySelector('[data-action="call-next"]')
      : document.getElementById("mainAction");
    const target = orderReturnFocus && orderReturnFocus.isConnected ? orderReturnFocus : fallback;
    orderReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  }
  function runOrderAction(result) {
    if (result.ok) document.getElementById("orderModal").hidden = true;
    showResult(result);
    if (result.ok) {
      const fallback = state.phase === "service"
        ? document.querySelector('[data-action="call-next"]')
        : document.getElementById("mainAction");
      const target = orderReturnFocus && orderReturnFocus.isConnected ? orderReturnFocus : fallback;
      orderReturnFocus = null;
      if (target && target.focus) requestAnimationFrame(() => target.focus());
    }
  }
  function onSceneClick(event) {
    const rect = scene.canvas.getBoundingClientRect();
    const hit = scene.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (hit && hit.type === "guest") { openOrder(hit.index); return; }
    if (hit && hit.type === "stall") { ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。"); return; }
    toast("夜市巷弄裡，還有鄰攤與往來的人潮。");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "panel-tab") { ui.setTab(button.dataset.tab); renderUI(); }
    if (action === "main-action") {
      if (state.phase === "prep") openDoors();
      else if (state.phase === "service") openOrder(state.customerIndex);
      else if (state.reportChoice) {
        const result = engine.nextNight();
        if (result.ok) { scene.spawnGuests([]); if (state.phase === "decision" || state.phase === "ending") ui.setTab("ops"); }
        showResult(result);
      }
      else { ui.setTab("ops"); renderUI(); }
    }
    if (action === "open-stall") { ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。"); }
    if (action === "open-doors") openDoors();
    if (action === "call-next") openOrder(state.customerIndex);
    if (action === "serve-dish") runOrderAction(engine.serveDish(button.dataset.id));
    if (action === "resolve-complaint") runOrderAction(engine.resolveComplaint(button.dataset.choice));
    if (action === "close-order") closeOrder();
    if (action === "select-dish") showResult(engine.selectDish(button.dataset.index));
    if (action === "buy-stock") showResult(engine.buyStock(button.dataset.id));
    if (action === "upgrade-equipment") showResult(engine.upgradeEquipment(button.dataset.id));
    if (action === "buy-upgrade") showResult(engine.buyUpgrade(button.dataset.id));
    if (action === "toggle-staff") showResult(engine.toggleStaff(button.dataset.role));
    if (action === "choose-story") showResult(engine.chooseStory(button.dataset.id));
    if (action === "next-night") {
      const result = engine.nextNight();
      if (result.ok) { scene.spawnGuests([]); if (state.phase === "decision" || state.phase === "ending") ui.setTab("ops"); }
      showResult(result);
    }
    if (action === "choose-weekly") showResult(engine.chooseWeeklyDecision(button.dataset.id));
    if (action === "restart-campaign") {
      ui.setTab("ops");
      const result = engine.restartCampaign();
      scene.spawnGuests([]);
      showResult(result);
    }
    if (["orbit-left", "orbit-right", "tilt-up", "tilt-down", "zoom-in", "zoom-out", "camera-reset"].includes(action)) scene.cameraAction(action);
    if (action === "toggle-pause") {
      if (scene.motionReduced) { toast("夜市動畫已依系統設定降低動態效果。"); return; }
      const paused = scene.togglePause();
      syncMotionControl();
      toast(paused ? "場景動畫已暫停。" : "場景動畫已恢復。");
    }
    if (action === "toggle-sound") {
      soundEnabled = !soundEnabled;
      try { localStorage.setItem("yelan-sound-enabled", String(soundEnabled)); } catch {}
      button.setAttribute("aria-pressed", String(soundEnabled));
      button.textContent = soundEnabled ? "♫ 音效：開" : "♫ 音效：關";
      toast(soundEnabled ? "輕柔音效已開啟。" : "音效已關閉。");
      if (soundEnabled) playTone("success");
    }
  });

  const orderModal = document.getElementById("orderModal");
  orderModal.addEventListener("click", function(event) { if (event.target === this) closeOrder(); });
  orderModal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(orderModal.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !orderModal.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !orderModal.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("orderModal").hidden) closeOrder();
  });
  scene.canvas.addEventListener("keydown", (event) => {
    const actions = {
      ArrowLeft: "orbit-left", ArrowRight: "orbit-right", ArrowUp: "tilt-up", ArrowDown: "tilt-down",
      "+": "zoom-in", "=": "zoom-in", "-": "zoom-out"
    };
    if (actions[event.key]) {
      event.preventDefault();
      scene.cameraAction(actions[event.key]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (state.phase === "service") openOrder(state.customerIndex);
      else if (state.phase === "prep") {
        ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。");
      }
    }
  });
  document.querySelector(".panel-tabs").addEventListener("keydown", (event) => {
    const tabs = Array.from(document.querySelectorAll(".panel-tab"));
    const current = tabs.indexOf(document.activeElement);
    if (current < 0 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(current + offset + tabs.length) % tabs.length];
    next.focus();
    ui.setTab(next.dataset.tab);
    renderUI();
  });
  scene.canvas.addEventListener("click", onSceneClick);

  function frame(time) {
    const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0.016;
    lastFrame = time;
    if (!document.hidden) { scene.update(dt); scene.draw(); }
    requestAnimationFrame(frame);
  }
  const soundButton = document.querySelector('[data-action="toggle-sound"]');
  if (soundButton) {
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.textContent = soundEnabled ? "♫ 音效：開" : "♫ 音效：關";
  }
  renderUI();
  requestAnimationFrame(frame);
}

if (typeof document !== "undefined") boot();

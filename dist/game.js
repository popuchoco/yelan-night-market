import { captureStateSnapshot, clearSavedProgress, getTonightGuests, loadStateResult, restoreStateSnapshot, saveState, saveStateResult, todayEvent, todayStory } from "./state.js";
import { createScene } from "./scene.js";
import { createUI } from "./ui.js";
import { createGameEngine } from "./engine.js";
import { getDailyCashbookSummary } from "./accounting.js";
import { ACHIEVEMENTS, evaluateAchievements } from "./achievements.js";
import { createAchievementsRenderer } from "./ui/achievements.js";
export { createGameEngine } from "./engine.js";

export function boot() {
  const loadedSave = loadStateResult();
  const state = loadedSave.state;
  const preserveNewerSave = loadedSave.status === "unsupported-version";
  evaluateAchievements(state, { silent: true });
  const persistState = (value) => preserveNewerSave ? false : saveState(value);
  const persistStateDetailed = (value) => preserveNewerSave
    ? { ok: false, reason: "unsupported-version" }
    : saveStateResult(value);
  const engine = createGameEngine(state);
  let toastTimer = 0;
  let achievementToastTimer = 0;
  let lastFrame = 0;
  let audioContext = null;
  let soundEnabled = false;
  try { soundEnabled = localStorage.getItem("yelan-sound-enabled") === "true"; } catch {}
  const ui = createUI({ state, saveState: persistState, saveStateDetailed: persistStateDetailed });
  const achievementsRenderer = createAchievementsRenderer();
  const scene = createScene({ state, todayEvent: () => todayEvent(state), getTonightGuests: () => getTonightGuests(state) });
  const revenueHud = {
    plaque: document.getElementById("revenuePlaque"),
    close: document.getElementById("revenueClose"),
    night: document.getElementById("revenueNight"),
    total: document.getElementById("revenueTotal"),
    income: document.getElementById("revenueIncome"),
    expenses: document.getElementById("revenueExpenses"),
    empty: document.getElementById("revenueEmpty"),
    live: document.getElementById("revenueLive")
  };
  let revenueDismissedDay = null;
  const formatNTD = (value) => "NT$ " + Math.max(0, Math.round(Number(value) || 0)).toLocaleString("zh-TW");
  const formatSignedNTD = (value) => {
    const amount = Math.round(Number(value) || 0);
    return amount > 0 ? "+" + formatNTD(amount) : (amount < 0 ? "−" + formatNTD(Math.abs(amount)) : formatNTD(0));
  };
  function syncCashbookHud() {
    if (!revenueHud.plaque) return;
    if (revenueDismissedDay !== null && revenueDismissedDay !== state.day) revenueDismissedDay = null;
    revenueHud.plaque.hidden = state.phase !== "prep" || revenueDismissedDay === state.day;
    revenueHud.plaque.dataset.phase = state.phase;
    const summary = getDailyCashbookSummary(state, Number(state.day) - 1);
    revenueHud.night.textContent = summary.day > 0 ? "第 " + summary.day + " 夜" : "尚無前夜";
    const values = summary.available ? [
      [revenueHud.total, formatSignedNTD(summary.net)],
      [revenueHud.income, formatNTD(summary.income)],
      [revenueHud.expenses, formatNTD(summary.expenses)]
    ] : [
      [revenueHud.total, "—"],
      [revenueHud.income, "—"],
      [revenueHud.expenses, "—"]
    ];
    values.forEach(([node, value]) => { if (node && node.textContent !== value) node.textContent = value; });
    revenueHud.empty.hidden = summary.available;
    revenueHud.total.dataset.tone = summary.net > 0 ? "positive" : (summary.net < 0 ? "negative" : "neutral");
    const announcements = scene.drainRevenueAnnouncements();
    if (announcements.length && revenueHud.live) revenueHud.live.textContent = announcements.join(" ");
  }
  if (revenueHud.close) {
    revenueHud.close.addEventListener("click", () => {
      revenueDismissedDay = state.day;
      revenueHud.plaque.hidden = true;
    });
  }
  let orderReturnFocus = null;
  let reportReturnFocus = null;

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
    const label = scene.motionReduced ? "動畫暫停控制受系統低動態設定限制" : (scene.paused ? "恢復場景動畫" : "暫停場景動畫");
    button.setAttribute("aria-label", label);
    button.title = scene.motionReduced ? "已依作業系統減少動態效果" : label;
    button.querySelector("#pauseIcon").textContent = scene.paused ? "▶" : "Ⅱ";
  }
  function syncAchievementTrigger() {
    const trigger = document.getElementById("achievementTrigger");
    const badge = document.getElementById("achievementNewBadge");
    if (!trigger || !badge) return;
    const pending = Array.isArray(state.achievements?.pending) ? state.achievements.pending.length : 0;
    badge.hidden = pending === 0;
    trigger.setAttribute("aria-label", pending ? "港邊里程碑，有新成就待查看" : "港邊里程碑，查看成就一覽");
  }
  function renderAchievementList(focusCategory = null) {
    achievementsContent.replaceChildren(achievementsRenderer.render(state));
    if (focusCategory) {
      const target = achievementsContent.querySelector('[data-action="achievement-filter"][data-category="' + focusCategory + '"]');
      if (target) target.focus();
    }
  }
  function renderUI() { ui.renderUI(); syncMotionControl(); syncWorldEventTrigger(); syncOutletEventTriggers(); syncAchievementTrigger(); }
  const reportDialog = document.getElementById("reportDialog");
  const reportDialogContent = document.getElementById("reportDialogContent");
  const worldEventDialog = document.getElementById("worldEventDialog");
  const worldEventDialogContent = document.getElementById("worldEventDialogContent");
  const storyChoiceDialog = document.getElementById("storyChoiceDialog");
  const storyChoiceContent = document.getElementById("storyChoiceContent");
  const gameGuideDialog = document.getElementById("gameGuideDialog");
  const restartConfirmDialog = document.getElementById("restartConfirmDialog");
  const achievementsDialog = document.getElementById("achievementsDialog");
  const achievementsContent = document.getElementById("achievementsContent");
  let gameGuideReturnFocus = null;
  let restartReturnFocus = null;
  let achievementsReturnFocus = null;
  let worldEventReturnFocus = null;
  let storyChoiceReturnFocus = null;
  let worldEventPosition = "";
  const cameraCollapseButton = document.getElementById("cameraCollapse");
  function setCameraToolsExpanded(expanded) {
    document.querySelector(".world-frame").classList.toggle("camera-collapsed", !expanded);
    cameraCollapseButton.setAttribute("aria-expanded", String(expanded));
    cameraCollapseButton.setAttribute("aria-label", expanded ? "收合相機控制" : "展開相機控制");
    cameraCollapseButton.title = expanded ? "收合相機控制" : "展開相機控制";
    cameraCollapseButton.querySelector("span").textContent = expanded ? "−" : "+";
  }
  const outletEventButtons = new Map();
  function syncWorldEventTrigger() {
    const trigger = document.getElementById("worldEventTrigger");
    const info = ui.getWorldEventInfo();
    if (!trigger || !info) return;
    document.getElementById("worldEventIcon").textContent = info.icon || "⚑";
    document.getElementById("worldEventLabel").textContent = info.label;
    document.getElementById("worldEventTitle").textContent = info.title;
    trigger.dataset.tone = info.tone || "positive";
    trigger.dataset.pending = String(!!info.pending);
    trigger.dataset.outletId = info.anchorOutletId || "main";
    trigger.setAttribute("aria-label", (info.pending ? "待處理：" : "查看：") +
      (info.anchorOutletName ? info.anchorOutletName + "・" : "") + info.title + "。開啟夜市事件視窗");
    const point = scene.eventAnchor(info.anchorOutletId);
    const frame = document.querySelector(".world-frame");
    if (!point || !frame) return;
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = scene.canvas.getBoundingClientRect();
    const halfWidth = (trigger.offsetWidth || 216) / 2;
    const rawX = canvasRect.left - frameRect.left + point.x;
    const rawY = canvasRect.top - frameRect.top + point.y;
    const left = Math.max(halfWidth + 9, Math.min(frame.clientWidth - halfWidth - 9, rawX));
    const top = Math.max(86, Math.min(frame.clientHeight - 104, rawY));
    const position = Math.round(left) + "px|" + Math.round(top) + "px";
    if (position !== worldEventPosition) {
      trigger.style.left = Math.round(left) + "px";
      trigger.style.top = Math.round(top) + "px";
      worldEventPosition = position;
    }
  }
  function syncOutletEventTriggers(updateCopy = false) {
    const container = document.getElementById("outletEventTriggers");
    if (!container) return;
    const events = ui.getOutletWorldEvents();
    const activeIds = new Set(events.map((item) => item.id));
    outletEventButtons.forEach((button, id) => {
      if (!activeIds.has(id)) { button.remove(); outletEventButtons.delete(id); }
    });
    const frame = document.querySelector(".world-frame");
    if (!frame) return;
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = scene.canvas.getBoundingClientRect();
    const occupied = [];
    events.forEach((info) => {
      let button = outletEventButtons.get(info.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "outlet-event-trigger";
        button.dataset.action = "open-outlet-event";
        button.dataset.eventId = info.id;
        button.dataset.outletId = info.outletId;
        button.setAttribute("aria-haspopup", info.kind === "manager" ? "dialog" : "false");
        button.replaceChildren();
        const icon = document.createElement("span");
        icon.className = "outlet-event-icon";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "outlet-event-copy";
        const name = document.createElement("strong");
        const title = document.createElement("span");
        label.append(name, title);
        button.append(icon, label);
        container.append(button);
        outletEventButtons.set(info.id, button);
      }
      const outletName = (state.outlets || []).find((outlet) => outlet.id === info.outletId)?.name || "分店";
      const copyKey = [info.tone, info.kind, info.icon, info.label, info.title, info.description, outletName].join("|");
      if (updateCopy || button.dataset.copyKey !== copyKey) {
        button.dataset.tone = info.tone;
        button.dataset.kind = info.kind;
        button.dataset.copyKey = copyKey;
        button.setAttribute("aria-label", info.label + "・" + info.title + "。" + info.description);
        button.querySelector(".outlet-event-icon").textContent = info.icon;
        button.querySelector(".outlet-event-copy strong").textContent = info.label + "｜" + outletName;
        button.querySelector(".outlet-event-copy span").textContent = info.title;
      }
      const point = scene.eventAnchor(info.outletId);
      const width = button.offsetWidth || 192;
      const halfWidth = width / 2;
      const rawX = canvasRect.left - frameRect.left + point.x;
      const rawY = canvasRect.top - frameRect.top + point.y;
      const left = Math.max(halfWidth + 8, Math.min(frame.clientWidth - halfWidth - 8, rawX));
      const top = Math.max(116, Math.min(frame.clientHeight - 108, rawY));
      let placedTop = top;
      while (occupied.some((rect) => Math.abs(rect.left - left) < width * 0.72 && Math.abs(rect.top - placedTop) < 50) && placedTop < frame.clientHeight - 110) {
        placedTop = Math.min(frame.clientHeight - 108, placedTop + 48);
        if (placedTop === frame.clientHeight - 108) break;
      }
      occupied.push({ left, top: placedTop });
      const leftStyle = Math.round(left) + "px";
      const topStyle = Math.round(placedTop) + "px";
      if (button.style.left !== leftStyle) button.style.left = leftStyle;
      if (button.style.top !== topStyle) button.style.top = topStyle;
    });
  }
  function openWorldEvent(outletId) {
    const incident = state.managerEvent && state.managerEvent.outletId === outletId ? state.managerEvent : null;
    const info = incident ? { kind: "manager", icon: "⚠️", label: "分店重大事件", title: incident.title, description: incident.description } : ui.getWorldEventInfo();
    if (info.kind === "complaint") { openOrder(state.customerIndex); return; }
    worldEventReturnFocus = (outletId && outletEventButtons.get("manager:" + outletId)) || document.activeElement;
    document.getElementById("worldEventDialogKicker").textContent = info.label;
    document.getElementById("worldEventDialogTitle").textContent = info.title;
    document.getElementById("worldEventDialogDescription").textContent = info.description;
    worldEventDialogContent.replaceChildren(ui.renderWorldEventContent());
    if (!worldEventDialog.open) worldEventDialog.showModal();
    const firstAction = worldEventDialogContent.querySelector("button:not(:disabled)");
    const focusTarget = firstAction || worldEventDialog.querySelector('[data-action="close-world-event"]');
    if (focusTarget) focusTarget.focus();
    playTone("open");
  }
  function openStoryChoice() {
    if (state.phase !== "report" || state.reportChoice || storyChoiceDialog.open) return;
    storyChoiceReturnFocus = document.activeElement;
    const story = todayStory(state);
    const card = document.createElement("section");
    card.className = "story-choice-card";
    const title = document.createElement("h3");
    title.textContent = story.title;
    const description = document.createElement("p");
    description.textContent = story.story;
    card.append(title, description);

    const options = document.createElement("div");
    options.className = "story-choice-options";
    const choices = [
      { id: "paperboat", icon: "紙", name: "把紙船放回港灣", detail: "留下一份溫柔的心意，讓夜市口碑增加。", effect: "+2 口碑" },
      { id: "window", icon: "桌", name: "替熟客留桌", detail: "照顧常來的熟面孔，增加熟客並收到心意金。", effect: "+NT$ 80・熟客 +1" }
    ];
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "story-choice-option";
      button.dataset.action = "choose-story";
      button.dataset.id = choice.id;
      const icon = document.createElement("span");
      icon.className = "story-choice-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = choice.icon;
      const copy = document.createElement("span");
      copy.className = "story-choice-copy";
      const name = document.createElement("span");
      name.className = "story-choice-name";
      name.textContent = choice.name;
      const detail = document.createElement("span");
      detail.className = "story-choice-detail";
      detail.textContent = choice.detail;
      copy.append(name, detail);
      const effect = document.createElement("span");
      effect.className = "story-choice-effect";
      effect.textContent = choice.effect;
      button.append(icon, copy, effect);
      options.append(button);
    });
    const note = document.createElement("p");
    note.className = "story-choice-note";
    note.textContent = "選擇後會自動把本夜手記歸檔，並進入明晚；每 7 夜則會接著出現本週經營決策。";
    storyChoiceContent.replaceChildren(card, options, note);
    storyChoiceDialog.showModal();
    const firstChoice = storyChoiceContent.querySelector('[data-action="choose-story"]');
    if (firstChoice) firstChoice.focus();
    playTone("open");
  }
  function showClosingFinancialNotices() {
    const closingEvents = state.journal?.[0]?.closingEvents || [];
    closingEvents.forEach((item) => {
      const value = Math.max(0, Math.round(Number(item.amount) || 0));
      if (!value) return;
      if (item.kind === "counterfeit" || item.kind === "undercharge") {
        scene.showRevenueNotice(-value, "昨夜・收銀短溢損失");
      } else if (item.kind === "cash-over") {
        scene.showRevenueNotice(value, "昨夜・收銀盤盈（其他收入）");
      } else if (item.kind === "customer-overcharge") {
        scene.showRevenueNotice(-value, "昨夜・顧客退款／銷貨折讓");
      } else if (item.kind === "secret-inspection") {
        scene.showRevenueNotice(item.outcome === "pass" ? value : -value,
          item.outcome === "pass" ? "昨夜・衛生稽查獎勵（其他收入）" : "昨夜・衛生整改費");
      }
    });
  }
  function advanceNight() {
    const result = engine.nextNight();
    if (result.ok) {
      scene.spawnGuests([]);
      if (state.phase === "decision") ui.setTab("ops");
      showClosingFinancialNotices();
    }
    showResult(result);
  }
  function chooseStoryFromDialog(id) {
    const choiceResult = engine.chooseStory(id);
    if (!choiceResult.ok) { showResult(choiceResult); return; }
    const nextResult = engine.nextNight();
    if (nextResult.ok) {
      scene.spawnGuests([]);
      if (state.phase === "decision") ui.setTab("ops");
      if (id === "window") scene.showRevenueNotice(80, "昨夜・熟客心意收入");
      showClosingFinancialNotices();
    }
    if (storyChoiceDialog.open) storyChoiceDialog.close();
    showResult({ ok: nextResult.ok, changed: nextResult.changed, message: choiceResult.message + " " + nextResult.message });
  }
  function renderReportDialogContent(focusAction, focusId, resetScroll = false) {
    const previousScroll = resetScroll ? 0 : reportDialogContent.scrollTop;
    reportDialogContent.replaceChildren(ui.renderJournalReport());
    reportDialogContent.scrollTop = previousScroll;
    if (focusAction) {
      const control = Array.from(reportDialogContent.querySelectorAll('[data-action="' + focusAction + '"]'))
        .find((item) => !focusId || item.dataset.id === focusId);
      if (control) control.focus();
    }
  }
  function openJournalReport(id) {
    reportReturnFocus = document.activeElement;
    const journalWasViewed = state.achievements.viewedJournal;
    engine.markJournalViewed();
    const unlockedAchievements = engine.drainAchievementAwards();
    ui.setJournalView(id);
    if (id === "monthly" && (state.accounting?.monthlyReports || []).length) {
      engine.markStatementViewed("income");
      unlockedAchievements.push(...engine.drainAchievementAwards());
    }
    const report = ui.getJournalReportInfo();
    document.getElementById("reportDialogTitle").textContent = report.title;
    document.getElementById("reportDialogDescription").textContent = report.description;
    renderReportDialogContent();
    if (!reportDialog.open) reportDialog.showModal();
    reportDialog.querySelector('[data-action="close-report"]').focus();
    if (!journalWasViewed || unlockedAchievements.length) renderUI();
    if (unlockedAchievements.length) showAchievementToast(unlockedAchievements);
    playTone("open");
  }
  reportDialog.addEventListener("click", (event) => {
    if (event.target === reportDialog) reportDialog.close();
  });
  reportDialog.addEventListener("close", () => {
    const fallback = document.getElementById("tab-journal");
    const target = reportReturnFocus && reportReturnFocus.isConnected ? reportReturnFocus : fallback;
    reportReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  });
  worldEventDialog.addEventListener("click", (event) => {
    if (event.target === worldEventDialog) worldEventDialog.close();
  });
  worldEventDialog.addEventListener("close", () => {
    const fallback = document.getElementById("worldEventTrigger");
    const target = worldEventReturnFocus && worldEventReturnFocus.isConnected ? worldEventReturnFocus : fallback;
    worldEventReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => {
      const focusTarget = target.isConnected ? target : (fallback && fallback.isConnected ? fallback : document.getElementById("tab-stall"));
      if (focusTarget && focusTarget.focus) focusTarget.focus();
    });
  });
  storyChoiceDialog.addEventListener("click", (event) => {
    if (event.target === storyChoiceDialog) storyChoiceDialog.close();
  });
  storyChoiceDialog.addEventListener("close", () => {
    const fallback = document.getElementById("mainAction");
    const target = storyChoiceReturnFocus && storyChoiceReturnFocus.isConnected ? storyChoiceReturnFocus : fallback;
    storyChoiceReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  });
  gameGuideDialog.addEventListener("click", (event) => {
    if (event.target === gameGuideDialog) gameGuideDialog.close();
  });
  gameGuideDialog.addEventListener("close", () => {
    const fallback = document.querySelector(".game-guide-trigger");
    const target = gameGuideReturnFocus && gameGuideReturnFocus.isConnected ? gameGuideReturnFocus : fallback;
    gameGuideReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  });
  restartConfirmDialog.addEventListener("click", (event) => {
    if (event.target === restartConfirmDialog) restartConfirmDialog.close();
  });
  restartConfirmDialog.addEventListener("close", () => {
    const fallback = document.querySelector('[data-action="request-restart-campaign"]')
      || document.querySelector(".game-guide-trigger");
    const target = restartReturnFocus && restartReturnFocus.isConnected ? restartReturnFocus : fallback;
    restartReturnFocus = null;
    if (target && target.focus && gameGuideDialog.open) requestAnimationFrame(() => target.focus());
  });
  achievementsDialog.addEventListener("click", (event) => {
    if (event.target === achievementsDialog) achievementsDialog.close();
  });
  achievementsDialog.addEventListener("close", () => {
    const fallback = document.getElementById("achievementTrigger");
    const target = achievementsReturnFocus && achievementsReturnFocus.isConnected ? achievementsReturnFocus : fallback;
    achievementsReturnFocus = null;
    if (target && target.focus) requestAnimationFrame(() => target.focus());
  });
  function openAchievements(trigger) {
    achievementsReturnFocus = trigger && trigger.isConnected ? trigger : document.getElementById("achievementTrigger");
    renderAchievementList();
    if (!achievementsDialog.open) achievementsDialog.showModal();
    engine.markAchievementListSeen();
    renderUI();
    achievementsDialog.querySelector('[data-action="close-achievements"]').focus();
    playTone("open");
  }
  document.addEventListener("scene-motion-change", syncMotionControl);
  function syncToastPosition() {
    const frame = document.querySelector(".world-frame");
    const actions = document.querySelector(".world-actions");
    if (!frame || !actions) return;
    const actionBottom = Number.parseFloat(getComputedStyle(actions).bottom) || 0;
    frame.style.setProperty("--world-toast-offset", Math.ceil(actions.offsetHeight + actionBottom + 10) + "px");
  }
  const worldActions = document.querySelector(".world-actions");
  if (worldActions && typeof ResizeObserver !== "undefined") new ResizeObserver(syncToastPosition).observe(worldActions);
  window.addEventListener("resize", syncToastPosition, { passive: true });
  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }
  function showAchievementToast(ids) {
    const id = Array.isArray(ids) ? ids[0] : ids;
    const achievement = ACHIEVEMENTS.find((item) => item.id === id);
    if (!achievement) return;
    const popup = document.getElementById("achievementToast");
    document.getElementById("achievementToastTitle").textContent = achievement.title;
    document.getElementById("achievementLive").textContent = "里程碑解鎖：" + achievement.title;
    popup.hidden = false;
    requestAnimationFrame(() => popup.classList.add("show"));
    clearTimeout(achievementToastTimer);
    achievementToastTimer = setTimeout(() => {
      popup.classList.remove("show");
      achievementToastTimer = setTimeout(() => { popup.hidden = true; }, 240);
    }, 3800);
  }
  function showResult(result, refresh = true) {
    const unlockedAchievements = engine.drainAchievementAwards();
    if (result.changed && refresh) renderUI();
    if (result.message) toast(result.message);
    if (result.ok) playTone("success");
    if (unlockedAchievements.length) {
      syncAchievementTrigger();
      showAchievementToast(unlockedAchievements);
    }
  }
  function openDoors() {
    const result = engine.openDoors();
    if (result.ok) { scene.spawnGuests(); ui.setTab("ops"); }
    showResult(result);
  }
  function openOrder(index) {
    if (state.phase !== "service") return;
    if (state.safetyIncident?.status === "pending") { openWorldEvent(); return; }
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
    if (hit && hit.type === "outlet-event") {
      if (hit.kind === "manager") openWorldEvent(hit.outletId);
      else openOutletManagement(hit.outletId);
      return;
    }
    if (hit && hit.type === "stall") {
      const info = ui.getWorldEventInfo();
      if (info.pending && info.anchorOutletId === "main") { openWorldEvent(); return; }
      ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。"); return;
    }
    if (hit && hit.type === "outlet") {
      if (state.managerEvent && state.managerEvent.outletId === hit.outletId) { openWorldEvent(hit.outletId); return; }
      openOutletManagement(hit.outletId, hit.outletName);
      return;
    }
    toast("夜市巷弄裡，還有鄰攤與往來的人潮。");
  }

  function openOutletManagement(outletId, outletName) {
    ui.setOutletTarget(outletId);
    ui.setTab("stall");
    renderUI();
    const card = document.getElementById("outlet-card-" + outletId);
    if (card) { card.focus({ preventScroll: true }); card.scrollIntoView({ block: "nearest" }); }
    toast((outletName || (state.outlets || []).find((item) => item.id === outletId)?.name || "分店") + "管理已開啟：可在這裡補貨、升級或查看店長營運。");
  }

  const transactionalActions = new Set([
    "main-action", "open-doors", "serve-dish", "resolve-complaint", "select-dish", "buy-stock",
    "buy-outlet-stock", "toggle-outlet", "upgrade-outlet-equipment", "upgrade-outlet-safety",
    "upgrade-stall-tier", "toggle-accident-coverage", "release-crew-member", "hire-outlet-manager",
    "dismiss-outlet-manager", "resolve-manager-event", "resolve-safety-incident", "upgrade-equipment",
    "buy-upgrade", "toggle-staff", "choose-story", "choose-market-card", "next-night", "choose-weekly",
    "borrow-loan", "repay-loan"
  ]);
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    let snapshot = null;
    try {
      if (transactionalActions.has(action)) snapshot = captureStateSnapshot(state);
    } catch (error) {
      console.error("Unable to snapshot game state before action", action, error);
      toast("夜市資料暫時無法安全操作，請重新整理後再試。");
      return;
    }
    try {
    if (action === "open-game-guide" && !gameGuideDialog.open) {
      gameGuideReturnFocus = button;
      gameGuideDialog.showModal();
      gameGuideDialog.querySelector('[data-action="close-game-guide"]').focus();
      playTone("open");
    }
    if (action === "close-game-guide" && gameGuideDialog.open) gameGuideDialog.close();
    if (action === "request-restart-campaign") {
      restartReturnFocus = button;
      if (!restartConfirmDialog.open) {
        restartConfirmDialog.showModal();
        const confirmButton = restartConfirmDialog.querySelector('[data-action="confirm-restart-campaign"]');
        if (confirmButton) confirmButton.focus();
        playTone("open");
      }
    }
    if (action === "close-restart-confirm" && restartConfirmDialog.open) restartConfirmDialog.close();
    if (action === "open-achievements") openAchievements(button);
    if (action === "close-achievements" && achievementsDialog.open) achievementsDialog.close();
    if (action === "achievement-filter") {
      achievementsRenderer.setCategory(button.dataset.category);
      renderAchievementList(button.dataset.category);
    }
    if (action === "dismiss-achievement-toast") {
      const popup = document.getElementById("achievementToast");
      popup.classList.remove("show");
      clearTimeout(achievementToastTimer);
      achievementToastTimer = setTimeout(() => { popup.hidden = true; }, 240);
    }
    if (action === "toggle-camera-tools") {
      const expanded = button.getAttribute("aria-expanded") !== "true";
      setCameraToolsExpanded(expanded);
    }
    if (action === "toggle-world-ui") {
      const hidden = document.querySelector(".world-frame").classList.toggle("world-ui-hidden");
      button.setAttribute("aria-pressed", String(hidden));
      button.setAttribute("aria-label", hidden ? "顯示場景按鈕與說明" : "隱藏場景按鈕與說明");
      button.title = hidden ? "顯示場景按鈕與說明" : "隱藏場景按鈕與說明";
      const canvas = document.getElementById("worldCanvas");
      if (hidden) canvas.removeAttribute("aria-describedby");
      else canvas.setAttribute("aria-describedby", "sceneHelp");
    }
    if (action === "open-world-event") openWorldEvent();
    if (action === "close-story-choice" && storyChoiceDialog.open) storyChoiceDialog.close();
    if (action === "open-outlet-event") {
      const outletId = button.dataset.outletId;
      const eventInfo = ui.getOutletWorldEvents().find((item) => item.id === button.dataset.eventId);
      if (eventInfo?.kind === "manager") openWorldEvent(outletId);
      else openOutletManagement(outletId);
    }
    if (action === "close-world-event" && worldEventDialog.open) worldEventDialog.close();
    if (action === "panel-tab") {
      ui.setTab(button.dataset.tab);
      if (button.dataset.tab === "journal") engine.markJournalViewed();
      const unlockedAchievements = engine.drainAchievementAwards();
      renderUI();
      if (unlockedAchievements.length) showAchievementToast(unlockedAchievements);
    }
    if (action === "open-report") openJournalReport(button.dataset.id);
    if (action === "close-report" && reportDialog.open) reportDialog.close();
    if (action === "statement-view") {
      ui.setStatementView(button.dataset.id);
      const alreadyViewed = state.achievements.viewedStatements.includes(button.dataset.id);
      engine.markStatementViewed(button.dataset.id);
      const unlockedAchievements = engine.drainAchievementAwards();
      if (!alreadyViewed && (state.accounting?.monthlyReports || []).length) renderUI();
      if (reportDialog.open) renderReportDialogContent("statement-view", button.dataset.id, true);
      if (unlockedAchievements.length) showAchievementToast(unlockedAchievements);
    }
    if (action === "main-action") {
      if (state.phase === "prep") openDoors();
      else if (state.phase === "service" && state.safetyIncident?.status === "pending") openWorldEvent();
      else if (state.phase === "service") openOrder(state.customerIndex);
      else if (state.phase === "report" && state.reportChoice) advanceNight();
      else if (state.phase === "report") openStoryChoice();
      else { ui.setTab("ops"); renderUI(); }
    }
    if (action === "open-stall") { ui.setTab("stall"); renderUI(); toast("攤位工作台已開啟：備料、設備與班表都在這裡。"); }
    if (action === "open-main-stock") { ui.setTab("stock"); renderUI(); toast("主店備料與菜單已開啟；分店可在攤位工作台逐間補貨。"); }
    if (action === "open-doors") openDoors();
    if (action === "call-next") openOrder(state.customerIndex);
    if (action === "serve-dish") runOrderAction(engine.serveDish(button.dataset.id));
    if (action === "resolve-complaint") runOrderAction(engine.resolveComplaint(button.dataset.choice));
    if (action === "close-order") closeOrder();
    if (action === "select-dish") showResult(engine.selectDish(button.dataset.index));
    if (action === "buy-stock") showResult(engine.buyStock(button.dataset.id));
    if (action === "buy-outlet-stock") showResult(engine.buyOutletStock(button.dataset.outletId, button.dataset.stockId));
    if (action === "toggle-outlet") showResult(engine.toggleOutlet(button.dataset.outletId));
    if (action === "upgrade-outlet-equipment") showResult(engine.upgradeOutletEquipment(button.dataset.outletId));
    if (action === "upgrade-outlet-safety") showResult(engine.upgradeOutletSafety(button.dataset.outletId, button.dataset.equipmentId));
    if (action === "upgrade-stall-tier") showResult(engine.upgradeStallTier(button.dataset.outletId));
    if (action === "toggle-accident-coverage") showResult(engine.toggleAccidentCoverage(button.dataset.outletId));
    if (action === "release-crew-member") showResult(engine.releaseCrewMember());
    if (action === "hire-outlet-manager") showResult(engine.hireOutletManager(button.dataset.outletId));
    if (action === "dismiss-outlet-manager") showResult(engine.dismissOutletManager(button.dataset.outletId));
    if (action === "resolve-manager-event") {
      const result = engine.resolveManagerEvent(button.dataset.choice);
      if (result.ok && worldEventDialog.open) worldEventDialog.close();
      showResult(result);
    }
    if (action === "resolve-safety-incident") {
      const result = engine.resolveSafetyIncident(button.dataset.choice);
      if (result.ok && worldEventDialog.open) worldEventDialog.close();
      showResult(result);
    }
    if (action === "upgrade-equipment") showResult(engine.upgradeEquipment(button.dataset.id));
    if (action === "buy-upgrade") showResult(engine.buyUpgrade(button.dataset.id));
    if (action === "toggle-staff") showResult(engine.toggleStaff(button.dataset.role));
    if (action === "choose-story") {
      if (storyChoiceDialog.open && button.closest("#storyChoiceContent")) chooseStoryFromDialog(button.dataset.id);
      else showResult(engine.chooseStory(button.dataset.id));
    }
    if (action === "choose-market-card") {
      const result = engine.chooseMarketCard(button.dataset.id);
      if (result.ok && worldEventDialog.open) worldEventDialog.close();
      showResult(result);
    }
    if (action === "next-night") {
      advanceNight();
    }
    if (action === "choose-weekly") showResult(engine.chooseWeeklyDecision(button.dataset.id, button.dataset.targetType));
    if (action === "borrow-loan") showResult(engine.borrowWorkingCapital());
    if (action === "repay-loan") showResult(engine.repayWorkingCapital());
    if (action === "confirm-restart-campaign") {
      if (restartConfirmDialog.open) restartConfirmDialog.close();
      if (gameGuideDialog.open) gameGuideDialog.close();
      // Keep a save from a newer build untouched; only this in-memory world resets.
      const clearResult = clearSavedProgress(undefined, { preserveNewerSave });
      ui.setTab("ops");
      const result = engine.restartCampaign();
      scene.spawnGuests([]);
      renderUI();
      if (preserveNewerSave) {
        toast("記憶中的夜市已重啟；較新版本存檔仍保留且未覆寫。");
      } else if (!clearResult?.ok || document.getElementById("saveLabel").textContent !== "進度已儲存") {
        toast("夜市已重啟，但本機進度或舊備份未能完整清除／儲存。");
      } else {
        toast("新世界已開張");
      }
      if (result.ok) playTone("success");
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
      button.setAttribute("aria-label", soundEnabled ? "關閉音效" : "開啟音效");
      button.title = soundEnabled ? "關閉音效" : "開啟音效";
      button.querySelector("span").textContent = soundEnabled ? "♫" : "♪";
      toast(soundEnabled ? "輕柔音效已開啟。" : "音效已關閉。");
      if (soundEnabled) playTone("success");
    }
    } catch (error) {
      console.error("Game action failed", action, error);
      if (snapshot) {
        try {
          restoreStateSnapshot(state, snapshot);
          persistStateDetailed(state);
          renderUI();
        } catch (rollbackError) {
          console.error("Game action rollback failed", action, rollbackError);
        }
      }
      toast("操作沒有完成，夜市資料已復原；請再試一次。");
    }
  });

  document.addEventListener("change", (event) => {
    const control = event.target.closest('select[data-action]');
    if (!control) return;
    if (control.dataset.action === "diary-day" || control.dataset.action === "report-period" || control.dataset.action === "week-report") {
      ui.setJournalFilter(control.dataset.action, control.value);
      if (reportDialog.open) renderReportDialogContent(control.dataset.action);
      else renderUI();
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
    if (next.dataset.tab === "journal") engine.markJournalViewed();
    const unlockedAchievements = engine.drainAchievementAwards();
    renderUI();
    if (unlockedAchievements.length) showAchievementToast(unlockedAchievements);
  });
  scene.canvas.addEventListener("click", onSceneClick);

  function frame(time) {
    const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0.016;
    lastFrame = time;
    if (!document.hidden) { scene.update(dt); scene.draw(); syncCashbookHud(); syncWorldEventTrigger(); syncOutletEventTriggers(); }
    requestAnimationFrame(frame);
  }
  const soundButton = document.querySelector('[data-action="toggle-sound"]');
  if (soundButton) {
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.setAttribute("aria-label", soundEnabled ? "關閉音效" : "開啟音效");
    soundButton.title = soundEnabled ? "關閉音效" : "開啟音效";
    soundButton.querySelector("span").textContent = soundEnabled ? "♫" : "♪";
  }
  syncToastPosition();
  renderUI();
  syncCashbookHud();
  if (loadedSave.status === "corrupt") {
    document.getElementById("saveLabel").textContent = "存檔異常・已保留備份";
    toast("原存檔無法讀取；已保留備份並以新進度開啟夜市。");
  } else if (loadedSave.status === "migrated") {
    toast("舊版進度已升級為目前存檔格式。");
  } else if (loadedSave.status === "unsupported-version") {
    toast("這份存檔由較新版建立；目前先保留原檔，不會覆寫。");
  } else if (loadedSave.status === "unavailable") {
    toast("瀏覽器目前無法使用本機儲存，這次進度無法存檔。");
  }
  requestAnimationFrame(frame);
}

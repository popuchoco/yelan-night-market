import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS } from "../achievements.js";

const CATEGORY_LABELS = Object.fromEntries(ACHIEVEMENT_CATEGORIES.map((category) => [category.id, category.label]));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function createAchievementsRenderer() {
  let activeCategory = "all";

  function setCategory(category) {
    if (ACHIEVEMENT_CATEGORIES.some((item) => item.id === category)) activeCategory = category;
  }

  function render(state) {
    const achievements = state?.achievements || { unlocked: {}, pending: [] };
    const unlocked = achievements.unlocked || {};
    const count = ACHIEVEMENTS.reduce((total, item) => total + (unlocked[item.id] ? 1 : 0), 0);
    const root = element("div", "achievement-browser");
    const summary = element("div", "achievement-summary");
    const progress = element("p", "achievement-progress");
    progress.append(element("strong", "", count), element("span", "", "／" + ACHIEVEMENTS.length + " 項已記下"));
    const note = element("p", "achievement-guidance", "里程碑記錄你走過的路，不會提供現金或改變營運數值。重啟世界時會一併清空。");
    summary.append(progress, note);

    const filters = element("div", "achievement-filters");
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "篩選里程碑分類");
    ACHIEVEMENT_CATEGORIES.forEach((category) => {
      const button = element("button", "achievement-filter", category.label);
      button.type = "button";
      button.dataset.action = "achievement-filter";
      button.dataset.category = category.id;
      button.setAttribute("aria-pressed", String(activeCategory === category.id));
      filters.append(button);
    });

    const entries = ACHIEVEMENTS.filter((item) => activeCategory === "all" || item.category === activeCategory);
    const list = element("ul", "achievement-list");
    list.setAttribute("aria-label", (CATEGORY_LABELS[activeCategory] || "全部") + "里程碑");
    entries.forEach((item) => {
      const record = unlocked[item.id];
      const isUnlocked = !!record;
      const isHidden = !!item.secret && !isUnlocked;
      const card = element("li", "achievement-card " + (isUnlocked ? "is-unlocked" : "is-locked"));
      card.dataset.achievementId = item.id;
      card.setAttribute("aria-label", (isUnlocked ? "已解鎖：" : "尚未解鎖：") + (isHidden ? "尚未記載" : item.title));

      const mark = element("span", "achievement-mark", isHidden ? "？" : item.icon);
      mark.setAttribute("aria-hidden", "true");
      const copy = element("div", "achievement-copy");
      const eyebrow = element("span", "achievement-category", isUnlocked ? CATEGORY_LABELS[item.category] : "尚待記錄");
      const title = element("h3", "achievement-title", isHidden ? "？？？" : item.title);
      const description = element("p", "achievement-description", isHidden ? "尚未記載的港邊故事。" : (isUnlocked ? item.description : item.hint));
      copy.append(eyebrow, title, description);

      const status = element("span", "achievement-status", isUnlocked ? "已記下" : "未解鎖");
      if (isUnlocked) {
        const day = Number(record.day) || 0;
        const period = Number(record.period) || 0;
        const date = element("span", "achievement-date", day ? "第 " + day + " 夜・第 " + period + " 期" : "舊手記補登");
        const stamp = element("div", "achievement-stamp");
        stamp.append(status, date);
        card.append(mark, copy, stamp);
      } else {
        card.append(mark, copy, status);
      }
      list.append(card);
    });
    root.append(summary, filters, list);
    return root;
  }

  return { render, setCategory, getCategory: () => activeCategory };
}


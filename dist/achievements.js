import { DATA } from "./data.js";
import { ACQUISITION_TYPES, campaignEntry } from "./campaign.js";

export const ACHIEVEMENT_CATEGORIES = Object.freeze([
  { id: "all", label: "全部" },
  { id: "growth", label: "成長" },
  { id: "operations", label: "營運" },
  { id: "risk", label: "職安與食安" },
  { id: "branches", label: "分店" },
  { id: "menu", label: "菜單" },
  { id: "story", label: "故事" },
  { id: "accounting", label: "帳務" }
]);

export const ACHIEVEMENTS = Object.freeze([
  { id: "first_open", category: "growth", icon: "🏮", title: "第一夜掛燈", description: "第一次把攤燈點亮，迎接港邊的客人。", hint: "先完成一夜營業。" },
  { id: "tier_fixed", category: "growth", icon: "🪵", title: "從流動到固定", description: "主店整修升級為固定攤販，替常來的人留下一處熟悉的座位。", hint: "按順序完成主店攤型整修升級。" },
  { id: "tier_dapaidang", category: "growth", icon: "🛖", title: "大排檔燈火", description: "主店成為大排檔，夜裡多了一排能坐下來的桌。", hint: "把主店安全升級至大排檔。" },
  { id: "expand_once", category: "growth", icon: "🪑", title: "多擺一張桌", description: "第一次擴出桌區，讓巷口也有地方慢慢吃飯。", hint: "在週決策擴大店家一次。" },
  { id: "expand_thrice", category: "growth", icon: "🧭", title: "巷口也認得你的燈", description: "完成三次擴店，夜市的熟悉範圍又往外延伸。", hint: "逐步擴店，留意後續固定成本。" },
  { id: "week_one", category: "operations", icon: "📆", title: "撐過第一週", description: "完成七夜營業，並走進新一週的經營節點。", hint: "每天打烊並收進手記。" },
  { id: "period_close", category: "operations", icon: "▤", title: "第一本月結", description: "完成第一期三十夜結帳，夜市仍然繼續往前。", hint: "走完一個 30 夜會計期間。" },
  { id: "survive_rain", category: "operations", icon: "🌧️", title: "雨夜沒熄燈", description: "在一場雨夜營業後完成打烊，燈火留到了明晚。", hint: "有些夜晚，天氣也會成為營運的一部分。" },
  { id: "festival_service", category: "operations", icon: "🎐", title: "燈節沒缺席", description: "在港灣燈節接待客人，讓活動人潮也嚐到你的手藝。", hint: "留意行事曆裡的節慶夜。" },
  { id: "insure_first", category: "risk", icon: "🧾", title: "先把人安頓好", description: "首次啟用一項雇主保險保障，替夥伴多留一層照應。", hint: "保障會依攤型與保險期計入帳務。" },
  { id: "claim_collect", category: "risk", icon: "📨", title: "理賠入帳", description: "完成一次保險理賠收款，讓應收款走完帳務流程。", hint: "有保障的事故可能先形成應收款。" },
  { id: "handle_incident", category: "risk", icon: "🩹", title: "先照顧人，再算帳", description: "完整處理一次職安或食安事件，先安置現場再留下紀錄。", hint: "營業事件需要先處理，再決定如何入帳。" },
  { id: "safety_gear", category: "risk", icon: "♨️", title: "遮斷與排煙", description: "主店備妥瓦斯遮斷與排煙設備，讓安全成為日常的一部分。", hint: "安全設備也會影響攤型升級條件。" },
  { id: "orphan_policy", category: "risk", icon: "🗂️", title: "離職保費有下文", description: "完成一次孤兒保單期末調整，並收到保費回收款。", hint: "員工離職後，未到期保費會在期末處理。" },
  { id: "first_acquire", category: "branches", icon: "🏮", title: "鄰攤燈也姓夜嵐", description: "接手的分店首次開門，另一盞燈正式加入夜市。", hint: "接手後還要備料並啟用店面。" },
  { id: "manager_hired", category: "branches", icon: "🧑‍🍳", title: "店長接手例行", description: "聘任第一位店長，把日常營運交給值得信任的人。", hint: "至少有兩間營業店面後，可在週決策安排店長。" },
  { id: "alliance", category: "branches", icon: "🔗", title: "同業走在一起", description: "成立夜市品牌聯盟，讓相近業態共享客流與採購優勢。", hint: "擴店並接手兩間同一類型的攤位。" },
  { id: "multi_outlet_night", category: "branches", icon: "🌃", title: "一條巷的營業燈", description: "主店與至少一間分店同夜開門，夜市巷口一起亮起來。", hint: "讓一間已備妥商品的分店加入今晚營業。" },
  { id: "unlock_tier_dish", category: "menu", icon: "🍲", title: "固定攤的新招牌", description: "透過攤型升級解鎖第一道新佳餚，為菜單添上新一頁。", hint: "主店升級會帶來專屬菜色。" },
  { id: "hometown_recipe", category: "menu", icon: "📜", title: "熟客的家鄉味", description: "收到熟客免費分享的家鄉食譜秘笈。", hint: "多照顧熟客，讓合胃口的服務累積成回憶。" },
  { id: "regulars_cap", category: "story", icon: "🫖", title: "熟客成了風景", description: "熟客累積到二十位，夜市裡開始有了一群熟悉的面孔。", hint: "用穩定的服務慢慢累積熟客。" },
  { id: "read_journal", category: "accounting", icon: "📖", title: "翻過日記簿", description: "第一次打開帳務與手記，把營運留下的痕跡讀一遍。", hint: "在營運面板打開帳務與手記。" },
  { id: "read_statements", category: "accounting", icon: "📊", title: "四表都看過", description: "查閱綜合損益、權益變動、財務狀況與現金流量四份報表。", hint: "第一期結帳後，逐一查看四種財務報表。" },
  { id: "loan_repaid", category: "accounting", icon: "🏦", title: "週轉金還清", description: "借款後完成一次還款，讓週轉安排有借有還。", hint: "週轉金會產生利息，需在後續週決策時還款。" },
  { id: "positive_period", category: "accounting", icon: "⚖️", title: "這一期有留餘", description: "至少一期結帳後的本期損益為正。", hint: "擴張和投資之外，也要留意整期收益與成本。" },
  { id: "harbor_icon", category: "story", icon: "✨", title: "港灣招牌", description: "以穩定盈餘、口碑與熟客，走到「港灣夜市名店」的故事走向。", hint: "尚未記載的港邊故事。", secret: true }
]);

const achievementIds = new Set(ACHIEVEMENTS.map((item) => item.id));
const statementIds = new Set(["income", "equity", "position", "cashflow"]);
const categoryIds = new Set(ACHIEVEMENT_CATEGORIES.filter((item) => item.id !== "all").map((item) => item.id));

export function createAchievementState() {
  return { unlocked: {}, pending: [], viewedJournal: false, viewedStatements: [] };
}

export function normalizeAchievementState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const unlocked = {};
  if (source.unlocked && typeof source.unlocked === "object" && !Array.isArray(source.unlocked)) {
    Object.entries(source.unlocked).forEach(([id, record]) => {
      if (!achievementIds.has(id)) return;
      const entry = record && typeof record === "object" ? record : {};
      unlocked[id] = {
        day: Math.max(0, Math.floor(Number(entry.day) || 0)),
        period: Math.max(0, Math.floor(Number(entry.period) || 0))
      };
    });
  }
  return {
    unlocked,
    pending: Array.from(new Set(Array.isArray(source.pending) ? source.pending.filter((id) => achievementIds.has(id) && unlocked[id]) : [])).slice(-ACHIEVEMENTS.length),
    viewedJournal: !!source.viewedJournal,
    viewedStatements: Array.from(new Set(Array.isArray(source.viewedStatements) ? source.viewedStatements.filter((id) => statementIds.has(id)) : []))
  };
}

export function evaluateAchievements(state, { silent = false } = {}) {
  if (!state || typeof state !== "object") return [];
  state.achievements = normalizeAchievementState(state.achievements);
  const achievements = state.achievements;
  const main = (Array.isArray(state.outlets) ? state.outlets : []).find((outlet) => outlet?.id === "main");
  const branches = (Array.isArray(state.outlets) ? state.outlets : []).filter((outlet) => outlet && outlet.id !== "main");
  const activeOutlets = (Array.isArray(state.outlets) ? state.outlets : []).filter((outlet) => outlet?.active);
  const journal = Array.isArray(state.journal) ? state.journal : [];
  const reports = Array.isArray(state.accounting?.monthlyReports) ? state.accounting.monthlyReports : [];
  const firstPeriodReport = reports[0] || null;
  const firstPositiveReport = reports.find((report) => Number(report.totals?.profit) > 0) || null;
  const harborEndingReport = reports.find((report) => report.outcomeId === "harbor-icon") || null;
  const firstRainEntry = journal.filter((entry) => campaignEntry(entry.day)?.eventId === "rain")
    .sort((left, right) => Number(left.day) - Number(right.day))[0] || null;
  const recipeIds = new Set(Array.isArray(state.unlockedRecipes) ? state.unlockedRecipes : []);
  const types = Array.isArray(state.acquisitionTypes) ? state.acquisitionTypes : [];
  const allianceGroups = types.reduce((counts, type) => {
    const group = ACQUISITION_TYPES[type]?.group;
    if (group) counts[group] = (counts[group] || 0) + 1;
    return counts;
  }, {});
  const hasAlliance = Number(state.expansions) >= 1 && Object.values(allianceGroups).some((count) => count >= 2);
  const hasCoverage = (state.insuranceSnapshot?.outlets || []).some((outlet) => Object.values(outlet.covered || {}).some(Boolean));
  const hasHometownRecipe = DATA.dishes.some((dish) => dish.secretFor && recipeIds.has(dish.id));
  const hasTierRecipe = DATA.dishes.some((dish) => dish.unlockTier && recipeIds.has(dish.id));
  const hasSafetyGear = Number(state.equipment?.fire) >= 1 && Number(state.equipment?.hood) >= 1;
  const statementViews = new Set(achievements.viewedStatements);
  const rules = {
    first_open: Number(state.day) > 1 || state.phase !== "prep" || journal.length > 0,
    tier_fixed: main?.tier === "fixed" || main?.tier === "dapaidang",
    tier_dapaidang: main?.tier === "dapaidang",
    expand_once: Number(state.expansions) >= 1,
    expand_thrice: Number(state.expansions) >= 3,
    week_one: Number(state.day) >= 8 || journal.some((entry) => Number(entry.day) >= 7),
    period_close: reports.length > 0,
    survive_rain: journal.some((entry) => campaignEntry(entry.day)?.eventId === "rain"),
    festival_service: (campaignEntry(state.day)?.eventId === "festival" && Array.isArray(state.results) && state.results.length > 0) || journal.some((entry) => campaignEntry(entry.day)?.eventId === "festival" && Array.isArray(entry.guests) && entry.guests.length > 0),
    insure_first: hasCoverage,
    claim_collect: (Array.isArray(state.insuranceClaims) ? state.insuranceClaims : []).some((claim) => claim?.status === "collected"),
    handle_incident: state.safetyIncident?.status === "resolved" || journal.some((entry) => !!entry.safetyIncident?.title),
    safety_gear: hasSafetyGear,
    orphan_policy: (Array.isArray(state.orphanPolicies) ? state.orphanPolicies : []).some((policy) => policy?.status === "collected"),
    first_acquire: branches.some((outlet) => outlet.active),
    manager_hired: branches.some((outlet) => outlet.manager) || (Array.isArray(state.decisions) ? state.decisions : []).some((decision) => decision?.id === "manager"),
    alliance: hasAlliance,
    multi_outlet_night: state.phase === "service" && activeOutlets.length >= 2,
    unlock_tier_dish: hasTierRecipe,
    hometown_recipe: hasHometownRecipe,
    regulars_cap: Number(state.regulars) >= 20,
    read_journal: achievements.viewedJournal,
    read_statements: reports.length > 0 && ["income", "equity", "position", "cashflow"].every((id) => statementViews.has(id)),
    loan_repaid: !!state.loanUsed && Number(state.loanPrincipal) === 0 && Number(state.loanNights) > 0,
    positive_period: reports.some((report) => Number(report.totals?.profit) > 0),
    harbor_icon: reports.some((report) => report.outcomeId === "harbor-icon")
  };
  const newlyUnlocked = [];
  const day = Math.max(1, Math.floor(Number(state.day) || 1));
  const period = Math.floor((day - 1) / 30) + 1;
  const achievementDate = {
    week_one: { day: 7, period: 1 },
    period_close: firstPeriodReport ? { day: Number(firstPeriodReport.endDay) || 30, period: Number(firstPeriodReport.period) || 1 } : null,
    survive_rain: firstRainEntry ? { day: Number(firstRainEntry.day) || day, period: Math.floor(((Number(firstRainEntry.day) || day) - 1) / 30) + 1 } : null,
    positive_period: firstPositiveReport ? { day: Number(firstPositiveReport.endDay) || day, period: Number(firstPositiveReport.period) || 1 } : null,
    harbor_icon: harborEndingReport ? { day: Number(harborEndingReport.endDay) || day, period: Number(harborEndingReport.period) || 1 } : null
  };
  ACHIEVEMENTS.forEach((item) => {
    if (!rules[item.id] || achievements.unlocked[item.id]) return;
    achievements.unlocked[item.id] = silent ? { day: 0, period: 0 } : achievementDate[item.id] || { day, period };
    if (!silent) {
      achievements.pending.push(item.id);
      newlyUnlocked.push(item.id);
    }
  });
  if (achievements.pending.length > ACHIEVEMENTS.length) achievements.pending = achievements.pending.slice(-ACHIEVEMENTS.length);
  return newlyUnlocked;
}

export function isAchievementCategory(id) {
  return categoryIds.has(id);
}


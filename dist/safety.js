import { DATA, getOutletProduct } from "./data.js";

export const STALL_TIERS = Object.freeze([
  { id: "mobile", name: "流動攤販", buildCost: 0, guestBonus: 0, dailyUtilities: 0 },
  { id: "fixed", name: "固定攤販", buildCost: 420, guestBonus: 1, dailyUtilities: 8 },
  { id: "dapaidang", name: "大排檔", buildCost: 1380, guestBonus: 2, dailyUtilities: 18 }
]);

export const OUTLET_SAFETY_EQUIPMENT = Object.freeze([
  { id: "fire", name: "瓦斯遮斷與滅火設備", icon: "♨", note: "降低爐火與瓦斯事故風險。", costs: [220, 360] },
  { id: "ventilation", name: "排煙與換氣設備", icon: "≋", note: "改善排煙、熱氣與工作空氣品質。", costs: [260, 420] },
  { id: "coldStorage", name: "食材冷藏設備", icon: "❄", note: "餐飲業態固定與大型攤型的冷鏈必要條件。", costs: [280, 460] }
]);

export const INSURANCE_RATES = Object.freeze({
  accidentPerEmployee: 24,
  laborPerEmployee: 180,
  healthPerEmployee: 160,
  productLiabilityPerFoodOutlet: 280,
  publicLiabilityPerOutlet: 360
});

const TIER_INDEX = Object.freeze(Object.fromEntries(STALL_TIERS.map((tier, index) => [tier.id, index])));

export function getOutletTier(outlet) {
  return TIER_INDEX[outlet?.tier] === undefined ? STALL_TIERS[0] : STALL_TIERS[TIER_INDEX[outlet.tier]];
}

export function getNextStallTier(outlet) {
  return STALL_TIERS[TIER_INDEX[getOutletTier(outlet).id] + 1] || null;
}

export function getOutletEmployeeCount(state, outlet) {
  if (!outlet) return 0;
  if (outlet.id === "main") return DATA.staff.length + Math.max(0, Math.floor(Number(state.hiredCrew) || 0));
  return outlet.manager ? 1 : 0;
}

export function getOutletSafetyLevel(state, outlet, equipmentId) {
  if (!outlet) return 0;
  if (outlet.id === "main") {
    const mainEquipmentId = equipmentId === "ventilation" ? "hood" : equipmentId === "coldStorage" ? "cooler" : equipmentId;
    return Math.max(0, Math.floor(Number(state.equipment?.[mainEquipmentId]) || 0));
  }
  return Math.max(0, Math.floor(Number(outlet.safety?.[equipmentId]) || 0));
}

export function getTierReadiness(state, outlet, targetId = getNextStallTier(outlet)?.id) {
  const target = STALL_TIERS.find((tier) => tier.id === targetId);
  if (!target || !outlet) return { ready: false, requirements: [], missing: ["找不到升級目標。"] };
  const isFood = outlet.id === "main" || getOutletProduct(outlet.type).group === "food";
  const currentIndex = TIER_INDEX[getOutletTier(outlet).id];
  const targetIndex = TIER_INDEX[target.id];
  const isPromotion = targetIndex > currentIndex;
  const requirement = (label, ready) => ({ label, ready: !!ready });
  let requirements = [];

  if (target.id === "fixed") {
    requirements = [
      requirement("瓦斯遮斷與滅火設備 Lv.1", getOutletSafetyLevel(state, outlet, "fire") >= 1),
      requirement("排煙與換氣設備 Lv.1", getOutletSafetyLevel(state, outlet, "ventilation") >= 1)
    ];
    if (outlet.id === "main") requirements.push(requirement("防風棚架 Lv.1", Number(state.equipment?.awning) >= 1));
    else requirements.push(requirement("店面營運設備 Lv.1", Number(outlet.equipmentLevel) >= 1));
    if (isFood) requirements.push(requirement("食材冷藏設備 Lv.1", getOutletSafetyLevel(state, outlet, "coldStorage") >= 1));
  } else if (target.id === "dapaidang") {
    requirements = [
      requirement("瓦斯遮斷與滅火設備 Lv.2", getOutletSafetyLevel(state, outlet, "fire") >= 2),
      requirement("排煙與換氣設備 Lv.2", getOutletSafetyLevel(state, outlet, "ventilation") >= 2),
      requirement("大攤所需營運設備 Lv.2", outlet.id === "main" ? Number(state.equipment?.grill) >= 2 : Number(outlet.equipmentLevel) >= 2)
    ];
    if (outlet.id === "main" && isPromotion) {
      requirements.push(requirement("店面規模至少擴充 2 次", Number(state.expansions) >= 2));
      requirements.push(requirement("已招募至少 1 位全職夥伴", Number(state.hiredCrew) >= 1));
      if (isFood) requirements.push(requirement("食材冷藏設備 Lv.2", getOutletSafetyLevel(state, outlet, "coldStorage") >= 2));
    } else if (outlet.id !== "main" && isPromotion) {
      requirements.push(requirement("已聘任店長負責日常營運", !!outlet.manager));
      if (isFood) requirements.push(requirement("食材冷藏設備 Lv.2", getOutletSafetyLevel(state, outlet, "coldStorage") >= 2));
    } else if (outlet.id === "main" && isFood) {
      requirements.push(requirement("食材冷藏設備 Lv.2", getOutletSafetyLevel(state, outlet, "coldStorage") >= 2));
    } else if (outlet.id !== "main" && isFood) {
      requirements.push(requirement("食材冷藏設備 Lv.2", getOutletSafetyLevel(state, outlet, "coldStorage") >= 2));
    }
  }

  const missing = requirements.filter((item) => !item.ready).map((item) => item.label);
  return { ready: missing.length === 0, requirements, missing };
}

export function getMonthlyInsurance(state, outlet) {
  const tierIndex = TIER_INDEX[getOutletTier(outlet).id];
  const employees = getOutletEmployeeCount(state, outlet);
  const mandatoryEmployerCoverage = tierIndex >= TIER_INDEX.dapaidang;
  const isFood = outlet?.id === "main" || getOutletProduct(outlet?.type).group === "food";
  const fixedOrLarger = tierIndex >= TIER_INDEX.fixed;
  const publicLiability = tierIndex >= TIER_INDEX.dapaidang;
  const accident = (mandatoryEmployerCoverage || outlet?.accidentCoverage)
    ? employees * INSURANCE_RATES.accidentPerEmployee : 0;
  const labor = mandatoryEmployerCoverage ? employees * INSURANCE_RATES.laborPerEmployee : 0;
  const health = mandatoryEmployerCoverage ? employees * INSURANCE_RATES.healthPerEmployee : 0;
  const product = fixedOrLarger && isFood ? INSURANCE_RATES.productLiabilityPerFoodOutlet : 0;
  const publicPremium = publicLiability ? INSURANCE_RATES.publicLiabilityPerOutlet : 0;
  return { employees, mandatoryEmployerCoverage, accident, labor, health, product, public: publicPremium,
    total: accident + labor + health + product + publicPremium };
}

export function hasCurrentCoverage(state, outletId, policy) {
  const cycleStart = Math.floor((Math.max(1, Number(state?.day) || 1) - 1) / 30) * 30 + 1;
  const snapshot = state?.insuranceSnapshot;
  if (!snapshot || Number(snapshot.periodStartDay) !== cycleStart) return false;
  const outlet = (snapshot.outlets || []).find((item) => item.outletId === outletId);
  return !!outlet?.covered?.[policy];
}

export function monthlyInsuranceTotals(state) {
  const totals = { accident: 0, labor: 0, health: 0, product: 0, public: 0, total: 0 };
  (Array.isArray(state.outlets) ? state.outlets : []).forEach((outlet) => {
    const costs = getMonthlyInsurance(state, outlet);
    Object.keys(totals).forEach((key) => { totals[key] += costs[key] || 0; });
  });
  return totals;
}

export function isInsuranceBillingDay(day) {
  const value = Math.floor(Number(day));
  return value >= 1 && (value - 1) % 30 === 0;
}

export function getNextInsuranceBillingDay(day) {
  const value = Math.max(1, Math.floor(Number(day) || 1));
  const periodStart = Math.floor((value - 1) / 30) * 30 + 1;
  return value === periodStart ? value : periodStart + 30;
}

export function getTierDailyUtilities(state) {
  return (Array.isArray(state.outlets) ? state.outlets : []).reduce((sum, outlet) => {
    if (outlet.id !== "main" && !outlet.active) return sum;
    return sum + getOutletTier(outlet).dailyUtilities;
  }, 0);
}

export function getOutletCapacity(outlet) {
  const normal = outlet?.manager ? (Number(outlet.efficiencyPenalty) > 0 ? 1 : 2) : 1;
  return normal + getOutletTier(outlet).guestBonus;
}

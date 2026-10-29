// IFRS-oriented educational bookkeeping for the night-market simulation.
// IFRS does not prescribe a universal account-number chart; these are the game's
// stable internal codes, grouped to map cleanly to its financial statements.
// Posting map: sales/tips 1000↔4000/4010; stock purchases 1100↔1000;
// service COGS 5000↔1100; payroll/rent/utilities 5100/5200/5300↔1000;
// premiums 5450-5480↔1000; workplace/customer/product claims 1210↔4030;
// claim care and compensation use 5520-5540↔1000; asset purchase 1500/1600↔1000;
// depreciation/amortization 5600/5610↔1590/1690; borrowing/interest 1000↔2100/5700.
export const CHART_OF_ACCOUNTS = Object.freeze([
  { code: "1000", name: "現金及約當現金", type: "asset", normal: "debit", statement: "財務狀況" },
  { code: "1100", name: "存貨－食材", type: "asset", normal: "debit", statement: "財務狀況" },
  { code: "1200", name: "應收保險退費款", type: "asset", normal: "debit", statement: "財務狀況" },
  { code: "1210", name: "應收保險理賠款", type: "asset", normal: "debit", statement: "財務狀況" },
  { code: "1500", name: "設備及租賃改良－成本", type: "asset", normal: "debit", statement: "財務狀況" },
  { code: "1590", name: "累計折舊－設備及租賃改良", type: "contra-asset", normal: "credit", statement: "財務狀況" },
  { code: "1600", name: "攤位經營權－成本", type: "asset", normal: "debit", statement: "財務狀況" },
  { code: "1690", name: "累計攤銷－攤位經營權", type: "contra-asset", normal: "credit", statement: "財務狀況" },
  { code: "2100", name: "銀行週轉借款", type: "liability", normal: "credit", statement: "財務狀況" },
  { code: "2110", name: "銀行透支（財報重分類）", type: "liability", normal: "credit", statement: "財務狀況" },
  { code: "3000", name: "業主投入資本", type: "equity", normal: "credit", statement: "權益變動" },
  { code: "3100", name: "保留盈餘／累積虧損", type: "equity", normal: "credit", statement: "權益變動" },
  { code: "4000", name: "餐飲銷貨收入", type: "income", normal: "credit", statement: "綜合損益" },
  { code: "4010", name: "服務費及小費收入", type: "income", normal: "credit", statement: "綜合損益" },
  { code: "4020", name: "補助及其他營業收入", type: "income", normal: "credit", statement: "綜合損益" },
  { code: "4030", name: "保險理賠收入", type: "income", normal: "credit", statement: "綜合損益" },
  { code: "4090", name: "退款及銷貨折讓", type: "contra-income", normal: "debit", statement: "綜合損益" },
  { code: "5000", name: "銷貨成本－食材", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5100", name: "薪資及人事費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5110", name: "招募及訓練費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5200", name: "租金及攤位使用費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5300", name: "水電瓦斯費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5400", name: "清潔、稽查及維護費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5450", name: "職業災害保險費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5460", name: "雇主勞工保險費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5461", name: "雇主健康保險費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5470", name: "食品業者產品責任保險費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5480", name: "公共意外責任保險費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5410", name: "行銷及宣傳費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5500", name: "客訴招待及營業雜支", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5520", name: "職業災害照護與補償費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5530", name: "顧客意外照護與補償費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5540", name: "食品安全處理與顧客補償費", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5600", name: "折舊費用", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5610", name: "攤銷費用", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5700", name: "財務成本－借款利息", type: "expense", normal: "debit", statement: "綜合損益" },
  { code: "5800", name: "所得稅費用", type: "expense", normal: "debit", statement: "綜合損益" }
]);

const ACCOUNT = Object.freeze(Object.fromEntries(CHART_OF_ACCOUNTS.map((item) => [item.code, item])));
const round = (value) => Math.max(0, Math.round(Number(value) || 0));
const copyBalances = (balances = {}) => Object.fromEntries(CHART_OF_ACCOUNTS.map(({ code }) => [code, Number(balances[code]) || 0]));
const signedBalance = (amount, side) => side === "debit" ? amount : -amount;

export function createAccountingState({ day = 1, cash = 0, inventory = 0, debt = 0, assets = [] } = {}) {
  const accounts = Object.fromEntries(CHART_OF_ACCOUNTS.map(({ code }) => [code, 0]));
  const normalizedAssets = assets.map((asset, index) => ({
    id: String(asset.id || "asset-" + (index + 1)),
    name: String(asset.name || "營運設備"),
    category: asset.category === "intangible" ? "intangible" : "ppe",
    account: asset.category === "intangible" ? "1600" : "1500",
    accumulatedAccount: asset.category === "intangible" ? "1690" : "1590",
    cost: round(asset.cost),
    residualValue: Math.min(round(asset.cost), round(asset.residualValue)),
    usefulLifeDays: Math.max(1, Math.floor(Number(asset.usefulLifeDays) || 360)),
    availableDay: Math.max(1, Math.floor(Number(asset.availableDay) || day)),
    accumulatedDepreciation: round(asset.accumulatedDepreciation)
  })).filter((asset) => asset.cost > 0);
  const ppe = normalizedAssets.filter((asset) => asset.category === "ppe").reduce((sum, asset) => sum + asset.cost, 0);
  const intangible = normalizedAssets.filter((asset) => asset.category === "intangible").reduce((sum, asset) => sum + asset.cost, 0);
  const ppeAccumulated = normalizedAssets.filter((asset) => asset.category === "ppe").reduce((sum, asset) => sum + asset.accumulatedDepreciation, 0);
  const intangibleAccumulated = normalizedAssets.filter((asset) => asset.category === "intangible").reduce((sum, asset) => sum + asset.accumulatedDepreciation, 0);
  const openingLines = [
    { account: "1000", debit: round(cash) },
    { account: "1100", debit: round(inventory) },
    { account: "1500", debit: ppe },
    { account: "1590", credit: ppeAccumulated },
    { account: "1600", debit: intangible },
    { account: "1690", credit: intangibleAccumulated },
    { account: "2100", credit: round(debt) }
  ].filter((line) => line.debit || line.credit);
  const debitTotal = openingLines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const creditTotal = openingLines.reduce((sum, line) => sum + (line.credit || 0), 0);
  openingLines.push({ account: "3000", credit: Math.max(0, debitTotal - creditTotal) });
  if (creditTotal > debitTotal) openingLines.push({ account: "3100", debit: creditTotal - debitTotal });
  openingLines.forEach((line) => {
    line.debit = round(line.debit);
    line.credit = round(line.credit);
    accounts[line.account] += line.debit - line.credit;
  });
  const openedAt = Math.max(1, Math.floor(Number(day) || 1));
  return {
    version: 1,
    journal: [{ id: "opening-" + openedAt, day: openedAt - 1, description: "開帳｜承接既有現金、存貨與營運資產", lines: openingLines, cashFlow: null, opening: true }],
    balances: accounts,
    assets: normalizedAssets,
    periodStartDay: openedAt,
    periodOpeningBalances: copyBalances(accounts),
    weekStartDay: openedAt,
    weekOpeningBalances: copyBalances(accounts),
    weeklyReports: [],
    monthlyReports: [],
    monthEndWorksheets: [],
    entrySequence: 1
  };
}

export function ensureAccounting(state) {
  if (!state.accounting || typeof state.accounting !== "object") {
    const inventory = Object.entries(state.stock || {}).reduce((sum, [id, quantity]) => {
      return sum + Math.max(0, Number(quantity) || 0) * Math.max(0, Number(state.stockCost?.[id]) || 0);
    }, 0);
    state.accounting = createAccountingState({ day: state.day, cash: state.coins, inventory, debt: state.loanPrincipal });
  }
  const accounting = state.accounting;
  accounting.version = 1;
  accounting.balances = copyBalances(accounting.balances);
  accounting.assets = Array.isArray(accounting.assets) ? accounting.assets : [];
  accounting.journal = Array.isArray(accounting.journal) ? accounting.journal : [];
  accounting.weeklyReports = Array.isArray(accounting.weeklyReports) ? accounting.weeklyReports : [];
  accounting.monthlyReports = Array.isArray(accounting.monthlyReports) ? accounting.monthlyReports : [];
  accounting.monthEndWorksheets = Array.isArray(accounting.monthEndWorksheets) ? accounting.monthEndWorksheets : [];
  accounting.weeklyReports.forEach((report, index) => {
    if (!report.id) report.id = report.periodEnd ? "period-" + (report.period || index + 1) : "week-" + (report.week || index + 1) + "-" + (report.endDay || index);
  });
  accounting.periodStartDay = Math.max(1, Math.floor(Number(accounting.periodStartDay) || state.day || 1));
  accounting.weekStartDay = Math.max(1, Math.floor(Number(accounting.weekStartDay) || state.day || 1));
  accounting.periodOpeningBalances = copyBalances(accounting.periodOpeningBalances || accounting.balances);
  accounting.weekOpeningBalances = copyBalances(accounting.weekOpeningBalances || accounting.balances);
  accounting.entrySequence = Math.max(1, Math.floor(Number(accounting.entrySequence) || 1));
  return accounting;
}

export function postJournal(state, description, rawLines, cashFlow = null, day = state.day) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw new Error("Journal entry requires at least one line: " + description);
  const lines = rawLines.map((line) => {
    if (!line || typeof line !== "object") throw new Error("Invalid journal line: " + description);
    const account = String(line.account);
    if (!ACCOUNT[account]) throw new Error("Unknown account " + account);
    const rawDebit = line.debit == null ? 0 : Number(line.debit);
    const rawCredit = line.credit == null ? 0 : Number(line.credit);
    if (!Number.isFinite(rawDebit) || !Number.isFinite(rawCredit) || rawDebit < 0 || rawCredit < 0) {
      throw new Error("Invalid journal amount for account " + account);
    }
    const debit = round(rawDebit);
    const credit = round(rawCredit);
    if (debit && credit) throw new Error("Journal line cannot debit and credit the same account: " + account);
    return { account, debit, credit };
  }).filter((line) => line.debit || line.credit);
  if (!lines.length) throw new Error("Journal entry requires a non-zero amount: " + description);
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (Math.abs(debit - credit) > 0) throw new Error("Unbalanced journal entry: " + description + " (" + debit + " != " + credit + ")");
  const accounting = ensureAccounting(state);
  const nextBalances = Object.create(null);
  lines.forEach((line) => {
    const base = Object.prototype.hasOwnProperty.call(nextBalances, line.account)
      ? nextBalances[line.account]
      : accounting.balances[line.account];
    const next = base + line.debit - line.credit;
    if (!Number.isFinite(next)) throw new Error("Invalid resulting balance for account " + line.account);
    nextBalances[line.account] = next;
  });
  const entry = {
    id: "je-" + accounting.entrySequence,
    day: Math.max(0, Math.floor(Number(day) || 0)),
    description: String(description),
    lines,
    cashFlow: cashFlow && Number.isFinite(Number(cashFlow.amount))
      ? { category: cashFlow.category, amount: Math.round(Number(cashFlow.amount)) }
      : null
  };
  Object.keys(nextBalances).forEach((account) => { accounting.balances[account] = nextBalances[account]; });
  accounting.entrySequence += 1;
  accounting.journal.push(entry);
  // Keep the detailed ledger bounded for browser-local saves while balances and
  // period summaries continue to flow indefinitely.
  if (accounting.journal.length > 8000) accounting.journal.splice(0, accounting.journal.length - 8000);
  return entry;
}

export function recordOperatingClose(state, ledger) {
  const expenseLines = [
    ["5200", ledger.rent + (ledger.expansionRent || 0) + (ledger.acquisitionRent || 0)],
    ["5100", ledger.labor],
    ["5100", ledger.managerPayroll || 0],
    ["5300", (ledger.water || 0) + ledger.electricity + ledger.gas],
    ["5300", ledger.outletUtilities || 0],
    ["5300", ledger.stallUtilities || 0],
    ["5400", (ledger.fees || 0) + (ledger.preparation || 0)],
    ["5410", ledger.marketing || 0],
    ["5450", ledger.insuranceAccident || 0],
    ["5460", ledger.insuranceLabor || 0],
    ["5461", ledger.insuranceHealth || 0],
    ["5470", ledger.insuranceProduct || 0],
    ["5480", ledger.insurancePublic || 0],
    ["5700", ledger.interest || 0]
  ].filter(([, amount]) => amount > 0);
  const lines = expenseLines.map(([account, debit]) => ({ account, debit }));
  if (ledger.subsidies > 0) lines.push({ account: "1000", debit: ledger.subsidies }, { account: "4020", credit: ledger.subsidies });
  const costs = expenseLines.reduce((sum, [, amount]) => sum + amount, 0);
  if (costs > 0) lines.push({ account: "1000", credit: costs });
  if (lines.length) postJournal(state, "開門支出與市集補助", lines, { category: "operating", amount: ledger.subsidies - costs });
}

export function recordInsuranceRefundAdjustment(state, policy, day) {
  const amount = round(policy?.refundAmount);
  if (!amount || policy.status !== "pending-adjustment") return 0;
  const breakdown = policy.refundBreakdown || {};
  const lines = [{ account: "1200", debit: amount }];
  [["5450", breakdown.accident], ["5460", breakdown.labor], ["5461", breakdown.health]]
    .forEach(([account, credit]) => { if (round(credit)) lines.push({ account, credit: round(credit) }); });
  const credited = lines.slice(1).reduce((sum, line) => sum + line.credit, 0);
  if (credited !== amount) throw new Error("Insurance refund adjustment does not match policy amount: " + policy.id);
  postJournal(state, "期末調整｜" + policy.employeeName + "離職未到期保費應收", lines, null, day);
  policy.status = "receivable";
  policy.adjustmentDay = day;
  return amount;
}

export function closeInsuranceRefundAdjustments(state, endDay) {
  const policies = Array.isArray(state.orphanPolicies) ? state.orphanPolicies : [];
  let amount = 0;
  let count = 0;
  policies.filter((policy) => policy && policy.status === "pending-adjustment" && Number(policy.periodEndDay) <= endDay)
    .forEach((policy) => { amount += recordInsuranceRefundAdjustment(state, policy, endDay); count += 1; });
  return { amount, count };
}

export function collectInsuranceRefundReceivables(state, day) {
  const policies = Array.isArray(state.orphanPolicies) ? state.orphanPolicies : [];
  let amount = 0;
  policies.filter((policy) => policy && policy.status === "receivable" && Number(policy.periodEndDay) < day)
    .forEach((policy) => {
      const refund = round(policy.refundAmount);
      if (!refund) return;
      postJournal(state, "收款｜保險退費應收・" + policy.employeeName,
        [{ account: "1000", debit: refund }, { account: "1200", credit: refund }],
        { category: "operating", amount: refund }, day);
      policy.status = "collected";
      policy.collectionDay = day;
      amount += refund;
    });
  return amount;
}

export function recordInventoryPurchase(state, itemName, amount) {
  const value = round(amount);
  if (value) postJournal(state, "補貨｜" + itemName, [{ account: "1100", debit: value }, { account: "1000", credit: value }], { category: "operating", amount: -value });
}

export function recordSale(state, { dishName, price, serviceIncome = 0, otherIncome = 0, foodCost = 0 }) {
  const paid = round(price) + round(serviceIncome) + round(otherIncome);
  const lines = [];
  if (round(price)) lines.push({ account: "1000", debit: round(price) }, { account: "4000", credit: round(price) });
  if (round(serviceIncome)) lines.push({ account: "1000", debit: round(serviceIncome) }, { account: "4010", credit: round(serviceIncome) });
  if (round(otherIncome)) lines.push({ account: "1000", debit: round(otherIncome) }, { account: "4020", credit: round(otherIncome) });
  const cogs = round(foodCost);
  if (cogs) lines.push({ account: "5000", debit: cogs }, { account: "1100", credit: cogs });
  if (paid || cogs) postJournal(state, "銷售｜" + dishName, lines, { category: "operating", amount: paid });
}

export function recordExpense(state, account, description, amount, cashFlowCategory = "operating") {
  const value = round(amount);
  if (value) postJournal(state, description, [{ account, debit: value }, { account: "1000", credit: value }], { category: cashFlowCategory, amount: -value });
}

export function recordRefund(state, amount) {
  const value = round(amount);
  if (value) postJournal(state, "客訴退款／銷貨折讓", [{ account: "4090", debit: value }, { account: "1000", credit: value }], { category: "operating", amount: -value });
}

export function recordInsuranceClaimAccrual(state, claim, day = state.day) {
  const amount = round(claim?.amount);
  if (!amount) return null;
  return postJournal(state, "保險理賠核認｜" + String(claim.description || claim.id || "營運事故"),
    [{ account: "1210", debit: amount }, { account: "4030", credit: amount }], null, day);
}

export function collectInsuranceClaims(state, day = state.day) {
  const claims = Array.isArray(state.insuranceClaims) ? state.insuranceClaims : [];
  let total = 0;
  claims.filter((claim) => claim && claim.status === "receivable" && Number(claim.payoutDay) <= day)
    .forEach((claim) => {
      const amount = round(claim.amount);
      if (!amount) return;
      postJournal(state, "收款｜保險理賠款・" + String(claim.description || claim.id),
        [{ account: "1000", debit: amount }, { account: "1210", credit: amount }],
        { category: "operating", amount }, day);
      claim.status = "collected";
      claim.collectionDay = day;
      total += amount;
    });
  return total;
}

export function recordAssetPurchase(state, { id, name, cost, usefulLifeDays = 360, residualValue = 0, category = "ppe" }) {
  const value = round(cost);
  if (!value) return null;
  const intangible = category === "intangible";
  const asset = {
    id: String(id || "asset-" + ensureAccounting(state).entrySequence),
    name: String(name || "新增設備"),
    category: intangible ? "intangible" : "ppe",
    account: intangible ? "1600" : "1500",
    accumulatedAccount: intangible ? "1690" : "1590",
    cost: value,
    residualValue: Math.min(value, round(residualValue)),
    usefulLifeDays: Math.max(1, Math.floor(Number(usefulLifeDays) || 360)),
    availableDay: Math.max(1, Math.floor(Number(state.day) || 1)),
    accumulatedDepreciation: 0
  };
  const accounting = ensureAccounting(state);
  accounting.assets.push(asset);
  postJournal(state, "資產購置｜" + asset.name, [
    { account: asset.account, debit: value }, { account: "1000", credit: value }
  ], { category: "investing", amount: -value });
  return asset;
}

export function recordLoanDraw(state, amount) {
  const value = round(amount);
  if (value) postJournal(state, "銀行週轉借款撥入", [{ account: "1000", debit: value }, { account: "2100", credit: value }], { category: "financing", amount: value });
}

export function recordLoanRepayment(state, amount) {
  const value = round(amount);
  if (value) postJournal(state, "償還銀行週轉本金", [{ account: "2100", debit: value }, { account: "1000", credit: value }], { category: "financing", amount: -value });
}

function amountOn(accounting, code) { return Number(accounting.balances[code]) || 0; }
function normalAmount(value, normal) { return normal === "credit" ? -value : value; }
function financialRows(accounting, predicate) {
  return CHART_OF_ACCOUNTS.filter(predicate).map((account) => ({
    code: account.code,
    name: account.name,
    type: account.type,
    debit: Math.max(0, amountOn(accounting, account.code)),
    credit: Math.max(0, -amountOn(accounting, account.code)),
    balance: amountOn(accounting, account.code)
  }));
}

export function closeDepreciation(state, finishedDay) {
  const accounting = ensureAccounting(state);
  const lines = [];
  let ppe = 0;
  let intangible = 0;
  accounting.assets.forEach((asset) => {
    const elapsed = Math.max(0, Math.min(asset.usefulLifeDays, finishedDay - asset.availableDay + 1));
    const depreciable = Math.max(0, asset.cost - asset.residualValue);
    const target = Math.floor(depreciable * elapsed / asset.usefulLifeDays);
    const current = Math.max(0, target - (Number(asset.accumulatedDepreciation) || 0));
    if (!current) return;
    asset.accumulatedDepreciation = target;
    lines.push({ account: asset.category === "intangible" ? "5610" : "5600", debit: current });
    lines.push({ account: asset.accumulatedAccount, credit: current });
    if (asset.category === "intangible") intangible += current;
    else ppe += current;
  });
  const total = ppe + intangible;
  if (total) postJournal(state, "每日折舊與攤銷｜第 " + finishedDay + " 夜", lines);
  return { ppe, intangible, total };
}

export function closeWeeklyWorksheet(state, endDay, { periodEnd = false, insuranceAdjustment = null } = {}) {
  const accounting = ensureAccounting(state);
  const startDay = accounting.weekStartDay;
  const entries = accounting.journal.filter((entry) => entry.day >= startDay && entry.day <= endDay && !entry.opening);
  const activity = Object.fromEntries(CHART_OF_ACCOUNTS.map(({ code }) => [code, { debit: 0, credit: 0 }]));
  entries.forEach((entry) => entry.lines.forEach((line) => {
    activity[line.account].debit += line.debit;
    activity[line.account].credit += line.credit;
  }));
  const rows = CHART_OF_ACCOUNTS.map((account) => {
    const opening = Number(accounting.weekOpeningBalances[account.code]) || 0;
    const debit = activity[account.code].debit;
    const credit = activity[account.code].credit;
    const closing = opening + debit - credit;
    return { code: account.code, name: account.name, opening, debit, credit, closing,
      closingDebit: Math.max(0, closing), closingCredit: Math.max(0, -closing) };
  }).filter((row) => row.opening || row.debit || row.credit || row.closing);
  const trialDebit = rows.reduce((sum, row) => sum + row.closingDebit, 0);
  const trialCredit = rows.reduce((sum, row) => sum + row.closingCredit, 0);
  const week = Math.floor((endDay - 1) / 7) + 1;
  const report = { id: periodEnd ? "period-" + Math.floor((endDay - 1) / 30 + 1) : "week-" + week + "-" + endDay,
    week, periodEnd, period: periodEnd ? Math.floor((endDay - 1) / 30) + 1 : null,
    insuranceAdjustment: insuranceAdjustment || null,
    startDay, endDay, rows, trialDebit, trialCredit, balanced: trialDebit === trialCredit };
  accounting.weeklyReports.push(report);
  if (accounting.weeklyReports.length > 104) accounting.weeklyReports.splice(0, accounting.weeklyReports.length - 104);
  if (periodEnd) {
    accounting.monthEndWorksheets.push(report);
    if (accounting.monthEndWorksheets.length > 36) accounting.monthEndWorksheets.splice(0, accounting.monthEndWorksheets.length - 36);
  }
  accounting.weekStartDay = endDay + 1;
  accounting.weekOpeningBalances = copyBalances(accounting.balances);
  return report;
}

function profitAndLoss(accounting) {
  const revenue = Object.fromEntries(["4000", "4010", "4020", "4030"].map((code) => [code, normalAmount(amountOn(accounting, code), "credit")]));
  const contra = Math.max(0, amountOn(accounting, "4090"));
  const expenses = Object.fromEntries(CHART_OF_ACCOUNTS.filter((account) => account.type === "expense").map((account) => [account.code, Math.max(0, amountOn(accounting, account.code))]));
  const totalRevenue = Object.values(revenue).reduce((sum, value) => sum + value, 0);
  const operatingExpenses = Object.entries(expenses).filter(([code]) => code !== "5700" && code !== "5800").reduce((sum, [, value]) => sum + value, 0);
  const operatingIncome = totalRevenue - contra - operatingExpenses;
  const financeCosts = expenses["5700"] || 0;
  const tax = expenses["5800"] || 0;
  return { revenue, contra, expenses, totalRevenue, operatingExpenses, operatingIncome, financeCosts, tax, profit: operatingIncome - financeCosts - tax };
}

function statementOfFinancialPosition(accounting, currentProfit = 0) {
  const assets = accounting.assets;
  const rawCash = amountOn(accounting, "1000");
  const cash = Math.max(0, rawCash);
  const bankOverdraft = Math.max(0, -rawCash);
  const inventory = amountOn(accounting, "1100");
  const ppeCost = assets.filter((asset) => asset.category === "ppe").reduce((sum, asset) => sum + asset.cost, 0);
  const ppeDep = Math.max(0, -amountOn(accounting, "1590"));
  const rightsCost = assets.filter((asset) => asset.category === "intangible").reduce((sum, asset) => sum + asset.cost, 0);
  const rightsAmort = Math.max(0, -amountOn(accounting, "1690"));
  const bankBorrowings = Math.max(0, -amountOn(accounting, "2100"));
  const liability = bankBorrowings + bankOverdraft;
  const capital = Math.max(0, -amountOn(accounting, "3000"));
  const retained = -amountOn(accounting, "3100");
  const insuranceReceivables = Math.max(0, amountOn(accounting, "1200"));
  const insuranceClaimReceivables = Math.max(0, amountOn(accounting, "1210"));
  const totalAssets = cash + inventory + insuranceReceivables + insuranceClaimReceivables + ppeCost - ppeDep + rightsCost - rightsAmort;
  const equity = capital + retained + currentProfit;
  return {
    assets: { cash, inventory, insuranceReceivables, insuranceClaimReceivables, ppeCost, ppeDep, ppeNet: ppeCost - ppeDep, rightsCost, rightsAmort, rightsNet: rightsCost - rightsAmort, total: totalAssets },
    liabilities: { bankBorrowings, bankOverdraft, total: liability },
    equity: { capital, retainedEarnings: retained, currentProfit, total: equity },
    totalLiabilitiesAndEquity: liability + equity,
    balanced: totalAssets === liability + equity
  };
}

function cashFlowStatement(entries, openingBankBalance, closingBankBalance) {
  const amounts = { operating: 0, investing: 0, financing: 0 };
  entries.forEach((entry) => {
    if (entry.cashFlow && Object.prototype.hasOwnProperty.call(amounts, entry.cashFlow.category)) {
      amounts[entry.cashFlow.category] += Number(entry.cashFlow.amount) || 0;
    }
  });
  const openingOverdraft = Math.max(0, -openingBankBalance);
  const closingOverdraft = Math.max(0, -closingBankBalance);
  const overdraftChange = closingOverdraft - openingOverdraft;
  amounts.financing += overdraftChange;
  const openingCash = Math.max(0, openingBankBalance);
  const closingCash = Math.max(0, closingBankBalance);
  const netChange = amounts.operating + amounts.investing + amounts.financing;
  return { ...amounts, overdraftChange, netChange, openingCash, closingCash,
    reconciles: openingCash + netChange === closingCash };
}

function closeProfitAndLoss(state, profit) {
  const accounting = ensureAccounting(state);
  const lines = [];
  CHART_OF_ACCOUNTS.filter((account) => ["income", "contra-income", "expense"].includes(account.type)).forEach((account) => {
    const value = amountOn(accounting, account.code);
    if (!value) return;
    if (value < 0) lines.push({ account: account.code, debit: -value });
    else lines.push({ account: account.code, credit: value });
  });
  if (profit > 0) lines.push({ account: "3100", credit: profit });
  else if (profit < 0) lines.push({ account: "3100", debit: -profit });
  if (lines.length) postJournal(state, "月結｜本期損益轉入保留盈餘", lines);
}

export function closeMonthlyStatements(state, endDay) {
  const accounting = ensureAccounting(state);
  const startDay = accounting.periodStartDay;
  const entries = accounting.journal.filter((entry) => entry.day >= startDay && entry.day <= endDay && !entry.opening);
  const openingCash = Number(accounting.periodOpeningBalances["1000"]) || 0;
  const pl = profitAndLoss(accounting);
  const position = statementOfFinancialPosition(accounting, pl.profit);
  const revenue = pl.totalRevenue - pl.contra;
  const expenses = Object.values(pl.expenses).reduce((sum, value) => sum + value, 0) + pl.contra;
  const equityOpening = -((Number(accounting.periodOpeningBalances["3000"]) || 0) + (Number(accounting.periodOpeningBalances["3100"]) || 0));
  const report = {
    period: Math.floor((endDay - 1) / 30) + 1,
    startDay, endDay,
    comprehensiveIncome: {
      revenue: pl.totalRevenue, returns: pl.contra, netRevenue: revenue,
      operatingExpenses: pl.operatingExpenses, operatingProfit: pl.operatingIncome,
      financeCosts: pl.financeCosts, incomeTax: pl.tax, profit: pl.profit,
      otherComprehensiveIncome: 0, totalComprehensiveIncome: pl.profit,
      expenseBreakdown: pl.expenses
    },
    equityChanges: { openingCapital: Math.max(0, -(Number(accounting.periodOpeningBalances["3000"]) || 0)),
      capitalContributions: 0, openingRetainedEarnings: Math.max(0, -(Number(accounting.periodOpeningBalances["3100"]) || 0)),
      comprehensiveIncome: pl.profit, drawings: 0, openingEquity: equityOpening, closingEquity: equityOpening + pl.profit },
    financialPosition: position,
    cashFlow: cashFlowStatement(entries, openingCash, amountOn(accounting, "1000")),
    totals: { revenue, expenses, profit: pl.profit }
  };
  report.financialPosition.balanced = report.financialPosition.assets.total === report.financialPosition.totalLiabilitiesAndEquity;
  accounting.monthlyReports.push(report);
  if (accounting.monthlyReports.length > 36) accounting.monthlyReports.splice(0, accounting.monthlyReports.length - 36);
  closeProfitAndLoss(state, pl.profit);
  accounting.periodStartDay = endDay + 1;
  accounting.periodOpeningBalances = copyBalances(accounting.balances);
  return report;
}

export function formatBalance(value) {
  const amount = Math.round(Number(value) || 0);
  return (amount < 0 ? "−NT$ " : "NT$ ") + Math.abs(amount).toLocaleString("zh-TW");
}

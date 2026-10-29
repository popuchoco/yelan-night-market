export function createReportRenderer(runtime) {
  const {
    state, dishes, CHART_OF_ACCOUNTS, formatBalance, CAMPAIGN_CALENDAR, CAMPAIGN_DAYS, WEEKLY_DECISION_DAYS,
    campaignCycleDay, money, moneyNet, ledger, el, append, fragment, subhead, helper, storyCard, button,
    getJournalView, getReportStatement, getSelectedJournalDay, getSelectedReportPeriod, getSelectedWeek, getSelectedMonthEnd
  } = runtime;

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
    const day = completedDays.includes(Number(getSelectedJournalDay())) ? Number(getSelectedJournalDay()) : completedDays[0];
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
      if (narrative.promotionOutcome) story.append(el("p", "", "宣傳結果：" + narrative.promotionOutcome));
      if (narrative.closingEvents?.length) narrative.closingEvents.forEach((event) => story.append(el("p", "", "打烊事件：" + event.message)));
      if (narrative.safetyIncident) {
        const incident = narrative.safetyIncident;
        story.append(el("p", "", "安全事件：" + incident.title + "・處置 " + money(incident.expense) +
          (incident.claim ? "・理賠應收 " + money(incident.claim) : "・店家自行負擔")));
      }
      if (narrative.recipesUnlocked?.length) {
        const names = narrative.recipesUnlocked.map((id) => dishes.find((dish) => dish.id === id)?.name).filter(Boolean);
        if (names.length) story.append(el("p", "", "熟客秘笈／升級菜色免費解鎖：" + names.join("、")));
      }
      if (narrative.guests?.length) story.append(el("p", "", "來客：" + narrative.guests.join("、")));
      parts.push(story);
    }
    return fragment(parts);
  }

  function renderWeeklyWorksheet() {
    const reports = state.accounting?.weeklyReports || [];
    if (!reports.length) return fragment(subhead("每週工作底稿", "第七夜打烊後產生", true),
      storyCard("第一份週底稿尚未結帳。", "完成第 7 夜後，系統會整理試算表、借貸發生額與期末餘額。"));
    const report = reports.find((item) => item.id === getSelectedWeek()) || reports[reports.length - 1];
    const select = filterSelect("工作週", "week-report", reports.slice().reverse().map((item) => ({
      value: item.id, label: item.periodEnd ? "第 " + item.period + " 期末工作底稿・第 " + item.startDay + "–" + item.endDay + " 夜" : "第 " + item.week + " 週・第 " + item.startDay + "–" + item.endDay + " 夜"
    })), report.id);
    const rows = report.rows.map((row) => [row.code + " " + row.name,
      formatBalance(row.opening), formatBalance(row.debit), formatBalance(row.credit),
      row.closingDebit ? formatBalance(row.closingDebit) : "—",
      row.closingCredit ? formatBalance(row.closingCredit) : "—"]);
    const parts = [
      subhead(report.periodEnd ? "期末調整工作底稿" : "每週工作底稿", report.periodEnd ? "第 " + report.period + " 期・第 " + report.endDay + " 夜" : "第 " + report.week + " 週・第 " + report.startDay + "–" + report.endDay + " 夜", true),
      select,
      ...(report.periodEnd ? [storyCard("孤兒保單期末調整", "本期將 " + (report.insuranceAdjustment?.count || 0) + " 筆離職保單，未到期保費共 " + money(report.insuranceAdjustment?.amount || 0) + " 調整為應收保險退費款；次期首夜自動收回並沖銷應收。") ] : []),
      el("div", "statement-status " + (report.balanced ? "balanced" : "unbalanced"),
        report.balanced ? "借貸試算平衡" : "借貸差額待核對"),
      accountingTable(report.periodEnd ? "第 " + report.period + " 期期末調整試算表" : "第 " + report.week + " 週試算表", ["會計科目", "期初餘額", "借方發生", "貸方發生", "期末借方", "期末貸方"], rows),
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
        ["應收保險退費款", formatBalance(f.assets.insuranceReceivables || 0)],
        ["應收保險理賠款", formatBalance(f.assets.insuranceClaimReceivables || 0)],
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
    const report = reports.find((item) => item.period === Number(getSelectedReportPeriod())) || reports[reports.length - 1];
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
        "statement-picker-button" + (getReportStatement() === id ? " active" : ""));
      choice.setAttribute("aria-pressed", String(getReportStatement() === id));
      statementTabs.append(choice);
    });
    const title = { income: "綜合損益表", equity: "權益變動表", position: "資產負債表", cashflow: "現金流量表" }[getReportStatement()];
    const rows = statementRows(report, getReportStatement());
    const parts = [
      subhead(title, "第 " + report.period + " 期・第 " + report.startDay + "–" + report.endDay + " 夜", true),
      summary, select, statementTabs,
      accountingTable(title + "・第 " + report.period + " 期", ["IFRS 導向報表項目", "金額"], rows)
    ];
    if (getReportStatement() === "position") parts.push(el("div", "statement-status " + (report.financialPosition.balanced ? "balanced" : "unbalanced"),
      report.financialPosition.balanced ? "資產 = 負債 + 權益" : "財務狀況表有差額，請檢查分錄"));
    if (getReportStatement() === "cashflow") parts.push(el("div", "statement-status " + (report.cashFlow.reconciles ? "balanced" : "unbalanced"),
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
      if (entry.promotionOutcome) item.append(el("p", "", "宣傳結果：" + entry.promotionOutcome));
      if (entry.closingEvents?.length) entry.closingEvents.forEach((event) => item.append(el("p", "", "打烊事件：" + event.message)));
      if (entry.safetyIncident) item.append(el("p", "", "安全事件：" + entry.safetyIncident.title + "・處置 " +
        money(entry.safetyIncident.expense) + (entry.safetyIncident.claim ? "・理賠應收 " + money(entry.safetyIncident.claim) : "・店家自行負擔")));
      if (entry.recipesUnlocked?.length) {
        const names = entry.recipesUnlocked.map((id) => dishes.find((dish) => dish.id === id)?.name).filter(Boolean);
        if (names.length) item.append(el("p", "", "免費解鎖：" + names.join("、")));
      }
      if (entry.guests?.length) item.append(el("p", "", entry.guests.join("、")));
      parts.push(item);
    });
    return fragment(parts);
  }

  const journalReports = {
    daily: { title: "前一日日記簿", description: "逐筆查看借貸分錄與當夜營運手記。", icon: "◷" },
    weekly: { title: "每週工作底稿", description: "檢視試算平衡、借貸發生額與期末餘額。", icon: "▤" },
    monthEnd: { title: "期末調整底稿", description: "每 30 夜整理孤兒保單、應收退費與調整分錄。", icon: "⊞" },
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
    if (view === "monthEnd") return accounting.monthEndWorksheets?.length
      ? "已結帳 " + accounting.monthEndWorksheets.length + " 期" : "每期第 30 夜產生";
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
    return journalReports[getJournalView()] || journalReports.daily;
  }

  function renderJournalReport() {
    const view = {
      daily: renderDailyJournal,
      weekly: renderWeeklyWorksheet,
      monthEnd: renderMonthEndWorksheet,
      monthly: renderMonthlyStatements,
      chart: renderChartOfAccounts,
      stories: renderStoryJournal
    }[getJournalView()] || renderDailyJournal;
    return view();
  }

  function renderMonthEndWorksheet() {
    const reports = state.accounting?.monthEndWorksheets || [];
    if (!reports.length) return fragment(subhead("期末調整工作底稿", "每 30 夜結帳", true),
      storyCard("尚未到第一期期末。", "第 30 夜會整理離職員工的孤兒保單，將未到期雇主保費調整為應收款，並與期末試算一併歸檔。"));
    const report = reports.find((item) => item.id === getSelectedMonthEnd()) || reports[reports.length - 1];
    const select = filterSelect("期末底稿", "month-end-report", reports.slice().reverse().map((item) => ({
      value: item.id, label: "第 " + item.period + " 期・第 " + item.endDay + " 夜"
    })), report.id);
    const rows = report.rows.map((row) => [row.code + " " + row.name,
      formatBalance(row.opening), formatBalance(row.debit), formatBalance(row.credit),
      row.closingDebit ? formatBalance(row.closingDebit) : "—", row.closingCredit ? formatBalance(row.closingCredit) : "—"]);
    const adjustment = report.insuranceAdjustment || { count: 0, amount: 0 };
    return fragment(
      subhead("期末調整工作底稿", "第 " + report.period + " 期・第 " + report.startDay + "–" + report.endDay + " 夜", true),
      select,
      storyCard("孤兒保單・應收款調整", "本期整理 " + adjustment.count + " 筆離職保單，未到期保費 " + money(adjustment.amount) + "；借記「應收保險退費款」、貸記相關保險費用，次期首夜收到退款時沖銷應收。"),
      el("div", "statement-status " + (report.balanced ? "balanced" : "unbalanced"), report.balanced ? "借貸試算平衡" : "借貸差額待核對"),
      accountingTable("第 " + report.period + " 期末調整試算底稿", ["會計科目", "期初餘額", "借方發生", "貸方發生", "期末借方", "期末貸方"], rows),
      ledger([
        { label: "本期孤兒保單數", value: String(adjustment.count) + " 筆" },
        { label: "本期認列應收保險退費", value: formatBalance(adjustment.amount) },
        { label: "期末試算借方合計", value: formatBalance(report.trialDebit) },
        { label: "期末試算貸方合計", value: formatBalance(report.trialCredit) }
      ])
    );
  }


  return { renderJournal, getJournalReportInfo, renderJournalReport };
}

export function createPreparationRenderer(dependencies) {
  const {
    state, ingredients, equipment, staffRoles, dishes, upgrades,
    el, append, fragment, button, subhead, helper, ledger, managerItem, money, formatBalance, staffCost,
    getPurchasePrice, getUnlockedDishes, renderTierPlanning, renderBranchSafety,
    getOutletTier, getMonthlyInsurance, getOutletEmployeeCount, insuranceDueLabel
  } = dependencies;
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
    const available = getUnlockedDishes(state);
    available.forEach(function(entry) {
      const dish = entry.dish;
      const index = entry.index;
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
    const locked = dishes.filter((dish) => !state.unlockedRecipes.includes(dish.id));
    if (locked.length) {
      const details = el("details", "locked-recipes");
      const summary = el("summary", "", "尚未解鎖的家鄉菜與升級食譜（" + locked.length + "）");
      details.append(summary);
      locked.forEach(function(dish) {
        const condition = dish.secretFor ? "熟客回訪並滿意時，可能分享免費秘笈" :
          (dish.unlockTier === "fixed" ? "主店升級為固定攤販時免費解鎖" : "主店升級為大排檔時免費解鎖");
        details.append(el("p", "locked-recipe-row", dish.icon + " " + dish.name + "｜" + condition));
      });
      parts.push(details);
    }
    const discoveries = Array.isArray(state.recipeLog) ? state.recipeLog.slice(-3).reverse() : [];
    if (discoveries.length) {
      const note = el("div", "recipe-discovery-log");
      note.append(el("b", "", "最近解鎖"));
      discoveries.forEach(function(entry) {
        const dish = dishes.find((item) => item.id === entry.recipeId);
        if (dish) note.append(el("span", "", "第 " + entry.day + " 夜・" + dish.name + "（NT$ 0）"));
      });
      parts.push(note);
    }
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
    parts.push(grid, renderTierPlanning());
    const branchSafety = renderBranchSafety();
    if (branchSafety) parts.push(branchSafety);
    parts.push(subhead("夜市設備升級", "打造熟客的理由"));
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
      parts.push(helper("目前還沒有資本化資產；購買爐台／設備、店面裝修或擴店後，會在此建立獨立資產卡並按耐用年限提列折舊。"));
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
    if (Number(state.hiredCrew) > 0) {
      const releaseCard = el("section", "staff-release-card");
      append(releaseCard, el("b", "", "全職夥伴異動"),
        helper("可在營業前或每週決策時辦理一位額外全職夥伴離職。若本期已繳雇主保費，未到期部分先掛應收、期末工作底稿調整，次期首夜收款。", "manager-note"),
        button("辦理一位夥伴離職", "release-crew-member", {}, state.phase === "service" || state.phase === "report", "danger-button"));
      parts.push(releaseCard);
    }
    parts.push(subhead("員工與營業保險", "每期首夜入帳", true));
    parts.push(helper("保費屬本專案的簡化遊戲參數；每 30 夜為一期，在第 1、31、61 夜等首夜開門時一次扣款並依保險科目入帳。", "helper-copy accounting-note"));
    (state.outlets || []).forEach((outlet) => {
      const tier = getOutletTier(outlet);
      const insurance = getMonthlyInsurance(state, outlet);
      const card = el("article", "insurance-card");
      const head = el("div", "insurance-card-head");
      append(head, el("h4", "", outlet.name), el("span", "tier-plan-badge", tier.name));
      card.append(head);
      const employees = getOutletEmployeeCount(state, outlet);
      card.append(el("p", "insurance-summary", employees + " 位聘用人員・" + (insurance.mandatoryEmployerCoverage
        ? "雇主負擔職災、勞保與健保" : "基本保險由員工自行安排")));
      card.append(ledger([
        { label: "職業災害保險", value: money(insurance.accident) },
        { label: "雇主勞保", value: money(insurance.labor) },
        { label: "雇主健保", value: money(insurance.health) },
        { label: "食品業者產品責任險", value: money(insurance.product) },
        { label: "公共意外責任險", value: money(insurance.public) }
      ], { label: "每期預估保費・" + insuranceDueLabel(), value: money(insurance.total), negative: false }));
      (state.orphanPolicies || []).filter((policy) => policy.outletId === outlet.id && policy.status !== "collected").forEach((policy) => {
        const status = policy.status === "pending-adjustment" ? "期末工作底稿待調整應收" : "應收款待次期首夜收回";
        card.append(el("p", "insurance-orphan", "孤兒保單・" + policy.employeeName + "｜未到期保費 " + money(policy.refundAmount) + "｜" + status));
      });
      if (tier.id !== "dapaidang") {
        const accidentNote = outlet.accidentCoverage ? "雇主已加保職災" : "目前員工自行安排基本保險";
        card.append(el("p", "insurance-summary", accidentNote + "；固定攤販餐飲業另含產品責任險。"));
        card.append(button(outlet.accidentCoverage ? "取消雇主職災加保" : "為正職加保職災",
          "toggle-accident-coverage", { outletId: outlet.id }, state.phase !== "prep" || (!outlet.accidentCoverage && employees <= 0), "manager-action"));
      } else {
        card.append(el("p", "insurance-summary", "大排檔需加保公共意外責任險；雇主職災、勞保與健保為強制配置。"));
      }
      parts.push(card);
    });
    return fragment(parts);
  }
  return { renderStock, renderEquipment, renderStaff };
}

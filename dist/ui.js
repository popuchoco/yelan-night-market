import { DATA } from "./data.js";
import { createLedger as createLedgerForState, forecast, getFoodCost as getFoodCostForState, getPurchasePrice as getPurchasePriceForState, getTonightGuests as getTonightGuestsForState, ledgerIncome, ledgerNet, money, staffCost as staffCostForState, todayEvent as selectEvent, todayStory as selectStory } from "./state.js";

export function createUI(runtime) {
  const { state, saveState } = runtime;
  const { dishes, ingredients: ingredientData, equipment: equipmentData, staff: staffRoles, upgrades: upgradeData } = DATA;
  var activeTab = "ops";
  function setTab(tab) { activeTab = tab; }
  function todayEvent() { return selectEvent(state); }
  function todayStory() { return selectStory(state); }
  function getTonightGuests() { return getTonightGuestsForState(state); }
  function staffCost() { return staffCostForState(state); }
  function getPurchasePrice(item) { return getPurchasePriceForState(state, item); }
  function getFoodCost(dish) { return getFoodCostForState(state, dish); }
  function createLedger() { return createLedgerForState(state); }

      function renderOverview() {
        var e=todayEvent(), f=forecast(state), panel="";
        if(state.day===3) panel+='<aside class="guide-card"><b>新手小抄</b><span>先到「攤位」補食材、調班表；開門後點擊發光客人接單。遇到客訴可選擇安撫、招待或退款，打烊再選一段手記。</span></aside>';
        panel+='<article class="event-card '+(e.tone==="negative"?"negative":"")+'"><div class="event-icon">'+e.icon+'</div><div class="event-copy"><div class="event-label">TONIGHT IN THE MARKET</div><div class="event-name">'+e.name+'</div><div class="event-desc">'+e.description+'</div></div></article>';
        panel+='<div class="subhead"><h3>'+(state.phase==="prep"?"開門前損益預估":"今晚營運帳本")+'</h3><span>'+String(f.guests.length).padStart(2,"0")+' 桌客流</span></div>';
        if(state.phase==="prep") {
          panel+='<div class="ledger-card"><div class="ledger-line"><span>攤位租金</span><b>−'+money(f.ledger.rent)+'</b></div><div class="ledger-line"><span>排班薪資</span><b>−'+money(f.ledger.labor)+'</b></div><div class="ledger-line"><span>電費 / 瓦斯</span><b>−'+money(f.ledger.electricity+f.ledger.gas)+'</b></div><div class="ledger-line outflow"><span>預估食材耗用</span><b>−'+money(f.food)+'</b></div><div class="ledger-line income"><span>預估小費 / 活動 Bonus</span><b>+'+money(f.tips+f.bonus)+'</b></div><div class="ledger-net"><span>預估營業淨額</span><b class="'+(f.net<0?"negative":"")+'">'+(f.net<0?"−":"+")+money(Math.abs(f.net))+'</b></div></div>';
          panel+='<p class="helper-copy">租金、人事與能源在開門時扣款；食材採購先扣現金，實際耗用按庫存成本入帳。</p>';
          panel+='<div class="subhead"><h3>開門前快速檢查</h3><span>一切準備好了嗎？</span></div>';
          panel+='<div class="guest-list"><div class="guest-row"><span class="guest-avatar">🥬</span><span class="guest-info"><span class="guest-name">備料現況</span><span class="guest-need">雞湯 '+(state.stock.chicken||0)+' · 海味 '+(state.stock.seafood||0)+' · 茶點 '+(state.stock.tea||0)+'</span></span><span class="guest-status">'+(f.paying)+' 桌</span></div>';
          panel+='<div class="guest-row"><span class="guest-avatar">👥</span><span class="guest-info"><span class="guest-name">今晚班表</span><span class="guest-need">'+staffRoles.filter(function(p){return state.staff[p.id];}).map(function(p){return p.name;}).join("、")+' '+(staffCost()?"已排":"由老闆代班")+'</span></span><span class="guest-status">'+money(staffCost())+'</span></div></div>';
          panel+='<div class="button-row"><button class="secondary-button" data-action="panel-tab" data-tab="stock">🥬 補備食材</button><button class="secondary-button" data-action="panel-tab" data-tab="staff">👥 調整班表</button></div>';
          panel+='<div class="button-row"><button class="primary-button full-width" data-action="open-doors">🏮 掛燈迎客，開始營業</button></div>';
        } else if(state.phase==="service") {
          var guests=getTonightGuests(), active=guests[state.customerIndex];
          panel+='<div class="ledger-card"><div class="ledger-line income"><span>餐點營收</span><b>+'+money(state.ledger.sales)+'</b></div><div class="ledger-line income"><span>小費 / 活動</span><b>+'+money(state.ledger.tips+state.ledger.bonus)+'</b></div><div class="ledger-line outflow"><span>食材耗用</span><b>−'+money(state.ledger.food)+'</b></div><div class="ledger-line"><span>固定支出已扣</span><b>−'+money(state.ledger.rent+state.ledger.labor+state.ledger.electricity+state.ledger.gas)+'</b></div></div>';
          panel+='<div class="subhead"><h3>正在排隊的客人</h3><span>點場景裡發光的人接單</span></div><div class="guest-list">';
          guests.forEach(function(g,i){
            var current=i===state.customerIndex, done=i<state.customerIndex;
            panel+='<div class="guest-row '+(current?"current":"")+'"><span class="guest-avatar">'+g.icon+'</span><span class="guest-info"><span class="guest-name">'+g.name+'</span><span class="guest-need">'+g.needLabel+'</span></span><span class="guest-status '+(current?"current":"")+'">'+(done?"已招待":(current?"輪到他":"排隊中"))+'</span></div>';
          });
          panel+='</div>';
          if(active) panel+='<div class="button-row"><button class="primary-button full-width" data-action="call-next">'+(active.difficult?"處理現場客訴":"接待 "+active.name+" 點餐")+'　→</button></div><p class="helper-copy">在斜俯視場景點擊正在發光的客人，也能直接打開點餐 / 客訴處理。</p>';
          panel+='<div class="subhead"><h3>營業中的場景事件</h3><span>已服務 '+state.customerIndex+' / '+guests.length+' 桌</span></div><p class="helper-copy">店員會在櫃台後移動，客人走向櫃台並依序排隊；火爐、煙霧、雨勢與燈節光點都在夜市裡即時演出。</p>';
        } else {
          var net=ledgerNet(state.ledger||createLedger());
          panel+='<div class="story-card"><h3>打烊結算 · 第 '+String(state.day).padStart(2,"0")+' 夜</h3><p>'+(net>=0?"今晚有把利潤留在小店。":"今晚先把人情與開銷記好。")+' '+e.name+'。總收入 '+money(ledgerIncome(state.ledger))+'；食材耗用 '+money(state.ledger.food)+'；固定成本 '+money(state.ledger.rent+state.ledger.labor+state.ledger.electricity+state.ledger.gas)+'。庫存採購 '+money(state.ledger.purchase)+' 是現金流，已入庫部分不重複列為耗用。</p><div class="ledger-net"><span>今晚營業淨額</span><b class="'+(net<0?"negative":"")+'">'+(net<0?"−":"+")+money(Math.abs(net))+'</b></div></div>';
          panel+='<div class="subhead"><h3>今晚的小小岔路</h3><span>選一個帶去明晚的心意</span></div><div class="story-card"><h3>'+todayStory().icon+'　'+todayStory().title+'</h3><p>'+todayStory().text+'</p>';
          panel+='<div class="button-row"><button class="secondary-button" data-action="choose-story" data-id="paperboat" '+(state.reportChoice?"disabled":"")+'>把紙船放回港灣　+2 口碑</button><button class="secondary-button" data-action="choose-story" data-id="window" '+(state.reportChoice?"disabled":"")+'>替熟客留桌　+NT$ 80</button></div></div>';
          panel+='<div class="button-row"><button class="primary-button full-width" data-action="next-night" '+(!state.reportChoice?"disabled":"")+'>收進手記，準備明晚　→</button></div>';
        }
        return panel;
      }
      function renderStock() {
        return '<div class="subhead compact"><h3>備料櫃・即時庫存</h3><span>補貨只在開門前</span></div><p class="helper-copy manager-intro">買進時扣現金，售出時才將該份食材列為耗用成本；供應行情會改變本夜進貨價。</p><div class="manager-grid">'+ingredientData.map(function(item){
          var qty=Number(state.stock[item.id])||0, cost=Number(state.stockCost[item.id])||item.cost, price=getPurchasePrice(item);
          return '<article class="manager-item"><span class="manager-icon">'+item.icon+'</span><span class="manager-copy"><span class="manager-name">'+item.name+'</span><span class="manager-note">配方：'+item.recipe+'</span><span class="manager-meta">現有 <b>'+qty+' 份</b> · 平均成本 '+money(cost)+'</span></span><button class="manager-action" data-action="buy-stock" data-id="'+item.id+'" '+(state.phase!=="prep"||state.coins<price?"disabled":"")+'>補 1 份<br>'+money(price)+'</button></article>';
        }).join("")+'</div><div class="subhead"><h3>今晚菜單</h3><span>選一道招牌拿額外小費</span></div>'+dishes.map(function(dish,index){
          return '<div class="manager-item"><span class="manager-icon">'+dish.icon+'</span><span class="manager-copy"><span class="manager-name">'+dish.name+'</span><span class="manager-note">'+dish.line+'</span><span class="manager-meta">售價 <b>'+money(dish.price)+'</b> · 庫存 '+(state.stock[dish.ingredient]||0)+'</span></span><button class="manager-action" data-action="select-dish" data-index="'+index+'" '+(state.phase!=="prep"?"disabled":"")+'>'+(state.selectedDish===index?"今晚招牌":"設為招牌")+'</button></div>';
        }).join("");
      }
      function renderEquipment() {
        var html='<div class="subhead compact"><h3>爐台與攤位設備</h3><span>升級提升效率</span></div><p class="helper-copy manager-intro">設備是一次性投資，營業中不能施工。等級也會直接反映在 2.5D 攤位模型上。</p><div class="manager-grid">';
        html+=equipmentData.map(function(item){
          var level=Math.max(0,Math.min(item.costs.length,Number(state.equipment[item.id])||0)),price=item.costs[level];
          return '<article class="manager-item"><span class="manager-icon">'+item.icon+'</span><span class="manager-copy"><span class="manager-name">'+item.name+' · Lv.'+level+'</span><span class="manager-note">'+item.note+'</span><span class="manager-meta"><b>'+'●'.repeat(level)+'○'.repeat(item.costs.length-level)+'</b> · 最高 '+item.costs.length+' 級</span></span><button class="manager-action" data-action="upgrade-equipment" data-id="'+item.id+'" '+(state.phase!=="prep"||typeof price!=="number"||state.coins<price?"disabled":"")+'>'+(price?"升級 "+money(price):"已滿級")+'</button></article>';
        }).join("");
        html+='</div><div class="subhead"><h3>夜市改造</h3><span>打造熟客的理由</span></div>';
        html+=upgradeData.map(function(item){
          var owned=!!state.upgrades[item.id];
          return '<article class="manager-item"><span class="manager-icon">'+item.icon+'</span><span class="manager-copy"><span class="manager-name">'+item.name+(owned?" · 已添置":"")+'</span><span class="manager-note">'+item.note+'</span></span><button class="manager-action" data-action="buy-upgrade" data-id="'+item.id+'" '+(owned||state.phase!=="prep"||state.coins<item.cost?"disabled":"")+'>'+(owned?"已擁有":money(item.cost))+'</button></article>';
        }).join("");
        return html;
      }
      function renderStaff() {
        return '<div class="subhead compact"><h3>今晚班表</h3><span>開門後鎖定</span></div><p class="helper-copy manager-intro">排班會列入當夜人事成本；老闆可自行代班，但服務小費和節奏會變慢。</p><div class="manager-grid">'+staffRoles.map(function(person){
          var assigned=!!state.staff[person.id];
          return '<article class="manager-item"><span class="manager-icon">'+person.icon+'</span><span class="manager-copy"><span class="manager-name">'+person.name+' · '+person.role+'</span><span class="manager-note">'+(assigned?"穩定服務、完整小費":"老闆代班，服務表現下降")+'</span><span class="manager-meta">每夜薪資 <b>'+money(person.wage)+'</b></span></span><button class="manager-action" data-action="toggle-staff" data-role="'+person.id+'" '+(state.phase!=="prep"?"disabled":"")+'>'+(assigned?"取消排班":"加入班表")+'</button></article>';
        }).join("")+'</div><div class="subhead"><h3>人事預算</h3><span>單夜支出</span></div><div class="ledger-card"><div class="ledger-line"><span>阿滿・廚房主廚</span><b>'+(state.staff.cook?money(staffRoles.find(function(person){return person.id==="cook";}).wage):"老闆代班")+'</b></div><div class="ledger-line"><span>小青・外場服務</span><b>'+(state.staff.server?money(staffRoles.find(function(person){return person.id==="server";}).wage):"老闆代班")+'</b></div><div class="ledger-net"><span>今晚排班薪資</span><b>'+money(staffCost())+'</b></div></div>';
      }
      function renderJournal() {
        if(!state.journal.length) return '<div class="story-card"><h3>港邊手記還是空白的。</h3><p>完成一晚營業、招待客人，並做一個打烊後的小決定，第一段故事就會留在這裡。</p></div>';
        return '<div class="subhead compact"><h3>夜市營運手記</h3><span>最近 '+state.journal.length+' 夜</span></div>'+state.journal.map(function(entry){
          return '<article class="story-card journal-entry"><h3>第 '+String(entry.day).padStart(2,"0")+' 夜 · '+entry.event+'</h3><p><b>'+entry.title+'</b><br>'+entry.choice+' · 淨額 '+(entry.net<0?"−":"+")+money(Math.abs(entry.net))+'<br>'+entry.guests.join("、")+'</p></article>';
        }).join("");
      }
      function renderUI() {
        var event=todayEvent();
        document.getElementById("dayValue").textContent=String(state.day).padStart(2,"0");
        document.getElementById("coinsValue").textContent=money(state.coins);
        document.getElementById("fameValue").textContent=String(state.fame);
        document.getElementById("regularValue").textContent=String(state.regulars).padStart(2,"0")+" / 24";
        document.getElementById("phaseLabel").textContent=state.phase==="prep"?"準備中":(state.phase==="service"?"營業中":"已打烊");
        document.getElementById("panelPhase").textContent=state.phase==="prep"?"準備時段":(state.phase==="service"?"現場營業":"打烊結算");
        document.querySelector(".world-title").textContent=state.phase==="prep"?"潮聲近了，準備開門嗎？":(state.phase==="service"?"燈火亮起，巷口正湧進人潮。":"今晚的帳本，記下了你的選擇。");
        var worldState=document.getElementById("worldState");
        worldState.classList.toggle("open",state.phase==="service");
        document.getElementById("worldStateText").textContent=state.phase==="prep"?"備料與排班中":(state.phase==="service"?"客人走進夜市・營業中":"這一夜已打烊");
        document.getElementById("mainAction").textContent=state.phase==="prep"?"掛燈迎客　→":(state.phase==="service"?"接待下一桌　→":"準備明晚　→");
        document.getElementById("mainAction").dataset.action="main-action";
        document.querySelectorAll(".panel-tab").forEach(function(tab){tab.classList.toggle("active",tab.dataset.tab===activeTab);});
        var titles={ops:"今晚營運",stall:"攤位工作台",stock:"備料與菜單",equipment:"設備與改造",staff:"人員排班",journal:"港邊手記"};
        document.getElementById("panelHeading").textContent=titles[activeTab]||titles.ops;
        var content=activeTab==="ops"?renderOverview():(activeTab==="stall"?renderStall():(activeTab==="stock"?renderStock():(activeTab==="equipment"?renderEquipment():(activeTab==="staff"?renderStaff():renderJournal()))));
        document.getElementById("panelContent").innerHTML=content;
         document.getElementById("saveLabel").textContent = saveState(state) ? "進度已儲存" : "瀏覽器未保存進度";
      }

  function renderStall() {
    var f = forecast(state);
    var staffNames = staffRoles.filter(function(person) { return state.staff[person.id]; }).map(function(person) { return person.name; });
    var equipmentLevel = equipmentData.reduce(function(sum, item) { return sum + (Number(state.equipment[item.id]) || 0); }, 0);
    return '<div class="subhead compact"><h3>夜嵐攤號・工作台</h3><span>第 ' + String(state.day).padStart(2, "0") + ' 夜</span></div>' +
      '<div class="stall-summary-grid"><article class="stall-summary"><span>🥬</span><b>' + (state.stock.chicken || 0) + ' / ' + (state.stock.seafood || 0) + ' / ' + (state.stock.tea || 0) + '</b><small>雞湯・海味・茶點庫存</small></article>' +
      '<article class="stall-summary"><span>⚒</span><b>' + equipmentLevel + ' 級</b><small>設備總升級數</small></article>' +
      '<article class="stall-summary"><span>👥</span><b>' + (staffNames.join("、") || "老闆代班") + '</b><small>今晚值班人員</small></article></div>' +
      '<div class="ledger-card"><div class="ledger-line"><span>攤位租金</span><b>' + money(f.ledger.rent) + '</b></div><div class="ledger-line"><span>人事成本</span><b>' + money(f.ledger.labor) + '</b></div><div class="ledger-line"><span>水電瓦斯</span><b>' + money(f.ledger.electricity + f.ledger.gas) + '</b></div><div class="ledger-net"><span>目前預估淨額</span><b class="' + (f.net < 0 ? "negative" : "") + '">' + (f.net < 0 ? "−" : "+") + money(Math.abs(f.net)) + '</b></div></div>' +
      '<p class="helper-copy">攤位工作台整合每日營運。開門前可調整備料、設備與班表；開門後，採購與施工會鎖定。</p>' +
      '<div class="stall-actions"><button class="secondary-button" data-action="panel-tab" data-tab="stock">🥬 管理備料與菜單 →</button><button class="secondary-button" data-action="panel-tab" data-tab="equipment">⚒ 管理設備 →</button><button class="secondary-button" data-action="panel-tab" data-tab="staff">👥 管理排班 →</button></div>' +
      '<button class="primary-button full-width" data-action="main-action">' + (state.phase === "prep" ? "🏮 掛燈迎客，開始營業" : (state.phase === "service" ? "接待下一桌　→" : "查看今晚結算")) + '</button>';
  }

  function renderOrderChoices(guest) {
    if (guest.difficult) {
      return '<div class="subhead"><h3>選擇客訴處理方式</h3><span>會記進口碑與帳本</span></div><div class="complaint-options"><button class="secondary-button" data-action="resolve-complaint" data-choice="calm">耐心說明<b>不花錢・口碑 −1</b></button><button class="secondary-button" data-action="resolve-complaint" data-choice="snack">招待小菜<b>−' + money(DATA.economy.complaintSnackCost) + '・口碑回升</b></button><button class="danger-button" data-action="resolve-complaint" data-choice="refund">退還部分餐費<b>退款 −' + money(DATA.economy.complaintRefund) + '</b></button></div>';
    }
    return '<div class="subhead"><h3>替客人挑一道餐點</h3><span>推薦會多留小費</span></div><div class="dish-choice-grid">' + dishes.map(function(dish) {
      var good = dish.need.indexOf(guest.need) !== -1, available = Number(state.stock[dish.ingredient]) > 0;
      return '<button class="dish-choice ' + (good ? "recommended" : "") + '" data-action="serve-dish" data-id="' + dish.id + '" ' + (!available ? "disabled" : "") + '><span class="dish-choice-icon">' + dish.icon + '</span><span class="dish-choice-copy"><span class="dish-choice-name">' + dish.name + (good ? " · 投其所好" : "") + '</span><span class="dish-choice-note">' + dish.line + ' · 庫存 ' + (state.stock[dish.ingredient] || 0) + ' · 食材 ' + money(getFoodCost(dish)) + '</span></span><span class="dish-choice-price">' + money(dish.price) + '</span></button>';
    }).join("") + '</div>';
  }

  function setTabAndRender(tab) { setTab(tab); renderUI(); }
  return { renderUI: renderUI, renderOrderChoices: renderOrderChoices, setTab: setTab, setTabAndRender: setTabAndRender, getTab: function() { return activeTab; } };
}

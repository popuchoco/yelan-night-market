import { DATA } from "./data.js";

export const CAMPAIGN_DAYS = 30;
export const WEEKLY_DECISION_DAYS = Object.freeze([8, 15, 22, 29]);

export function campaignCycleDay(day) {
  const value = Math.max(1, Math.floor(Number(day) || 1));
  return ((value - 1) % CAMPAIGN_DAYS) + 1;
}

export function isWeeklyDecisionDay(day) {
  const value = Math.max(1, Math.floor(Number(day) || 1));
  return value > 1 && (value - 1) % 7 === 0;
}

// Short, optional market announcements add a second strategic layer to the
// nightly event without turning the campaign into a board-game round system.
export const MARKET_CARDS = Object.freeze({
  "tourist-surge": {
    id: "tourist-surge", name: "觀光客暴增", icon: "🧳", tone: "positive",
    description: "旅行團臨時抵港。加開接待宣傳可多帶兩桌客人，但需要先支付行銷費。",
    choices: [
      { id: "promote", name: "加開觀光接待", detail: "行銷 −NT$ " + DATA.economy.touristPromotionCost + "・多 2 桌客人・口碑 +1", cost: DATA.economy.touristPromotionCost },
      { id: "pass", name: "維持原班營運", detail: "不增加成本或客流", cost: 0 }
    ]
  },
  "hygiene-audit": {
    id: "hygiene-audit", name: "衛生稽查", icon: "🧾", tone: "negative",
    description: "市集公會今晚抽查爐台與備料區。設備完善可免整改費，也可以先委託快速清潔。",
    choices: [
      { id: "deep-clean", name: "委託快速清潔", detail: "清潔支出 −NT$ " + DATA.economy.hygieneQuickCleanCost + "・免本次整改費・口碑 +1", cost: DATA.economy.hygieneQuickCleanCost },
      { id: "self-check", name: "自行整理應檢", detail: "不花錢；若設備尚未準備好，可能支出 NT$ 75 整改費", cost: 0 }
    ]
  },
  "rain-subsidy": {
    id: "rain-subsidy", name: "雨天能源補助", icon: "🌧️", tone: "positive",
    description: "港區因雨勢提供能源補助，可申請抵銷部分水電瓦斯支出。",
    choices: [
      { id: "claim", name: "申請補助", detail: "市集補助收入 +NT$ " + DATA.economy.rainSubsidy, cost: 0 },
      { id: "decline", name: "留給其他攤商", detail: "不領取補助", cost: 0 }
    ]
  },
  "media-interview": {
    id: "media-interview", name: "地方節目採訪邀約", icon: "🎥", tone: "positive",
    description: "節目組想聊聊港邊攤商的日常；接受採訪不收費，但播出反應與後續客流不一定。",
    choices: [
      { id: "accept-interview", name: "接受節目採訪", detail: "不收費；播出效果隨機，可能帶來口碑與來客，也可能被剪輯成意外焦點。", cost: DATA.economy.interviewPromotionCost },
      { id: "decline-interview", name: "婉拒邀約", detail: "不支出、不改變今晚客流。", cost: 0 }
    ]
  },
  "celebrity-visit": {
    id: "celebrity-visit", name: "名人探訪・港邊打卡", icon: "📸", tone: "positive",
    description: "一位人氣主持人傳訊想來吃宵夜；可以先整理座位迎接，也可能臨時改行程。",
    choices: [
      { id: "host-visit", name: "預留座位・準備接待", detail: "接待費 −NT$ " + DATA.economy.celebrityVisitCost + "；名人可能到訪帶動熱潮，也可能臨時取消。", cost: DATA.economy.celebrityVisitCost },
      { id: "pass-visit", name: "照常營業", detail: "不支出、不等待名人行程。", cost: 0 }
    ]
  },
  "paid-promotion": {
    id: "paid-promotion", name: "宣傳合作報價", icon: "📣", tone: "caution",
    description: "媒體送來廣告與節目置入報價；曝光成效隨機，先看今晚現金與備料再決定。",
    choices: [
      { id: "buy-ad", name: "購買短影音廣告", detail: "行銷費 −NT$ " + DATA.economy.paidAdCost + "；曝光轉換可能普通、亮眼或不如預期。", cost: DATA.economy.paidAdCost },
      { id: "buy-placement", name: "購買節目置入", detail: "行銷費 −NT$ " + DATA.economy.productPlacementCost + "；可能帶來較多新客，也可能只換到有限曝光。", cost: DATA.economy.productPlacementCost },
      { id: "pass-promotion", name: "暫不投放", detail: "不新增行銷費，保留現金與備料彈性。", cost: 0 }
    ]
  }
});

export const MARKET_CARD_SCHEDULE = Object.freeze({
  2: "tourist-surge",
  4: "rain-subsidy",
  8: "hygiene-audit",
  11: "rain-subsidy",
  16: "tourist-surge",
  18: "rain-subsidy",
  22: "hygiene-audit",
  26: "rain-subsidy",
  6: "media-interview",
  17: "celebrity-visit",
  27: "paid-promotion"
});

export const ACQUISITION_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(DATA.outletProducts).map(([id, product]) => [id, {
    id,
    name: product.storeName,
    group: product.group,
    typeLabel: product.typeLabel,
    productName: product.productName,
    icon: product.icon,
    unit: product.unit,
    price: product.price,
    note: product.note,
    selectable: product.selectable
  }])
));
export const ACQUISITION_GROUPS = Object.freeze({ food: "餐飲類", leisure: "遊戲體驗類" });

export function acquisitionGroupCounts(types) {
  return (Array.isArray(types) ? types : []).reduce((counts, type) => {
    const group = ACQUISITION_TYPES[type]?.group;
    if (group) counts[group] = (counts[group] || 0) + 1;
    return counts;
  }, {});
}

// Every night has its own harbor beat. Economic event ids still map to the
// existing simulation rules in state.js/game.js; the calendar supplies the
// narrative layer and a deliberate 30-night cadence.
const ALL_CAMPAIGN_NIGHTS = [
  { eventId: "festival", name: "開市燈火・第一盞紙燈", icon: "🏮", tone: "positive", description: "開張首夜遇上港灣小燈節，多一桌旅人，也為每位客人帶來活動 Bonus。", title: "第一盞燈，先替晚歸的人亮著。", story: "你把新寫的招牌掛上木樑。末班船靠岸時，第一位客人說，這盞燈讓她想起家的方向。" },
  { eventId: "market-sale", name: "魚市晨會・鄰攤合購", icon: "🧺", tone: "positive", description: "魚市商販一起向供應商議價，今晚補貨享有折扣。", title: "巷口的人開始記得你的名字。", story: "隔壁果攤老闆替你留了一籃熟梨，說新店開張，先別急著把每件事都一個人扛。" },
  { eventId: "complaint", name: "渡船誤點・尖峰客訴", icon: "😤", tone: "negative", description: "渡船臨時延誤，尖峰排隊更久；冷靜處理客訴能守住口碑。", title: "第一場忙亂來得比想像中早。", story: "一位等得不耐煩的客人皺起眉。你第一次發現，做生意不只是在火爐前，也是在每個人的情緒旁邊。" },
  { eventId: "rain", name: "海風急雨・帆布棚受考驗", icon: "🌧️", tone: "negative", description: "風雨使能源費增加；防風帆布棚可以抵銷部分水電瓦斯加成。", title: "雨水沿著帆布滴成一串節拍。", story: "阿滿把爐火顧得很穩。你們沒有多說話，只把每張乾紙巾放到客人伸手就拿得到的地方。" },
  { eventId: "street-music", name: "巷口手風琴・熟客留步", icon: "🎸", tone: "positive", description: "街頭樂手演奏港邊老歌，客人願意多坐一會，小費增加。", title: "有人在巷口吹起老歌。", story: "旋律把晚餐時間拉長了。小青認出其中一段，是她小時候跟著父親搭船時常聽見的曲子。" },
  { eventId: "supplier", name: "冷鏈延誤・漁貨行情上揚", icon: "🐟", tone: "negative", description: "冷鏈貨車晚到，批發食材價格上漲；控制採購量能降低現金壓力。", title: "今天的海味比昨天更貴。", story: "漁販說風浪讓船晚了一班。你重新算過菜單，決定把每一份新鮮都交代清楚。" },
  { eventId: "festival", name: "七夜小燈會・首週回饋", icon: "🏮", tone: "positive", description: "首週收尾迎來小燈會，多一桌旅人並獲得節慶 Bonus。打烊後可決定下一週方向。", title: "第一週，巷口多了幾張熟面孔。", story: "藍姨把一盞手作小燈送給你。她說，下一週不必急著變大，先想想你想讓這條巷子變成什麼樣子。" },
  { eventId: "inspection", name: "市集評鑑・設備安全巡查", icon: "🧾", tone: "negative", description: "巡查爐台與排煙設備；已有排煙罩、帆布棚或手繪燈牌改造可免臨時改善費。", title: "巡查員把檢查表翻到最後一頁。", story: "他注意到你收好食材、擦亮爐台，提醒你：擴大生意時，安全與照顧客人一樣重要。" },
  { eventId: "market-sale", name: "港邊聯採・冷藏箱共享", icon: "🧺", tone: "positive", description: "鄰攤共享冷藏運送，今晚進貨折扣。若已拓展攤位，還能串起更多供應管道。", title: "果攤和魚販一起搬來一只大冰箱。", story: "你把多買的香草分給隔壁，隔壁又回送一小袋漁獲。夜市的生意，原來可以互相照應。" },
  { eventId: "blackout", name: "巷區跳電・臨時接電", icon: "💡", tone: "negative", description: "巷區短暫停電，臨時接電增加成本；排煙罩可降低基本電費。", title: "燈暗下來的那幾秒，大家都停了手。", story: "小青點亮備用燈，客人接著聊起各自遇過的停電夜。夜市又慢慢亮了回來。" },
  { eventId: "rain", name: "海霧轉雨・潮氣入巷", icon: "🌧️", tone: "negative", description: "濕冷天氣讓能源支出增加；帆布棚升級能降低雨夜額外成本。", title: "霧沿著防波堤一路走進夜市。", story: "阿慕叔把外套搭在椅背上，說這樣的天氣最適合一碗熱湯。今晚的客人少了些，坐得卻更久。" },
  { eventId: "street-music", name: "漁火音樂會・港口小舞台", icon: "🎸", tone: "positive", description: "巷口臨時搭起小舞台，街頭演奏讓每桌小費增加。", title: "港口小舞台試唱了第一首歌。", story: "花店學徒把沒賣完的小白花放在舞台邊。你把桌子往外挪了一點，讓晚風和音樂都能進來。" },
  { eventId: "supplier", name: "供應商調價・冰鮮貨減少", icon: "🐟", tone: "negative", description: "海象影響當日漁獲，進貨成本上升；先檢查庫存再補貨。", title: "冰箱裡剩下的食材不多不少。", story: "你和阿滿一起盤點，才發現備料的節奏也是一門手藝。少一些浪費，就多留一些餘裕。" },
  { eventId: "festival", name: "海岸守望日・遊客順道來訪", icon: "🏮", tone: "positive", description: "海岸守望活動帶來一桌遊客，每位客人另有節慶 Bonus。", title: "燈塔今晚比平常亮得早。", story: "巡守員阿嶼帶著同伴來吃宵夜。他說海面平靜，港口的燈一盞一盞看起來像回家的路。" },
  { eventId: "inspection", name: "攤商公會・營運與衛生抽查", icon: "🧾", tone: "negative", description: "公會抽查爐台與排煙；完成設備改善可免改善費，否則需支付臨時整改成本。", title: "一張檢查表換來一段長談。", story: "巡查員提醒，招牌越亮，越要讓人看見你怎麼照顧食材與夥伴。你把這句話記進手記。" },
  { eventId: "complaint", name: "渡船加班・排隊客訴", icon: "😤", tone: "negative", description: "加班船班集中抵港，排隊時間拉長；排班人手能讓服務更從容。", title: "今晚的隊伍排到了巷口。", story: "陳先生等得不耐煩。你看見小青正在努力照顧每一桌，也更清楚多一雙手代表多少差別。" },
  { eventId: "market-sale", name: "海味週・漁販聯合優惠", icon: "🧺", tone: "positive", description: "漁販推出聯合優惠，補貨折扣；併購鄰攤後可接觸更多供應商。", title: "魚販教你辨認潮汐留下的銀光。", story: "今天的貨便宜了一些。阿慕叔教你挑魚，你才知道好味道從端上桌之前就開始了。" },
  { eventId: "rain", name: "颱風外圍環流・雨勢增強", icon: "🌧️", tone: "negative", description: "颱風外圍風雨提高能源支出；帆布棚可降低雨夜額外成本。", title: "氣象台的紅色訊息亮了起來。", story: "大家提早收好招牌與紙燈。你選擇按部就班，不讓一個壞天氣變成整個夜市的壞記憶。" },
  { eventId: "street-music", name: "地方電台・巷口現場直播", icon: "🎙️", tone: "positive", description: "地方電台在巷口直播，音樂與人聲讓客人多留一會，小費增加。", title: "一段現場訪問，意外說到了你的攤。", story: "主持人問你為什麼留在港邊。你說，因為每晚總有人需要一碗熱的，這句話隔天被剪成了短短的廣播片段。" },
  { eventId: "blackout", name: "港區電纜維修・短暫停電", icon: "💡", tone: "negative", description: "電纜維修造成短暫跳電，臨時供電增加成本；排煙罩能省下部分基本電費。", title: "停電時，隔壁攤的燈先亮了。", story: "鄰攤拿來備用電池。你們互相照看爐火，等電力回來後，決定把這晚叫作互助夜。" },
  { eventId: "festival", name: "第二週燈海・熟客帶朋友", icon: "🏮", tone: "positive", description: "港邊燈海活動帶來一桌新客，每桌節慶 Bonus；打烊後迎來第二次經營決策。", title: "熟客帶來了第一批朋友。", story: "小北和星星把朋友介紹到窗邊。你看見熟悉的桌子坐滿了新面孔，夜市正在長出自己的故事。" },
  { eventId: "supplier", name: "新漁季上岸・批發價波動", icon: "🐟", tone: "negative", description: "新漁季首批貨量不穩，食材進價上揚；庫存足夠時可少量採購。", title: "新漁季的第一批貨剛剛上岸。", story: "阿慕叔說，海不會每天都給同樣的答案。你把菜單留一點彈性，讓生意也能跟著潮水呼吸。" },
  { eventId: "inspection", name: "消防安全週・爐台覆核", icon: "🧾", tone: "negative", description: "消防人員覆核瓦斯與排煙；有排煙罩、帆布棚或燈牌改造即可免改善費。", title: "火焰安靜地映在銅鍋邊。", story: "巡查員確認管線安全，也誇你的工作檯收拾得乾淨。你開始想像，若多一個攤位，還能不能保持這份細心。" },
  { eventId: "market-sale", name: "社區共煮・食材市集折扣", icon: "🧺", tone: "positive", description: "社區共煮活動帶動攤商合購，今晚補貨折扣；雇用人手可讓服務更順。", title: "小朋友畫了一張港邊餐桌。", story: "社區共煮的孩子把畫貼在你的冰箱上。桌邊的位置不多，但每個人都說下次還想來。" },
  { eventId: "complaint", name: "遊客團抵港・尖峰客訴", icon: "😤", tone: "negative", description: "遊客團集中抵港，等待時間增長；招待、退款或耐心說明都會改變口碑。", title: "今晚的忙碌不是每個人都等得住。", story: "陳先生又皺起眉。你已經知道怎麼回應，但也開始思考，是否該讓新夥伴一起分擔尖峰。" },
  { eventId: "rain", name: "潮汐大雨・港邊積水", icon: "🌧️", tone: "negative", description: "大雨增加能源支出；防風帆布棚降低雨夜成本，鄰攤也可互相支援。", title: "雨水讓巷子變成一面鏡子。", story: "你和鄰攤把木箱墊高。傍晚的燈倒映在水面上，像夜市忽然多了一條平行街道。" },
  { eventId: "festival", name: "港灣美食投票・人氣加開", icon: "🏮", tone: "positive", description: "港灣美食投票吸引一桌食客，活動 Bonus 隨每桌入帳。", title: "有人在投票紙上寫下你的名字。", story: "那張票沒有留下名字，只寫著『那碗湯讓我等到了船』。你把它放進收銀盒最裡面。" },
  { eventId: "street-music", name: "夜市文化季・舞台壓軸", icon: "🎸", tone: "positive", description: "文化季樂團在夜市口壓軸，客人多留一會，小費增加。", title: "樂團把最後一首歌留給海。", story: "最後一個和弦落下時，熟客沒有馬上離開。你突然明白，經營的不只是一張菜單，還有一個願意停下來的地方。" },
  { eventId: "blackout", name: "老街整修・夜間電力切換", icon: "💡", tone: "negative", description: "老街電力切換增加臨時接電成本；排煙罩升級可減少基本電費。", title: "整修中的巷子暫時少了幾盞燈。", story: "工班收工後，你把門口燈籠掛低一點，讓路過的人還看得見攤位。有人說，這盞燈剛好。" },
  { eventId: "festival", name: "第三十夜・港灣萬燈回望", icon: "🏮", tone: "positive", description: "本期收尾的萬燈活動帶來旅人與節慶 Bonus。打烊後封存財報與故事走向，明晚夜市照常開張。", title: "第三十夜，港灣仍替你留著一盞燈。", story: "招牌又被海風磨過一圈。你回望本期的擴張、招募、合作與取捨，知道答案不只寫在帳本上；明晚還會有新的客人。" }
];
export const CAMPAIGN_CALENDAR = Object.freeze(
  ALL_CAMPAIGN_NIGHTS.slice(0, CAMPAIGN_DAYS)
);

export const WEEKLY_OPTIONS = Object.freeze({
  expand: { id: "expand", name: "擴大店家", icon: "🪑", max: 9, baseCost: 460, stepCost: 90, recurring: 24, label: "一次性裝修費", effect: "增加座位與客流、舒適度 +5；每夜租金 +NT$ 24。最多擴成九桌，會列入設備資產與折舊。" },
  hire: { id: "hire", name: "招聘人手", icon: "🧑🏻‍🍳", max: 6, baseCost: 360, stepCost: 120, recurring: 90, label: "一次性招募與訓練", effect: "每夜薪資 +NT$ 90，服務小費與尖峰應對提升。最多六位夥伴。" },
  acquire: { id: "acquire", name: "併購攤販", icon: "🏮", max: 4, baseCost: 760, stepCost: 180, recurring: 38, label: "一次性併購費", effect: "從炸物、果物冰飲、手作甜食或彈珠體驗中選擇業態；每種店有專屬商品、進貨成本與售價。接手後可獨立備料、升級、營業與聘店長；每夜租金 +NT$ 38。擴店並累積兩間同屬餐飲或遊戲體驗的分店，可解鎖品牌聯盟。" },
  hold: { id: "hold", name: "暫不投資", icon: "🧭", max: Infinity, baseCost: 0, stepCost: 0, recurring: 0, label: "保留現金", effect: "維持現有規模，不增加固定成本；把資金留給備料與設備。" }
});

export function marketCardForDay(day) {
  const id = MARKET_CARD_SCHEDULE[campaignCycleDay(day)];
  return id ? MARKET_CARDS[id] : null;
}

export function campaignEntry(day) {
  const index = campaignCycleDay(day) - 1;
  return CAMPAIGN_CALENDAR[index];
}

export function weeklyOptionCost(state, id) {
  const option = WEEKLY_OPTIONS[id];
  if (!option) return null;
  const count = id === "expand" ? state.expansions : id === "hire" ? state.hiredCrew : id === "acquire" ? state.acquisitions : 0;
  if (count >= option.max) return null;
  return option.baseCost + option.stepCost * count;
}

export function selectEnding(state) {
  const net = Number(state.campaignNet) || 0;
  if (net < -250 || state.coins < 0 || (Number(state.loanPrincipal) || 0) > 0) return "harbor-debt";
  if ((state.fame < 30 || state.regulars < 8) && state.coins < 1800) return "quiet-lantern";
  const categoryCounts = acquisitionGroupCounts(state.acquisitionTypes);
  const allianceFormed = (Number(state.expansions) || 0) >= 1 && Object.values(categoryCounts).some((count) => count >= 2);
  if (allianceFormed && net >= 250 && state.fame >= 50) return "night-market-alliance";
  if (state.acquisitions >= 2 && net >= 500 && state.coins >= 1200) return "market-keeper";
  if (state.fame >= 72 && state.regulars >= 16 && net >= 0) return "harbor-icon";
  if (state.regulars >= 14 && state.cozy >= 68 && net >= 0) return "neighborhood-table";
  if (state.expansions + state.hiredCrew + state.acquisitions >= 3 && net < 0) return "overextended";
  if (net >= 0 && state.fame >= 45) return "steady-lantern";
  return "soft-goodbye";
}

export const ENDINGS = Object.freeze({
  "harbor-icon": { title: "港灣夜市名店", tone: "positive", text: "本期末，旅人開始專程為你轉進這條巷子。口碑、熟客與帳本都站得住腳；夜嵐成了港邊的一盞招牌燈，下一期仍會繼續迎客。" },
  "neighborhood-table": { title: "巷口的第二張餐桌", tone: "positive", text: "你把熟客照顧成了鄰里，把小店做成可以久坐的地方。夜嵐沒有變得最大，卻成為許多人每週都會回來的地方。" },
  "market-keeper": { title: "夜市共同經營人", tone: "positive", text: "你接下鄰攤，連起供應商與街坊，也守住了營運盈餘。夜市的招牌不再只屬於一家店，而是整條巷子的共同名字。" },
  "night-market-alliance": { title: "夜市品牌聯盟", tone: "positive", text: "你把主店、餐飲與遊戲體驗分店串成一個能互相支援的聯盟。客人記住的不只是一個招牌，而是整個夜市彼此照應的風景。" },
  "steady-lantern": { title: "穩穩亮著的小店", tone: "positive", text: "你沒有追逐一夜成名，而是讓帳本保持健康、讓每晚的燈如常亮起。對港邊來說，這份穩定就是一種成功。" },
  "soft-goodbye": { title: "把燈留給下一個夜晚", tone: "bittersweet", text: "本期有過熱鬧，也有幾次算不過來的帳。你決定在下一期收拾步伐，把學到的經驗與那盞手繪燈一起留在港邊。" },
  "quiet-lantern": { title: "巷口漸漸安靜", tone: "negative", text: "客流與口碑還沒接上彼此，現金也偏緊。你需要調整菜單、排班與投資節奏；巷口燈光暫時收斂，夜市並未停業。" },
  "harbor-debt": { title: "風浪中的資金警訊", tone: "negative", text: "固定成本與幾場壞天氣壓過了本期收入。先暫緩擴張、整理借款與採購，讓下期營運有機會重新站穩。" },
  overextended: { title: "擴張太快的長夜", tone: "negative", text: "店家、人手與攤位都長大了，現金流卻沒有跟上。下一期先穩住一盞燈的節奏，讓每個承諾都能被照顧。" }
});

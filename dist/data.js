export const DATA = Object.freeze({
  saveKey: "ye-lan-night-market-iso-v2",
  legacyKey: "ye-lan-night-game-v1",
  economy: {
    rent: 95,
    electricity: 38,
    gas: 27,
    supplierMarkup: 1.25,
    marketDiscount: 0.85,
    blackoutSurcharge: 42,
    rainElectricity: 30,
    rainGas: 15,
    minElectricity: 18,
    minGas: 12,
    hoodElectricitySavings: 6,
    hoodGasSavings: 3,
    awningElectricitySavings: 9,
    awningGasSavings: 6,
    festivalBonus: 35,
    featuredDishBonus: 24,
    streetMusicTip: 18,
    baseTip: 41,
    grillTipPerLevel: 5,
    goodMatchTip: 60,
    standardTip: 18,
    menuTipBonus: 15,
    cookServicePenalty: 12,
    serverServicePenalty: 10,
    complaintSnackCost: 35,
    complaintRefund: 80
  },
  camera: {
    defaultYaw: 0,
    defaultElevation: 0.63,
    minElevation: 0.45,
    maxElevation: 0.82,
    tiltStep: 0.055,
    orbitStep: Math.PI / 4,
    yawDrag: 0.006,
    elevationDrag: 0.0012,
    minZoom: 0.72,
    maxZoom: 1.42,
    zoomStep: 1.12,
    wheelZoomIn: 1.08,
    wheelZoomOut: 0.93
  },
  motion: {
    ambientSpeed: 34,
    ambientSpeedStep: 10,
    ambientColors: ["#d58b65", "#648d83", "#c6a25e", "#827a9e", "#d8d2b6", "#7797a0"],
    staffSpeed: 36,
    staffStart: { x: 491, z: 443 },
    guestSpeed: 118,
    guestSkin: "#e2b18e",
    guestPants: "#3d4841",
    guestSpawn: { x: 520, z: 891, xStep: 23, zStep: 22 },
    guestExitRoute: [{ x: 650, z: 620 }, { x: 760, z: 690 }, { x: 900, z: 840 }],
    guestCounterRoute: [{ x: 500, z: 755 }, { x: 470, z: 660 }, { x: 505, z: 573 }],
    queueRoutes: [
      [{ x: 500, z: 770 }, { x: 465, z: 636 }],
      [{ x: 500, z: 788 }, { x: 505, z: 676 }],
      [{ x: 500, z: 806 }, { x: 445, z: 716 }]
    ],
    ambientRoutes: [
      [{ x: 35, z: 490 }, { x: 280, z: 500 }, { x: 330, z: 590 }, { x: 100, z: 610 }],
      [{ x: 980, z: 520 }, { x: 760, z: 540 }, { x: 660, z: 585 }, { x: 945, z: 615 }],
      [{ x: 160, z: 890 }, { x: 365, z: 830 }, { x: 460, z: 710 }, { x: 220, z: 725 }],
      [{ x: 880, z: 140 }, { x: 690, z: 200 }, { x: 620, z: 275 }, { x: 900, z: 320 }],
      [{ x: 55, z: 335 }, { x: 250, z: 350 }, { x: 320, z: 290 }, { x: 85, z: 250 }],
      [{ x: 970, z: 830 }, { x: 790, z: 800 }, { x: 690, z: 735 }, { x: 930, z: 690 }]
    ],
    staffRoute: [{ x: 477, z: 435 }, { x: 565, z: 442 }, { x: 544, z: 459 }, { x: 474, z: 453 }],
    guestClickRadius: 27
  },
  stalls: [
    { id: "sweet", name: "花生糖", x: 115, z: 285, w: 155, d: 108, h: 105, roof: "#bb7155", trim: "#e6bc79" },
    { id: "main", name: "夜嵐攤號", x: 386, z: 346, w: 235, d: 157, h: 145, roof: "#b95145", trim: "#f0cd82", main: true },
    { id: "toy", name: "彈珠小屋", x: 755, z: 262, w: 170, d: 112, h: 112, roof: "#618279", trim: "#c5d49f" },
    { id: "fruit", name: "山海果物", x: 107, z: 664, w: 174, d: 113, h: 108, roof: "#8a9b5d", trim: "#e9cd80" },
    { id: "fish", name: "港口炸物", x: 746, z: 659, w: 177, d: 118, h: 115, roof: "#d18650", trim: "#f4d28b" }
  ],
  dishes: [
    { id: "pepper-soup", name: "白胡椒雞湯", icon: "♨", price: 120, cost: 42, ingredient: "chicken", need: ["warm", "comfort"], line: "雞腿・白胡椒・暖心慢燉" },
    { id: "tide-platter", name: "潮汐海味盤", icon: "◉", price: 190, cost: 78, ingredient: "seafood", need: ["sea", "share"], line: "當日漁獲・米粉・一起分享" },
    { id: "osmanthus-pear", name: "桂花烏龍燉梨", icon: "❋", price: 85, cost: 25, ingredient: "tea", need: ["tea", "comfort"], line: "桂花・烏龍茶・清甜水梨" }
  ],
  ingredients: [
    { id: "chicken", name: "雞腿與白胡椒", icon: "🍗", cost: 42, recipe: "白胡椒雞湯" },
    { id: "seafood", name: "港口當日漁貨", icon: "🐟", cost: 78, recipe: "潮汐海味盤" },
    { id: "tea", name: "桂花烏龍與水梨", icon: "🍐", cost: 25, recipe: "桂花烏龍燉梨" }
  ],
  equipment: [
    { id: "grill", name: "銅火爐", icon: "🔥", note: "火候穩定，每級每桌小費 +NT$ 5。", costs: [320, 520, 760] },
    { id: "hood", name: "靜音排煙罩", icon: "🌫️", note: "每級電費 −NT$ 6、瓦斯 −NT$ 3。", costs: [300, 480, 700] },
    { id: "awning", name: "防風帆布棚", icon: "⛺", note: "雨夜能源加成每級減少 NT$ 15。", costs: [280, 460, 680] }
  ],
  staff: [
    { id: "cook", name: "阿滿", role: "廚房主廚", icon: "👩🏻‍🍳", wage: 110, penalty: 12 },
    { id: "server", name: "小青", role: "外場服務", icon: "🧑🏻‍🍳", wage: 90, penalty: 10 }
  ],
  upgrades: [
    { id: "lantern", name: "手繪巷口燈", icon: "🏮", note: "舒適度 +8，燈火吸引熟客。", cost: 360 },
    { id: "window-seat", name: "靠窗雙人桌", icon: "🪑", note: "每桌服務小費 +NT$ 15。", cost: 580 },
    { id: "old-radio", name: "港邊老收音機", icon: "📻", note: "夜市口碑 +6。", cost: 760 }
  ],
  guests: [
    { name: "阿琴", role: "末班車站務員", icon: "🚉", need: "warm", needLabel: "想喝一碗有胡椒香的熱湯", line: "最後一班車今天晚了二十分鐘。能不能給我一碗有胡椒香的？", mood: "雨衣還滴著水，她把班表小心摺好，放在桌角。", outfit: "#d07d5f" },
    { name: "小北與星星", role: "等渡船的兄妹", icon: "🧒🏻", need: "share", needLabel: "想要兩個人一起分享", line: "我們的船再一下就到。可以點一份兩個人一起吃的嗎？", mood: "兩個人把一張小小的船票，推到你手邊當作書籤。", outfit: "#77988f" },
    { name: "藍姨", role: "巷口燈籠師傅", icon: "🏮", need: "tea", needLabel: "收工後想來點清甜茶香", line: "收工後喉嚨乾乾的。今晚有沒有不太甜、帶茶香的東西？", mood: "她替門口那盞燈調亮了一點，說這樣晚歸的人比較找得到路。", outfit: "#bb9b64" },
    { name: "阿慕叔", role: "清晨出海的舵手", icon: "⚓", need: "sea", needLabel: "想吃今天港口的海味", line: "白天沒捕到什麼魚，倒是晚霞很好看。給我你最喜歡的海味吧。", mood: "他把最後一片夕陽描述得像一座沒人去過的小島。", outfit: "#6b8792" },
    { name: "小葉", role: "港邊夜讀者", icon: "📖", need: "comfort", needLabel: "想坐一會，吃熟悉的味道", line: "我不趕時間，想找一個味道熟悉、能配上幾頁書的晚餐。", mood: "借出去的那本小說終於回來了，書籤還留在同一頁。", outfit: "#907a9d" },
    { name: "阿哲", role: "修船廠夜班師傅", icon: "🛠️", need: "warm", needLabel: "收工後想喝點熱的", line: "今天把引擎修好了，手還是冷的。來一碗能暖手的吧。", mood: "他說明天要帶女兒來看漁船出港。", outfit: "#758a67" },
    { name: "小米", role: "港邊花店學徒", icon: "🌼", need: "tea", needLabel: "想找一點花香與茶香", line: "花市散場了，今晚想喝一杯帶香氣的東西。", mood: "她在桌上放了一朵沒賣完的小白花。", outfit: "#c5879b" },
    { name: "老周", role: "回鄉探親的郵差", icon: "📮", need: "share", needLabel: "想與老朋友分享一盤料理", line: "好久沒回來了，想點一份可以慢慢聊的海味。", mood: "他把一張舊明信片交給港口的熟面孔。", outfit: "#8c705b" },
    { name: "小岑", role: "夜班護理師", icon: "🩺", need: "comfort", needLabel: "下班後想吃熟悉的味道", line: "剛下班，腦袋還在值班。給我一份安穩的晚餐吧。", mood: "她笑說，今晚終於不用看時鐘吃飯了。", outfit: "#7b8fb0" },
    { name: "阿嶼", role: "海岸巡守員", icon: "🌊", need: "sea", needLabel: "想嚐一口當日海味", line: "海面今晚很平，漁船回來得早。你這裡有什麼新鮮貨？", mood: "他說遠方的燈塔今晚亮得特別清楚。", outfit: "#6c9b9b" }
  ],
  festivalGuest: { name: "小滿", role: "燈節旅人", icon: "🏮", need: "tea", needLabel: "燈節・想來點清甜", line: "燈籠一路亮到海邊了。給我一份甜甜的，當作今晚的紀念吧。", mood: "她把一顆小紙燈留在窗台，說下次要帶朋友一起來。", outfit: "#cc8f58", festival: true },
  difficultGuest: { name: "陳先生", role: "等到不耐煩的客人", icon: "😤", need: "warm", needLabel: "突發客訴・需要現場處理", line: "等這麼久，這服務也太慢了吧？你們打算怎麼處理？", mood: "他深呼吸幾次後離開，街角又恢復了平靜。", outfit: "#9b5c4b", difficult: true },
  events: [
    { id: "festival", name: "港灣燈節・人潮加開", icon: "🏮", description: "紙燈一路亮到海邊，今晚多一桌節慶客；每桌多留 NT$ 35 活動 Bonus。", tone: "positive" },
    { id: "complaint", name: "尖峰時段・奧客來襲", icon: "😤", description: "一位客人嫌等太久；安撫、招待小菜，或退款處理都會影響帳本與口碑。", tone: "negative" },
    { id: "rain", name: "海風突雨・帆布棚受考驗", icon: "🌧️", description: "突來風雨讓爐火和照明更耗能源；帆布棚可以抵銷部分水電瓦斯加成。", tone: "negative" },
    { id: "supplier", name: "漁貨行情上漲", icon: "🐟", description: "批發市場今晚供貨偏緊，新採購食材價格上漲 25%。", tone: "negative" },
    { id: "street-music", name: "巷口音樂會・熟客多留一會", icon: "🎸", description: "街頭樂手在巷口演奏，每桌小費額外增加 NT$ 18。", tone: "positive" },
    { id: "market-sale", name: "港邊市集・食材聯合採購", icon: "🧺", description: "鄰攤一起向批發商採買，今晚補貨價格降低 15%。", tone: "positive" },
    { id: "blackout", name: "巷區跳電・臨時接電", icon: "💡", description: "臨時電力設備需要額外支出 NT$ 42；排煙罩可降低基本電費。", tone: "negative" }
  ],
  stories: [
    { title: "末班船晚了二十分鐘。", icon: "🌧️", text: "雨聲停在門簷外。有人把濕掉的車票壓在桌角，說想先吃點熱的。" },
    { title: "港口的霧，今天散得很慢。", icon: "🌫️", text: "燈塔亮了又暗，像有人還在等一個不一定會到的消息。" },
    { title: "有人帶來一張褪色的舊照片。", icon: "📷", text: "照片裡的小港還沒有現在的防波堤，海風似乎也比現在更大一些。" },
    { title: "海面上飄來一首走調的歌。", icon: "🎐", text: "阿慕叔說，那是返港船上的水手在替自己報平安。" },
    { title: "一盞紙燈在巷口亮著。", icon: "🏮", text: "藍姨說，燈不是拿來照路的，是拿來讓人知道還有人醒著。" },
    { title: "修船廠的燈比平常晚熄。", icon: "🛠️", text: "阿哲說，總有一盞燈要替明天提早亮起來。" },
    { title: "花店學徒把最後一朵花送了人。", icon: "🌼", text: "她說賣不出去的花，剛好可以替夜晚留下一點香氣。" },
    { title: "一張明信片繞了半座島。", icon: "📮", text: "老周把它交給等了很久的人，郵戳上的海風仍然新鮮。" }
  ]
});

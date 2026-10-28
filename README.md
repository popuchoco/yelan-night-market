# 夜嵐夜市｜2.5D 經營模擬

以台灣港邊夜市為舞台的 vanilla-JS 2.5D 經營遊戲。斜俯視 Canvas 場景可旋轉、縮放與暫停；點擊攤位打開整合工作台，管理備料、設備和排班。

## 專案結構

- `dist/data.js`：料理、客人、事件、營運成本、場景路徑與相機參數。
- `dist/state.js`：存檔遷移、localStorage、事件排程、成本帳本與損益預估。
- `dist/scene.js`：等角投影、Canvas 場景、角色動畫、命中測試與相機。
- `dist/ui.js`：營運面板、攤位工作台和點餐／客訴介面。
- `dist/game.js`：可單元測試的遊戲規則與瀏覽器互動控制。
- `dist/app.js`：瀏覽器入口；`dist/index.html` 與 `dist/styles.css` 為頁面和樣式。
- `.openai/hosting.json`：既有 Sites 靜態部署設定。
- `tests/game.test.js`：無外部依賴的遊戲規則測試。
- `index.html`：GitHub Pages 根目錄入口，導向 `dist/index.html`。

## 執行與測試

直接以現代瀏覽器開啟 `dist/index.html`，遊戲進度存在瀏覽器 `localStorage`。測試不需安裝依賴：

```powershell
node --test tests/game.test.js
```

## 營運內容

帳本包含攤位租金、員工薪資、水電瓦斯、食材採購與耗用、客訴補償及退款。七夜事件循環包含燈節 Bonus、奧客、突雨、漁貨漲價、街頭音樂、市集折扣與跳電；客人和港邊手記也增加了輪替內容。

## 操作

- 拖曳旋轉場景、滾輪縮放；使用按鈕或方向鍵控制相機。
- 點「攤位管理」查看庫存、設備、班表與成本，再進入各管理頁籤。
- 點擊正在接待的客人接單；客訴可安撫、招待或退款。
- 可暫停場景動畫，並自行開啟／關閉輕柔音效。

線上遊玩：[夜嵐夜市](https://yelan-night-market-game.duskylark33.chatgpt.site/)

此倉庫只包含本網頁遊戲程式碼、部署設定與測試；不含 APK 解包／反編譯檔或內部逆流程分析資料。

# 夜嵐夜市｜2.5D 經營模擬

以台灣港邊夜市為舞台的單頁經營遊戲。Canvas 斜俯視場景支援相機旋轉、顧客排隊與移動、店員走動、攤位管理，以及租金、人事、能源、食材與營運事件系統。

## 專案結構

- `dist/index.html`：遊戲頁面結構與入口。
- `dist/styles.css`：介面樣式、響應式版面與動態視覺。
- `dist/app.js`：場景繪製、模擬經營與互動邏輯。
- `.openai/hosting.json`：既有 Sites 專案的靜態部署設定（含專案識別碼，不含存取憑證）。
- `tests/verify-game.js`：本專案的無依賴互動冒煙測試。
- `index.html`：根目錄入口，導向 `dist/index.html`。

## 執行與測試

直接以現代瀏覽器開啟 `dist/index.html` 即可遊玩，無需安裝依賴或啟動後端；進度存於瀏覽器的 `localStorage`。

執行互動冒煙測試：

```powershell
node tests/verify-game.js
```

## 操作

- 拖曳場景旋轉視角，滾輪縮放；也可使用畫面上的相機控制按鈕。
- 點擊中央攤位管理備料、設備與人員排班。
- 點擊正在接待的顧客接單與出餐。

## 遊戲系統

包含攤位租金、人事、水電與瓦斯、食材採購及耗用成本；節慶加成、雨勢與奧客等事件會影響當晚營運。

線上遊玩：[夜嵐夜市](https://yelan-night-market-game.duskylark33.chatgpt.site/)

此倉庫只包含本網頁遊戲的程式碼、部署設定與測試；不含 APK 解包／反編譯檔或內部逆流程分析資料。

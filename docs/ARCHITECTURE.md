# 架構說明

**文件狀態：** 依 2026-10-29 的程式碼基線整理。  
**適用範圍：** 瀏覽器端《夜嵐夜市》單人經營模擬。

## 1. 系統概觀

本專案是以原生 HTML、CSS、JavaScript ES modules 與 Canvas 2D 建立的靜態網頁遊戲。部署內容由 `.openai/hosting.json` 指定的 `dist/` 提供；沒有必需的前端框架、打包步驟或伺服器端遊戲狀態。遊戲資料由瀏覽器 `localStorage` 保存。

```text
dist/index.html + dist/styles.css
            │
            └── dist/app.js
                  └── game.js（瀏覽器組裝與流程協調）
                        ├── engine.js（遊戲規則與動作）
                        │     └── achievements.js（成就資料與狀態推導）
                        │     ├── state.js（狀態、成本、日常資料）
                        │     ├── campaign.js（週期、公告卡、故事、週決策）
                        │     ├── safety.js（攤型、安全、保險）
                        │     └── accounting.js（分錄、資產、結帳、報表）
                        ├── ui.js + ui/reports.js + ui/achievements.js（面板、報表與成就清單）
                        └── scene.js
                              ├── scene/objects.js（攤位與物件）
                              └── scene/effects.js（事件特效）
```

依賴方向的主要原則：

- `data.js` 提供設定與靜態內容，不依賴其他遊戲模組。
- 領域模組提供純計算或狀態操作；DOM、Canvas 與瀏覽器事件由 `game.js`、`ui.js`、`scene.js` 負責。
- `scene/objects.js` 與 `scene/effects.js` 透過 renderer API 使用投影和繪圖工具，不直接承擔遊戲規則。
- 報表 DOM 由 `ui/reports.js` 管理，不把財務結算邏輯放在 UI。

## 2. 模組責任

| 模組 | 主要責任 | 不應承擔的責任 |
| --- | --- | --- |
| `dist/data.js` | 菜單、原料、顧客、事件、攤位座標、價格、成本、相機與動畫參數 | 操作 DOM、存檔、結算分錄 |
| `dist/campaign.js` | 30 夜敘事週期、跨週節點、市集公告卡、週決策選項、結局判定 | 場景繪圖、localStorage 存取 |
| `dist/achievements.js` | 成就目錄、存檔正規化、依既有營運狀態判定首次里程碑；不提供經濟獎勵 | DOM 呈現或阻塞式互動 |
| `dist/state.js` | 新遊戲狀態、存檔正規化、存取結果、當晚顧客／事件、成本與帳本試算 | Canvas 繪製、DOM 面板 |
| `dist/safety.js` | 攤型階段、安全設備條件、容量、保險費與有效保障判定 | 實際法規或保險契約解讀 |
| `dist/accounting.js` | 內部科目表、借貸分錄、資產清冊、折舊／攤銷、週工作底稿與週期報表 | 遊戲畫面與營運選單 |
| `dist/engine.js` | 對遊戲動作套用規則並更新共用 state；回傳動作結果 | 瀏覽器事件綁定、Canvas 呈現 |
| `dist/game.js` | 建立 state、引擎、UI、場景；管理對話框、鍵盤／指標操作、提示、存檔與動畫循環 | 細部會計科目計算、物件幾何繪製 |
| `dist/ui.js` | 營運、備料、設備、人事、攤位與安全管理面板 | 規則計算、財務分錄 |
| `dist/ui/reports.js` | 日記簿、週底稿、期末工作底稿、報表與科目表 DOM | 修改引擎或帳務規則 |
| `dist/ui/achievements.js` | 篩選成就分類、顯示解鎖紀錄與灰階未解鎖項目 | 改變遊戲經濟或保存額外進度計數 |
| `dist/scene.js` | 相機、投影、Canvas 尺寸、角色路徑／更新、場景合成、命中測試 | 攤位商業規則、會計計算 |
| `dist/scene/objects.js` | 攤位、桌椅、招牌、燈籠等場景物件繪製 | 保存場景座標或決定營運結果 |
| `dist/scene/effects.js` | 雨、煙、節慶、事件視覺效果 | 產生經濟事件或收支 |
| `dist/app.js` | 呼叫並匯出 `boot()` 啟動入口 | 遊戲規則 |

## 3. 執行與狀態邊界

遊戲引擎採用**單一可變 state**，引擎、UI 與場景共用目前世界。這讓本機單人遊戲的動作處理直接且可序列化，但不是事件溯源、多人同步或任意時間回溯架構。

瀏覽器動作由 `game.js` 集中執行：

1. 捕捉 state 快照。
2. 呼叫 `engine.js` 動作。
3. 若規則回傳 `{ ok, changed, message }`，依結果更新畫面與存檔。
4. 若操作過程發生例外，使用快照還原同一個 root state、重新渲染並提示錯誤，避免半套狀態寫入。

快照目前以 JSON 序列化 plain data。若未來加入函式、Symbol、循環參照或非 enumerable 欄位，需重新評估快照策略。

## 4. 場景架構

場景使用 Canvas 2D 程序化繪製與斜視投影。相機狀態包含 yaw、elevation、zoom、panX、panY；互動包含滑鼠／觸控拖曳、縮放、旋轉、角度調整與重置。固定場景資料目前包含一個主店與四個鄰攤，遊客、店員與環境行人於場景座標中移動。

攤位視覺資料以既有營運 state 推導，而非另存座標：主店依攤型與擴店次數改變幾何、桌椅、燈籠與煙霧；被接手的鄰攤提升可見度並顯示所屬狀態。這是固定場景內的成長回饋，不代表地圖已能無限生成或自由探索。

## 5. 驗證與交付

- 核心規則測試位於 `tests/game.test.js`，執行 `npm test`。
- 推送與 Pull Request 的自動檢查由 `.github/workflows/test.yml` 執行相同測試。
- 靜態發布入口由 `.openai/hosting.json` 的 `static.directory` 指向 `dist`。
- 調整 UI／場景時需在桌面與窄版尺寸檢查；調整遊戲規則時需增補可重現的測試。

## 6. 已知限制

- state 是 mutable；沒有多人同步、伺服器存檔、undo 時間軸或事件溯源。
- 主要場景範圍固定；既有畫面擴張不等同於新增可營運區塊。
- 長期紀錄有上限，限制定義於 `state.js` 的正規化／帳務結算流程。
- 報表是教育性簡化模擬，並非正式財報、稅務申報或法規遵循工具。

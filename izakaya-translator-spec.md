# 居酒屋手寫菜單翻譯 App — Claude Code 建置規格 v1

> 給 Claude Code 的建置依據。請先閱讀全文，輸出檔案清單與實作計畫供我確認後，再開始寫碼（依本專案慣例：未經核可不得直接寫碼）。

---

## 0. 一句話目標

iPhone 上「拍照 → 翻譯日本（含手寫）菜單」的純前端 PWA。菜單可為**紙本、黑板或牆面手寫**。功能：依分類顯示譯文、點譯文可在原圖上定位高亮、點 ⓘ 取得料理說明。**自用、無後端、無建置步驟。**

---

## 1. 技術約束（硬性）

- **形態**：單一 `index.html`（HTML + CSS + JS 全部內聯）＋ `manifest.json` ＋ icon。**不得**引入框架（React/Vue）、不得需要編譯、不得有 build step。
- **不得使用任何外部 JS 函式庫**（除非必要且以 CDN 單檔引入並說明理由）。
- **無後端**：瀏覽器直接呼叫 Gemini REST API。
- **API key**：使用者自行貼上，存於 `localStorage`，**絕不寫死在程式碼**。
- **平台**：iPhone Safari，需支援「加入主畫面」全螢幕運作。
- **語言**：所有「使用者看得到的文字」與「翻譯／說明輸出」一律 **繁體中文、台灣用語**；嚴禁簡體字、香港或中國大陸用語。程式碼註解可用英文。

---

## 2. 檔案結構

```
/
├── index.html        # 全部畫面與邏輯
├── manifest.json     # PWA 設定
└── icons/
    └── icon-180.png  # apple-touch-icon（可先放佔位圖）
```

---

## 3. 畫面與版面（mobile portrait）

單頁切換三種狀態（非多檔路由）：

### 3.1 設定頁（首次或無 key 時）
- 標題、簡短說明（去哪拿 Gemini key：aistudio.google.com，免費）。
- `<input type="password">` 貼上 key、「儲存」按鈕（存進 localStorage）。
- 已有 key 時顯示遮罩（如 `AIza••••••1234`）＋「清除 key」。

### 3.2 主畫面
- 頂部工具列：「拍照／選圖」按鈕（`<input type="file" accept="image/*" capture="environment">`）、齒輪進設定。
- **原圖區（可收合，置頂）**：顯示正規化後的菜單照片，預設展開；提供收合／展開切換。被點選品項在此以高亮框標示。
- **清單區（在下，可捲動）**：依分類分組，小標題顯示 `category_zh`（附 `category_jp` 小字）。每列品項：`name_zh`（主）、`name_jp`（小字）、`price`、ⓘ 鈕。
- **模型列／重試**：結果畫面常駐顯示「目前結果來源：Flash／Pro」標記，並有一顆「高精度(Pro)重試」鍵（見 §5.5）。
- 互動：
  - 點品項列 → 原圖區若收合則自動展開並捲入視野，對應 box 高亮（短暫閃爍 + 持續描邊）。
  - 點 ⓘ → 由下方滑出說明 sheet（見 §6）。
- 狀態：loading、error（見 §10）、empty（尚未拍照的引導）。

### 3.3 設計基調
- 乾淨、高對比、適合餐廳昏暗環境與單手操作；觸控目標 ≥ 44pt。
- 不過度裝飾；以可讀性與定位準確為優先。

---

## 4. 影像處理（關鍵，務必照做）

1. 取得照片後，**先經 canvas 正規化**：
   - 修正 iPhone EXIF 方向（`createImageBitmap(file, { imageOrientation: 'from-image' })` 或等效），確保畫出來是正的。
   - 等比縮放至**長邊 ≤ `MAX_LONG_EDGE`**，預設 **2048px**，設為易改常數。
     - 說明：近拍紙本 1568px 已足；黑板／牆面字小、距離遠，2048px 較保險。走免費層，成本非考量。
   - 輸出 `image/jpeg`，品質約 0.85，取得 base64。
2. **送 Gemini 的影像，與畫面顯示的影像，必須是同一張正規化後的結果。** 否則 box_2d 會與顯示錯位。顯示時直接用這張正規化後的 dataURL。

---

## 5. Gemini 呼叫 — 解析菜單（首次）

### 5.1 端點與模型
- 端點：`POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent`
- 標頭：`x-goog-api-key: <使用者的 key>`、`Content-Type: application/json`
- 模型常數（皆設為易改常數）：
  - `FLASH_MODEL = "gemini-2.5-flash"` — **預設**，免費層，視覺＋空間理解。
  - `PRO_MODEL`  = 現行 Pro 模型 id（如 `gemini-3-pro` 類；**建置時向官方確認**）。Pro 較能讀潦草手寫。
- **建置時請向 Google 官方文件確認現行 model id 與端點版本（名稱常變）。**
- 注意：`PRO_MODEL` 需該 key 所屬專案已**開通帳單（付費 Tier）**才能呼叫，否則回 403。

### 5.2 請求
- `contents`：一則 user 訊息，含 `inline_data`（base64 JPEG）＋下方文字 prompt。
- `generationConfig`：`response_mime_type: "application/json"` ＋ `response_schema`（見 §5.4）。
- 可選旋鈕：辨識/定位任務可嘗試降低 thinking budget 以穩定輸出；保留為可調參數。

### 5.3 Prompt（直接使用，可微調）

```
你是日本餐廳菜單的翻譯與結構化引擎。輸入是一張菜單照片，可能是紙本、黑板或牆面手寫，
可能含手寫字、反光或斜角拍攝。

請完成：
1. 辨識菜單上所有品項，包含手寫字。
2. 依菜單原有分類分組；若沒有分類，全部歸入一個 category_zh 為「未分類」的群組。
3. 將每個分類名稱與品項名稱翻譯成「繁體中文、台灣用語」。嚴禁簡體字、香港或中國大陸用語。
4. 為每個品項標出其文字在圖片上的位置 box_2d，格式 [ymin, xmin, ymax, xmax]，
   數值為相對整張圖、正規化到 0 至 1000 的整數（y 在前）。框可略寬，求涵蓋該品項文字即可。
5. 若某品項對外國旅客明顯冷門或不易理解，is_unusual 設為 true，否則 false。
6. 讀不出或不確定的字，name_jp 盡量保留原樣，name_zh 盡力翻譯，
   無法判讀則於 name_zh 標註「（難以辨識）」。
7. 不得杜撰菜單上不存在的品項。價格若無則為 null。

只輸出符合 schema 的 JSON，不要任何額外文字、說明或 markdown 標記。
```

### 5.4 回應 schema（response_schema）

```json
{
  "type": "object",
  "properties": {
    "categories": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "category_jp": { "type": "string" },
          "category_zh": { "type": "string" },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "name_jp": { "type": "string" },
                "name_zh": { "type": "string" },
                "price": { "type": "string", "nullable": true },
                "box_2d": {
                  "type": "array",
                  "items": { "type": "integer" },
                  "minItems": 4, "maxItems": 4
                },
                "is_unusual": { "type": "boolean" }
              },
              "required": ["id","name_jp","name_zh","box_2d","is_unusual"]
            }
          }
        },
        "required": ["category_zh","items"]
      }
    }
  },
  "required": ["categories"]
}
```

> 若模型未回傳穩定的 `id`，前端可在解析後自行補上唯一 id。

### 5.5 模型升級（手動，草案A）

- 預設一律用 `FLASH_MODEL`（免費）。
- 結果畫面**常駐「高精度(Pro)重試」鍵**；按下時以 `PRO_MODEL` 對**同一張正規化影像**重跑 §5 解析，覆蓋結果。
- **不做任何自動信心切換、不自動呼叫 Pro。** 只有使用者按鍵才會用到付費模型（成本可控、符合「免費能搞定就不呼叫付費」）。
- UI 需標示目前結果來自哪個模型（Flash／Pro）。
- 若 Pro 呼叫回 403 / PERMISSION_DENIED（key 所屬專案未開通付費）→ 提示「此 API key 未開通付費方案，無法使用高精度模型；請至 Google AI Studio 開啟帳單，或繼續使用免費結果」，並保留原 Flash 結果不清空。

---

## 6. 功能三 — 料理說明（點 ⓘ 才呼叫）

- 點 ⓘ → 對該品項發第二次呼叫（純文字，可用 `FLASH_MODEL`）。
- 結果**快取進該品項物件**（如 `item.explanation`），同品項不重複呼叫。
- 以由下滑出的 sheet 顯示品項名與說明、關閉鈕。
- Prompt：

```
用繁體中文（台灣用語，禁簡體與大陸用語）向台灣旅客說明這道日本料理：
{name_jp}（{name_zh}）。
請說明：它是什麼、口感與風味特色、常見吃法。3 至 4 句，口語、實用，不要寒暄。
```

---

## 7. 功能二 — 原圖高亮（百分比疊框）

- box_2d 為 0–1000 正規化、`[ymin, xmin, ymax, xmax]`（**y 在前**）。
- 原圖外層 `position: relative`；`<img>` `display:block; width:100%`。
- 高亮框為 `position:absolute` 子元素，以百分比定位：
  - `top = ymin / 10 + "%"`
  - `left = xmin / 10 + "%"`
  - `height = (ymax - ymin) / 10 + "%"`
  - `width = (xmax - xmin) / 10 + "%"`
- 與螢幕尺寸、圖片縮放無關。
- **Graceful degrade**：若 box_2d 缺失、長度非 4、或 `ymax<=ymin`／`xmax<=xmin`，該品項不顯示框、清單列仍正常（不得整體報錯）。

---

## 8. API key 管理

- 讀：啟動時讀 `localStorage`；無 key → 進設定頁。
- 寫：設定頁儲存後寫入 `localStorage`。
- 清除：提供清除鈕。
- key 視為純文字（自用、單一可信來源），不另加密。

---

## 9. PWA 設定

- `index.html` `<head>` 需含：
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  - `<meta name="apple-mobile-web-app-capable" content="yes">`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
  - `<meta name="apple-mobile-web-app-title" content="菜單翻譯">`
  - `<link rel="apple-touch-icon" href="icons/icon-180.png">`
  - `<link rel="manifest" href="manifest.json">`
- `manifest.json`：`name`、`short_name`、`start_url: "."`、`display: "standalone"`、`background_color`、`theme_color`、`icons`。

---

## 10. 錯誤處理

- key 無效 / 401 / 403（一般）→ 「API key 無效，請至設定重新輸入」。
- Pro 專屬 403 / PERMISSION_DENIED（未開通付費）→ 見 §5.5，保留 Flash 結果並提示開通帳單。
- 429（額度）→ 「呼叫太頻繁或已達免費額度上限，稍後再試」。
- JSON 解析失敗 → 「辨識結果格式異常，請重拍或重試」，並於 console 記錄原始回應。
- 網路失敗 → 提示需連網。
- 所有錯誤皆可重試，不可白屏。

---

## 11. 驗收標準（v1 完成定義）

1. iPhone Safari 可「加入主畫面」，啟動為全螢幕。
2. 無 key 時導向設定頁；貼 key 後可用；重啟 app key 仍在。
3. 拍／選一張日本菜單照片（紙本或黑板/牆面），數秒內顯示**依分類分組**的繁中譯文清單。
4. 點任一品項，原圖區展開並在**大致正確位置**顯示高亮框。
5. 點 ⓘ 顯示繁中說明；再次點同品項不重複呼叫。
6. 「高精度(Pro)重試」鍵可用：按下以 Pro 重跑並覆蓋結果，UI 正確標示模型來源；未開通付費時給出 §5.5 提示且不清空原結果。
7. 全程介面與輸出均為繁體中文台灣用語，無簡體、無大陸用語。
8. 缺 box、壞 JSON、無網路等情況不致白屏，皆有可重試提示。

---

## 12. v1 排除範圍（不要做）

- Service Worker／離線快取。
- 多裝置同步、雲端儲存。
- 多語言（v1 僅日文 → 繁體中文）。
- 像素級精準框（v1 僅區塊級定位）。
- **任何自動模型切換／信心評分切換**（刻意排除，升級一律手動）。
- 帳號、登入、付費流程。

---

## 13. 已知風險（實作時心裡有數，非缺陷）

- 密集手寫的 box 精度有限 → 已以區塊級 + graceful degrade 因應。
- **黑板／牆面常為斜角、反光、遠距拍攝，文字透視變形 → 功能二定位會比近拍紙本明顯更弱**，預期僅「大致指出區域」。
- Flash 對潦草手寫可能讀錯字 → 提供手動 Pro 重試。
- iOS 可能在長期未使用或低儲存時清除 localStorage → 偶爾需重貼 key（可接受）。

---

## 14. 建議實作順序

1. 骨架：單頁三狀態切換 + 設定頁 key 存取 + PWA meta/manifest。
2. 影像：拍照 → canvas 正規化（EXIF + 長邊縮放）→ 顯示。
3. Gemini 解析呼叫（Flash）+ schema + 清單分類渲染。
4. 功能二：百分比疊框 + 點選互動 + degrade。
5. 功能三：ⓘ 說明呼叫 + 快取 + sheet。
6. 模型升級：Pro 重試鍵 + 模型來源標示 + 未開通付費提示。
7. 錯誤處理與驗收逐項過。

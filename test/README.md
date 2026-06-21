# 測試（自動化前端驗證）

`run.js` 用無頭 Chromium 載入真正的 `index.html`，把 Gemini REST API 以假回應
mock 掉，自動跑完整流程，**不需要任何 API key、不需人工操作**。

## 涵蓋範圍
- 設定頁 / API key 的存、遮罩、清除、重啟保存
- 影像正規化（長邊 ≤ 2048）與顯示
- 依分類渲染清單、`category_zh/jp`、價格
- `box_2d → 百分比`疊框換算；壞 box 的 graceful degrade
- 點圖 ↔ 點清單 的雙向定位與字幕條同步
- 「值得一試」徽章與 AI 加註提示
- ⓘ 料理說明與快取（同品項不重複呼叫）
- Pro 重試覆蓋結果、來源標示、Pro 403 保留 Flash 結果
- 錯誤處理：401 / 429 / 壞 JSON 的可重試錯誤卡
- 暫時性 503 的自動重試復原

> 不涵蓋：Gemini 的**實際辨識品質**（手寫讀取、框的真實準度）。那需要真 key
> 打真 API，請在真機上人工確認。

## 執行
需要 Node 與 Playwright（含 Chromium 瀏覽器）。

```bash
node test/run.js
```

若環境未安裝瀏覽器：

```bash
npx playwright install chromium
```

通過時印出 `PASS N   FAIL 0` 並以 exit code 0 結束。

/* Automated end-to-end test for the Izakaya Translator PWA.
 *
 * Loads the real index.html in headless Chromium, mocks the Gemini REST API,
 * and exercises every front-end path: settings/key, image normalization,
 * category rendering, box overlays + graceful degrade, two-way tap-to-locate,
 * explanation caching, Pro retry, and error handling.
 *
 * The Gemini recognition quality itself is intentionally NOT tested here (it
 * needs a real API key and a live call); this suite verifies all client logic.
 *
 * Run:  node test/run.js     (needs Playwright + a Chromium browser installed)
 */
const path = require("path");
const { execSync } = require("child_process");

// Resolve Playwright whether installed locally or globally.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  const gRoot = execSync("npm root -g").toString().trim();
  ({ chromium } = require(path.join(gRoot, "playwright")));
}

const APP_URL = "file://" + path.resolve(__dirname, "../index.html");
const MENU_IMG = path.resolve(__dirname, "fixtures/menu.png");
const GEMINI_GLOB = "**/generativelanguage.googleapis.com/**";

let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
function check(name, cond) {
  if (cond) { pass++; log("  PASS " + name); }
  else { fail++; log("  FAIL " + name); }
}

function parsePayload(source) {
  // Two categories. One item has an invalid box (zero area) and one has a
  // wrong-typed box -> both must gracefully degrade (no overlay, row intact).
  // One item is_unusual -> 值得一試 badge + AI note.
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({
    categories: [
      { category_jp: "刺身", category_zh: "生魚片", items: [
        { id: "a1", name_jp: "真鯛刺身", name_zh: "真鯛生魚片", price: "730",
          box_2d: [100, 200, 180, 600], is_unusual: false },
        { id: "a2", name_jp: "てっさ", name_zh: "河豚生魚片", price: "780",
          box_2d: [200, 200, 280, 600], is_unusual: true },
      ]},
      { category_jp: "揚げ物", category_zh: "炸物", items: [
        { name_jp: "とらフグの唐揚げ", name_zh: "酥炸虎河豚", price: "980",
          box_2d: [9, 9, 9, 9], is_unusual: true },        // invalid: zero area
        { name_jp: "ナスの揚げ浸し", name_zh: "炸浸茄子", price: null,
          box_2d: "oops", is_unusual: false },              // invalid: wrong type
      ]},
    ], _source: source,
  }) }] } }] };
}
function proPayload() {
  const p = parsePayload("pro");
  p.candidates[0].content.parts[0].text =
    p.candidates[0].content.parts[0].text.replace("真鯛生魚片", "真鯛生魚片(Pro)");
  return p;
}
const explainPayload = () => ({ candidates: [{ content: { parts: [{
  text: "這是一道經典的日式料理。口感細緻，風味清爽。常見沾醬油與山葵享用。" }] } }] });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => { fail++; log("  FAIL pageerror: " + e.message); });

  const mock = { mode: "ok", parseCalls: 0, explainCalls: 0, proCalls: 0, attempt: 0 };
  await page.route(GEMINI_GLOB, async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch (e) {}
    const parts = (body.contents && body.contents[0] && body.contents[0].parts) || [];
    const isParse = parts.some(p => p.inline_data);
    const isPro = url.includes("gemini-3.1-pro-preview");
    const j = (status, obj) => route.fulfill({ status,
      headers: { "content-type": "application/json", ...cors }, body: JSON.stringify(obj) });

    if (isParse && isPro) { mock.proCalls++;
      if (mock.mode === "pro403") return j(403, { error: { message: "PERMISSION_DENIED", status: "PERMISSION_DENIED" } });
      return j(200, proPayload());
    }
    if (isParse) { mock.parseCalls++;
      if (mock.mode === "401") return j(401, { error: { message: "API key not valid" } });
      if (mock.mode === "429") return j(429, { error: { message: "RESOURCE_EXHAUSTED" } });
      if (mock.mode === "badjson") return j(200, { candidates: [{ content: { parts: [{ text: "NOT JSON {{{" }] } }] });
      if (mock.mode === "transient") { mock.attempt++; if (mock.attempt === 1) return j(503, { error: { message: "overloaded" } }); return j(200, parsePayload("flash")); }
      return j(200, parsePayload("flash"));
    }
    mock.explainCalls++;
    return j(200, explainPayload());
  });

  const reset = async () => {
    await page.goto(APP_URL);
    await page.evaluate(() => localStorage.clear());
    await page.goto(APP_URL);
  };
  const loadMenu = async () => {
    await page.setInputFiles("#file-input", MENU_IMG);
    await page.waitForSelector("#busy.show", { timeout: 8000 }).catch(() => {});
    await page.waitForSelector("#busy.show", { state: "hidden", timeout: 20000 });
    await page.waitForSelector("#list-area .item-row", { timeout: 5000 });
  };

  log("\nT1 no key -> settings view");
  await reset();
  check("settings view active", await page.isVisible("#view-settings"));
  check("main view hidden", !(await page.isVisible("#view-main")));
  check("input block shown", await page.isVisible("#key-input-block"));

  log("\nT2 save key + persistence");
  await page.fill("#key-input", "AIzaTESTKEY1234");
  await page.click("#save-key-btn");
  check("main view after save", await page.isVisible("#view-main"));
  check("key in localStorage", !!(await page.evaluate(() => localStorage.getItem("izakaya.geminiKey"))));
  await page.goto(APP_URL);
  check("still main after reload (key persists)", await page.isVisible("#view-main"));
  await page.click("#settings-btn");
  const mask = await page.textContent("#key-mask");
  check("key masked AIza...1234", /AIza/.test(mask) && /1234/.test(mask) && /•/.test(mask));
  await page.click("#go-main-btn");

  log("\nT3 image normalize + list render");
  mock.mode = "ok";
  await loadMenu();
  check("image displayed", await page.isVisible("#menu-img"));
  check("normalized image within 2048 long edge", await page.evaluate(() => {
    const i = document.getElementById("menu-img"); return i.naturalWidth > 0 && i.naturalWidth <= 2048 && i.naturalHeight <= 2048; }));
  check("two category groups", (await page.$$(".cat-group")).length === 2);
  check("four item rows", (await page.$$(".item-row")).length === 4);
  check("category_zh shown", (await page.textContent(".cat-title")).includes("生魚片"));
  check("值得一試 badge present", (await page.$$(".badge-unusual")).length >= 1 && (await page.textContent(".badge-unusual")).includes("值得一試"));
  check("AI note shown", await page.isVisible(".ai-note"));
  check("only valid boxes rendered (2)", (await page.$$(".hl-box")).length === 2);
  const boxStyle = await page.evaluate(() => { const b = document.querySelector('.hl-box[data-id="a1"]'); return b ? { t: b.style.top, l: b.style.left, h: b.style.height, w: b.style.width } : null; });
  check("box_2d -> percentage correct", boxStyle && boxStyle.t === "10%" && boxStyle.l === "20%" && boxStyle.h === "8%" && boxStyle.w === "40%");

  log("\nT4 tap list row -> box + caption sync");
  await page.click('.item-row[data-id="a2"]');
  check("box a2 active", await page.evaluate(() => document.querySelector('.hl-box[data-id="a2"]').classList.contains("active")));
  check("caption visible", await page.isVisible("#image-cap"));
  check("caption zh = 河豚生魚片", (await page.textContent("#cap-zh")) === "河豚生魚片");
  check("caption price = 780", (await page.textContent("#cap-price")) === "780");
  check("row a2 marked sel", await page.evaluate(() => document.querySelector('.item-row[data-id="a2"]').classList.contains("sel")));

  log("\nT5 tap box on image -> caption + list sync");
  await page.click('.hl-box[data-id="a1"]');
  check("caption zh = 真鯛生魚片", (await page.textContent("#cap-zh")) === "真鯛生魚片");
  check("row a1 now sel", await page.evaluate(() => document.querySelector('.item-row[data-id="a1"]').classList.contains("sel")));
  check("row a2 deselected", await page.evaluate(() => !document.querySelector('.item-row[data-id="a2"]').classList.contains("sel")));

  log("\nT6 explanation sheet + caching");
  mock.explainCalls = 0;
  await page.click('.item-row[data-id="a1"] .info-btn');
  await page.waitForFunction(() => { const b = document.getElementById("sheet-body"); return b && !b.classList.contains("loading") && b.textContent.length > 5; }, { timeout: 10000 });
  check("sheet visible", await page.isVisible("#sheet"));
  check("explanation text shown", (await page.textContent("#sheet-body")).length > 5);
  check("explain API called once", mock.explainCalls === 1);
  await page.click("#sheet-close");
  await page.click('.item-row[data-id="a1"] .info-btn');
  await page.waitForTimeout(300);
  check("cached: no second explain call", mock.explainCalls === 1);
  await page.click("#sheet-close");

  log("\nT7 Pro retry overwrites + source tag");
  mock.mode = "ok";
  await page.click("#pro-retry-btn");
  await page.waitForFunction(() => /Pro/.test(document.getElementById("source-tag")?.textContent || ""), { timeout: 10000 });
  check("source tag shows Pro", (await page.textContent("#source-tag")).includes("Pro"));
  check("results overwritten by Pro", (await page.textContent("#list-area")).includes("真鯛生魚片(Pro)"));
  check("Pro API was called", mock.proCalls >= 1);

  log("\nT8 Pro 403 -> billing toast, keep results");
  await loadMenu();
  check("source back to Flash", (await page.textContent("#source-tag")).includes("Flash"));
  mock.mode = "pro403";
  await page.click("#pro-retry-btn");
  await page.waitForSelector("#toast.show", { timeout: 10000 });
  check("toast mentions billing", /付費|帳單/.test(await page.textContent("#toast")));
  check("Flash results preserved", (await page.$$(".item-row")).length === 4);
  check("source still Flash (not cleared)", (await page.textContent("#source-tag")).includes("Flash"));

  log("\nT9 parse errors -> inline retryable card");
  mock.mode = "401";
  await page.setInputFiles("#file-input", MENU_IMG);
  await page.waitForSelector(".error-card", { timeout: 10000 });
  check("401 -> error card", await page.isVisible(".error-card"));
  check("401 message about key", (await page.textContent(".error-card .msg")).includes("API key"));
  check("401 offers 前往設定", await page.isVisible("#err-settings"));
  mock.mode = "429";
  await page.click("#err-retry");
  await page.waitForFunction(() => /額度|頻繁/.test(document.querySelector(".error-card .msg")?.textContent || ""), { timeout: 10000 });
  check("429 message", /額度|頻繁/.test(await page.textContent(".error-card .msg")));
  mock.mode = "badjson";
  await page.click("#err-retry");
  await page.waitForFunction(() => /格式異常/.test(document.querySelector(".error-card .msg")?.textContent || ""), { timeout: 10000 });
  check("badjson message", (await page.textContent(".error-card .msg")).includes("格式異常"));

  log("\nT10 transient 503 -> auto-retry recovers");
  mock.mode = "transient"; mock.attempt = 0;
  await page.click("#err-retry");
  await page.waitForSelector("#list-area .item-row", { timeout: 20000 });
  check("recovered after retry (rows shown)", (await page.$$(".item-row")).length === 4);
  check("retry actually happened (>=2 attempts)", mock.attempt >= 2);

  await browser.close();
  log("\n================  RESULT  ================");
  log("PASS " + pass + "   FAIL " + fail);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("HARNESS ERROR", e); process.exit(2); });

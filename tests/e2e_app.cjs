// End-to-end check of the real app in Chromium: node tests/e2e_app.cjs [url]
// Verifies the verdicts for known names and measures lookup time on the device.
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://localhost:8000/";
const CASES = [
  ["Acetam 500", "TWIN", "Levetiracetam"],
  ["Olip", "TWIN", "eye drop"],
  ["Adnil", "TWIN", "Clonazepam"],
  ["Biopam", "TWIN", "Pralidoxime"],
  ["Dolo 650", "TWIN", "Nimesulide"],
  ["Crocin", "NO TWIN", "Paracetamol"],
  ["Saridon", "NOT FOUND", "not in our catalogue"],
  ["Metformin", "GENERIC", "not a brand"],
  ["acetum", "TWIN", "Levetiracetam"], // misheard spelling still lands on Acetam
  ["அசிட்டம் 500", "TWIN", "Levetiracetam"], // said or typed in Tamil
  ["ಡೋಲೋ 650", "TWIN", "Nimesulide"], // said or typed in Kannada
];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector("#q");
  const times = [];
  let pass = 0;
  for (const [q, verdict, expect] of CASES) {
    await page.evaluate(() => { document.getElementById("result").innerHTML = ""; });
    await page.fill("#q", q);
    const t0 = Date.now();
    await page.click("button.go");
    await page.waitForSelector(".verdict .badge");
    times.push(Date.now() - t0);
    const badge = await page.textContent(".verdict .badge");
    const body = await page.textContent("#result");
    const ok = badge.trim() === verdict && body.toLowerCase().includes(expect.toLowerCase());
    pass += ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${q.padEnd(14)} -> ${badge.trim()}  (${times.at(-1)} ms)`);
  }
  // Photo: render a pack label, upload it, and check the brand, the exact medicine, the kind and the spoken answer.
  await page.evaluate(() => { window.__said = []; const S = window.speechSynthesis; const o = S.speak.bind(S); S.speak = (u) => { window.__said.push(u.text); try { o(u); } catch (e) { /* headless */ } }; });
  const PACKS = [
    ["Adnil 0.5", "Clonazepam Tablets IP", "Each uncoated tablet contains Clonazepam IP 0.5 mg", "clonazepam", "Tablet", "This is Adnil 0.5"],
    ["Olip", "Olopatadine Hydrochloride Ophthalmic Solution", "Eye Drops 5 ml", "olopatadine", "Eye drops", "eye or nose allergy"],
    ["Acetam", "Piracetam Injection IP", "For intravenous or intramuscular use · 200 mg/ml", "piracetam", "Injection", "an injection"],
  ];
  const fs = require("fs"), os = require("os"), path = require("path");
  const shot = await browser.newPage({ viewport: { width: 900, height: 500 } });
  for (const [brand, generic, small, ing, kind, said] of PACKS) {
    await shot.setContent(`<div id="p" style="width:820px;padding:40px;background:#f3f6fb;font-family:Arial">
      <div style="font-size:30px;color:#333">${generic}</div><div style="font-size:78px;font-weight:700;color:#0b4ea2;margin:14px 0">${brand}</div>
      <div style="font-size:22px;color:#444">${small}</div><div style="font-size:20px;color:#666;margin-top:12px">Mfd. by Example Labs · 10 x 10</div></div>`);
    const file = path.join(os.tmpdir(), `tp_${brand.replace(/\W/g, "")}.png`);
    await (await shot.$("#p")).screenshot({ path: file });
    await page.evaluate(() => { window.__said = []; });
    const t0 = Date.now();
    await page.setInputFiles("#photo", file);
    await page.waitForFunction(() => !document.querySelector(".photocard.reading") && document.querySelector(".photocard .kindtag"), null, { timeout: 180000 });
    await page.waitForFunction(() => window.__said.length > 0, null, { timeout: 10000 }).catch(() => {});
    const r = await page.evaluate(() => ({ brand: document.querySelector(".pc-brand")?.textContent || "", kind: document.querySelector(".kindtag")?.textContent || "",
      pick: document.querySelector(".mcard.pick")?.textContent || "", said: window.__said.join(" ") }));
    const ok = r.brand.toLowerCase().startsWith(brand.split(" ")[0].toLowerCase()) && r.kind.toLowerCase() === kind.toLowerCase()
      && r.pick.toLowerCase().includes(ing) && r.said.toLowerCase().includes(said.toLowerCase());
    pass += ok;
    console.log(`${ok ? "PASS" : "FAIL"}  photo ${brand.padEnd(8)} -> ${r.brand} · ${r.kind} · said: ${r.said.slice(0, 70)}  (${Date.now() - t0} ms)`);
  }
  // Tap the answer (Olip has a sounds-alike list: the case that used to do nothing)
  await page.fill("#q", "Olip");
  await page.click("button.go");
  await page.waitForSelector("#dq .answer");
  await page.evaluate(() => { window.__said = []; });
  await page.click("#dq .answer >> nth=1");
  await page.waitForTimeout(300);
  const tap = await page.evaluate(() => ({ first: document.querySelector("#cards .mcard")?.classList.contains("pick"), said: window.__said.join(" ") }));
  const tapOk = tap.first && tap.said.length > 0;
  pass += tapOk;
  console.log(`${tapOk ? "PASS" : "FAIL"}  tap answer      -> moved to top, said: ${tap.said}`);
  // Talk mode (for people who cannot read the strip): photo in, full answer spoken, expiry read
  await shot.setContent(`<div id="p" style="width:820px;padding:40px;background:#fff;font-family:Arial"><div style="font-size:30px">Clonazepam Tablets IP</div>
    <div style="font-size:78px;font-weight:700;color:#0b4ea2">Adnil 0.5</div><div style="font-size:30px;margin-top:12px">EXP. 08/2025</div></div>`);
  const tfile = path.join(os.tmpdir(), "tp_talk.png");
  await (await shot.$("#p")).screenshot({ path: tfile });
  await page.goto(URL + "#/talk");
  await page.waitForSelector("#tScan");
  await page.evaluate(() => { window.__said = []; });
  await page.setInputFiles("#tFile", tfile);
  await page.waitForSelector(".talk-card", { timeout: 120000 });
  await page.waitForFunction(() => /Found it/.test(window.__said.join(" ")), null, { timeout: 8000 }).catch(() => {});
  const talk = await page.evaluate(() => window.__said.join(" "));
  const talkOk = /Adnil 0\.5, a tablet/.test(talk) && /Clonazepam/.test(talk) && /August 2025/.test(talk) && /expired/.test(talk);
  pass += talkOk;
  console.log(`${talkOk ? "PASS" : "FAIL"}  talk mode       -> said: ${talk}`);
  await page.goto(URL);
  await page.waitForSelector("#q");
  const TOTAL = CASES.length + PACKS.length + 2;

  // warm lookups (shards cached) for a latency figure
  const warm = [];
  for (let i = 0; i < 20; i++) {
    for (const q of ["Acetam 500", "Olip", "Zentra 100"]) {
      await page.fill("#q", q);
      const t0 = Date.now();
      await page.click("button.go");
      await page.waitForFunction((n) => document.querySelector("#result .verdict h2")?.textContent.toLowerCase().includes(n), q.split(" ")[0].toLowerCase());
      warm.push(Date.now() - t0);
    }
  }
  warm.sort((a, b) => a - b);
  const res = { cases: TOTAL, passed: pass, page_errors: errors, warm_lookup_ms_median: warm[Math.floor(warm.length / 2)], warm_lookup_ms_p95: warm[Math.floor(warm.length * 0.95)] };
  console.log(JSON.stringify(res));
  require("fs").writeFileSync(require("path").join(__dirname, "..", "results", "e2e.json"), JSON.stringify(res, null, 2));
  await browser.close();
  process.exit(pass === TOTAL && !errors.length ? 0 : 1);
})();

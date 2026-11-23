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
  ["Crocin", "ONE", "Paracetamol"],
  ["acetum", "TWIN", "Levetiracetam"], // misheard spelling still lands on Acetam
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
    console.log(`${ok ? "PASS" : "FAIL"}  ${q.padEnd(12)} -> ${badge.trim()}  (${times.at(-1)} ms)`);
  }
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
  const res = { cases: CASES.length, passed: pass, page_errors: errors, warm_lookup_ms_median: warm[Math.floor(warm.length / 2)], warm_lookup_ms_p95: warm[Math.floor(warm.length * 0.95)] };
  console.log(JSON.stringify(res));
  require("fs").writeFileSync(require("path").join(__dirname, "..", "results", "e2e.json"), JSON.stringify(res, null, 2));
  await browser.close();
  process.exit(pass === CASES.length && !errors.length ? 0 : 1);
})();

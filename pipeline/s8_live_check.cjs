// Step 8: are the twins still on sale today? Checks a list of twin names against a live Indian
// online pharmacy (1mg): search the name, open each matching product page, read its composition
// and marketer, and record whether two products under one name still share no ingredient.
// Polite by design: one browser, sequential requests, a pause between pages, at most 6 products per name.
// Usage: node pipeline/s8_live_check.cjs roots.json results/live_check_1mg.json
const { chromium } = require("playwright");
const fs = require("fs");

const [, , rootsFile, outFile] = process.argv;
const roots = JSON.parse(fs.readFileSync(rootsFile, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ingSet = (comp) => comp.toLowerCase().split(/\s*\+\s*|,\s*/).map((x) => x.replace(/\(.*?\)/g, "").trim()).filter(Boolean);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: UA });
  const out = { source: "1mg.com", checked_at: new Date().toISOString(), names: [] };
  for (const root of roots) {
    const rec = { root, products: [], live_twin: false, pair: null };
    try {
      await page.goto(`https://www.1mg.com/search/all?name=${encodeURIComponent(root)}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(4500);
      const links = await page.evaluate((root) => [...new Set([...document.querySelectorAll('a[href*="/drugs/"]')]
        .map((a) => a.href).filter((h) => new RegExp(`/drugs/${root}[-_]`, "i").test(h)))], root);
      for (const url of links.slice(0, 6)) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await sleep(2500);
        const t = await page.evaluate(() => document.body.innerText);
        const name = (t.match(/\n([^\n]+)\n\d+ [^\n]*\nComposition:/) || [])[1] || url.split("/drugs/")[1];
        const comp = (t.match(/Composition:\s*\n([^\n]+)/) || [])[1] || "";
        const marketer = (t.match(/Marketer details:\s*\n([^\n]+)/) || [])[1] || "";
        const gone = /discontinued|not available|currently unavailable/i.test(t.slice(0, 4000));
        if (comp) rec.products.push({ name: name.trim(), composition: comp.trim(), marketer: marketer.trim(), url, discontinued: gone });
      }
      const live = rec.products.filter((p) => !p.discontinued);
      outer: for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = ingSet(live[i].composition), b = ingSet(live[j].composition);
        if (!a.some((x) => b.includes(x))) { rec.live_twin = true; rec.pair = [live[i], live[j]]; break outer; }
      }
    } catch (e) { rec.error = String(e.message || e).slice(0, 120); }
    out.names.push(rec);
    console.log(root.padEnd(12), rec.live_twin ? "LIVE TWIN" : "-", rec.products.length, rec.pair ? `${rec.pair[0].name} = ${rec.pair[0].composition} | ${rec.pair[1].name} = ${rec.pair[1].composition}` : (rec.error || ""));
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    await sleep(3000);
  }
  const ok = out.names.filter((n) => n.products.length >= 2);
  out.summary = { names_checked: out.names.length, names_with_2plus_listings: ok.length, still_live_twins: out.names.filter((n) => n.live_twin).length };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.summary));
  await browser.close();
})();

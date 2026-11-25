// Photo reading accuracy on real Indian medicine packs: node tests/test_photo.mjs
//
// Fixtures: text read by PaddleOCR (PP-OCRv4, the same model the app runs in the browser) from
// 181 pack photos of 1mg product pages (front, back and strip sides) and 120 phone-style copies
// (tilted, blurred, darkened, JPEG-compressed). Only the OCR text is stored, not the photos.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(WEB + u, "utf8")) });
const S = await import("../web/js/search.js");
const { interpretPack, readKind, kindOfForm, tokens, readExpiry } = await import("../web/js/photo.js");
await S.loadRoots();
const ING = await S.loadIngredients();
const common = await S.loadCommonWords();
const deps = { ...S, ingNames: ING.filter((r) => r[3]).map((r) => r[0]), common };

// unit checks
assert.deepEqual(tokens("Dolo-650"), ["dolo", "650"]);
assert.deepEqual(tokens("Dol0-1000"), ["dolo", "1000"]);
assert.deepEqual(tokens("Mectin6"), ["mectin", "6"]);
assert.equal(readKind("Pheniramine Maleate Injection I.P. For intramuscular use"), "injection");
assert.equal(readKind("FOR EXTERNAL USE ONLY. NOT FOR INJECTION. Ear Drops"), "ear");
assert.equal(readKind("Olopatadine Ophthalmic Solution"), "eye");
assert.equal(readKind("10 x 10 Tablets"), "tablet");
assert.equal(kindOfForm("oral suspension"), "liquid");
assert.deepEqual(readExpiry(["Mfg. 01/2025", "Expiry Date: 11-27"]), { month: 11, year: 2027 });
assert.deepEqual(readExpiry(["Exp.Date: DEC.2026"]), { month: 12, year: 2026 });
assert.equal(readExpiry(["B.No. X12 Mfg Date 02/2025"]), null); // a manufacturing date is never the expiry
assert.equal(readExpiry(["Expiry Date", "Maximum Retail Price"]), null);

// a stylised logo misread by one letter ("AVil" -> "AVir"), rescued because the printed ingredient matches
const avir = await interpretPack([{ t: "PheniramineMaleateInjectionl.", h: 30 }, { t: "AVir", h: 44 }, { t: "For intramuscular or slow intravenous injection", h: 14 }, { t: "Anti-allergic", h: 14 }, { t: "SANOFI", h: 16 }], deps);
assert.equal(avir.root, "avil");
assert.equal(avir.kind, "injection");

const truthKind = (name) => kindOfForm((name.match(/tablet|capsule|injection|eye drop|ear drop|drops?|spray|syrup|suspension|cream|lotion|gel|paint/i) || [""])[0].replace(/paint/i, "cream").replace(/^drops?$/i, "suspension"));
const fx = JSON.parse(fs.readFileSync(new URL("./photo_fixtures.json", import.meta.url)));
const stats = {};
for (const f of fx) {
  const s = (stats[f.set] ||= { photos: 0, brand_visible: 0, right: 0, wrong: 0, wrong_when_visible: 0, kind_read: 0, kind_right: 0, exact_medicine_right: 0, exact_medicine_wrong: 0 });
  s.photos++;
  const r = await interpretPack(f.lines, deps);
  const visible = f.lines.map((l) => l.t).join(" ").toLowerCase().replace(/[^a-z]/g, "").includes(f.root.replace(/ /g, ""));
  if (visible) s.brand_visible++;
  if (r.root === f.root) {
    s.right++;
    if (r.group) {
      const truth = f.composition.toLowerCase().replace(/\(.*?\)/g, "").split(/\s*\+\s*/).map((x) => x.trim());
      r.group.ings.every((i) => truth.some((t) => t.includes(i) || i.includes(t) || (i === "dimethicone" && t === "simethicone"))) ? s.exact_medicine_right++ : s.exact_medicine_wrong++;
    }
  } else if (r.root) { s.wrong++; if (visible) s.wrong_when_visible++; }
  if (r.kind) { s.kind_read++; if (r.kind === truthKind(f.product)) s.kind_right++; }
}
console.log(JSON.stringify(stats, null, 1));
fs.writeFileSync(new URL("../results/photo_eval.json", import.meta.url), JSON.stringify(stats, null, 1) + "\n");

// guard the accuracy we report (README, Evidence page)
assert.ok(stats.pack.right >= 112, "pack photos: brand found");
assert.ok(stats.pack.wrong <= 4, "pack photos: wrong brand");
assert.equal(stats.pack.wrong_when_visible, 0);
assert.ok(stats.phone.right >= 105, "phone-style photos: brand found");
assert.ok(stats.phone.wrong <= 1, "phone-style photos: wrong brand");
assert.ok(stats.pack.kind_right >= stats.pack.kind_read - 1, "kind of medicine");
console.log("photo: all assertions passed");

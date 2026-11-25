// Turn the text read from a medicine pack photo into: which brand, which exact medicine, and what kind
// (tablet, injection, eye drops...). Pure logic, no DOM: tested in Node on real pack photos (tests/test_photo.mjs).
//
// Indian packs print the generic name biggest ("Paracetamol Tablets IP") and the brand next to it
// ("Dolo-650"). So we never take the biggest word as the brand. Instead:
//   1. find the ingredients printed on the pack,
//   2. find brand candidates (exact catalogue names, or close spellings of OCR typos),
//   3. keep the brand whose catalogue products actually contain those ingredients,
//   4. read the kind of medicine from the words printed on the pack.

export const KINDS = {
  injection: /\binj(ection|ections|\.)?\b|\bvials?\b|\bampoules?\b|\bampuls?\b|intramuscular|intravenous|\bi\.?\s?v\.?\s?use\b|\bfor\s+i\.?m\b|infusion/,
  eye: /eye\s*-?\s*drops?|ophthalmic|eye\s*ointment/,
  ear: /ear\s*-?\s*drops?|\botic\b/,
  spray: /sprays?\b|metered|actuation/,
  inhaler: /inhaler|respules?|rotacaps?|inhalation/,
  cream: /\bcream\b|ointment|\bgel\b|lotion|\btopical\b|mouth\s*paint/,
  liquid: /syrup|suspension|oral\s*(solution|drops|liquid)|\bdrops\b|linctus|expectorant/,
  capsule: /capsules?|\bcaps\b/,
  tablet: /tablets?|\btabs?\b|film[-\s]?coated|mouth\s*dissolving|dispersible|chewable/,
};
const KIND_ORDER = ["injection", "eye", "ear", "spray", "inhaler", "cream", "liquid", "capsule", "tablet"];

/** Catalogue form ("oral suspension", "eye drop") -> one of KINDS. */
export function kindOfForm(form) {
  const f = String(form || "").toLowerCase();
  if (/injection|infusion|vial/.test(f)) return "injection";
  if (/eye/.test(f)) return "eye";
  if (/ear/.test(f)) return "ear";
  if (/nasal|spray/.test(f)) return "spray";
  if (/inhaler|respule|rotacap/.test(f)) return "inhaler";
  if (/cream|ointment|gel|lotion|paste|paint/.test(f)) return "cream";
  if (/syrup|suspension|solution|drop|liquid|linctus|expectorant|emulsion/.test(f)) return "liquid";
  if (/capsule/.test(f)) return "capsule";
  if (/tablet/.test(f)) return "tablet";
  return null;
}

/** What kind of medicine the pack says it is, from its printed words. */
export function readKind(text) {
  // "Not for injection", "do not spray in your mouth": a negated word says nothing about the kind
  const t = String(text).toLowerCase().replace(/[|_]/g, " ").replace(/not\s*(to\s*be\s*used\s*)?for\s*(injection|\w+\s+use)|do\s*not\s*\w+/g, " ");
  for (const k of KIND_ORDER) if (KINDS[k].test(t)) return k;
  // "60 ml" with no other cue: a liquid
  if (/\b\d+\s?ml\b/.test(t)) return "liquid";
  return null;
}

// Words printed on almost every pack that are never the brand.
const LABEL = new Set(`tablet tablets tab tabs capsule capsules cap caps syrup suspension injection inj drops drop eye ear nasal spray
cream gel lotion ointment oral solution ip bp usp i p mg mcg ml gm rx nrx each contains contain film coated sustained release
prolonged controlled extended delivery mouth dissolving dispersible uncoated enteric chewable schedule drug prescription only
warning keep reach children store place cool dry protect light moisture dosage directed physician manufactured marketed mfd mfg
by batch no exp date price mrp incl taxes all strips strip of pharma pharmaceuticals pharmaceutical labs laboratories ltd pvt limited
india healthcare lifesciences life sciences remedies hydrochloride hydrochlorid maleate sodium potassium succinate tartrate
besylate besilate citrate phosphate sulphate sulfate acetate dipropionate furoate monohydrate trihydrate anhydrous equivalent
colour colours colour approved excipients qs paediatric pediatric adult children non drowsy hour hours doses dose metered
single sugar free flavour flavor mint orange vanilla raspberry elaichi antacid antiflatulent anti allergic preparation broad
spectrum antifungal treatment thrush topical solution use only for external local application intramuscular intravenous slow
the and with or not to be in of a an as is it on at from this per day days whole swallowed chewed crushed shake well before
bottle pack box carton tube vial ampoule sterile water retail maximum inclusive expiry`.split(/\s+/));
const LABEL_LONG = [...LABEL].filter((w) => w.length >= 5);

// Spellings on Indian packs that differ from the catalogue's ingredient names.
const SYNONYM = { lignocaine: "lidocaine", acetaminophen: "paracetamol", salbutamol: "salbutamol", amisuipride: "amisulpride",
  frusemide: "furosemide", simethicone: "dimethicone", glibenclamide: "glibenclamide", glyburide: "glibenclamide", besilate: "" };

// Catalogue "ingredients" that are salts, excipients or vaccine words printed on every label.
const NOT_ACTIVE = /^(hydrochloride|yellow fever|freeze-dried|water for|purified water|titanium|iron oxide|sucrose|lactose|starch|talc)/;
const SALT = new Set(["calcium", "sodium", "potassium", "magnesium", "zinc", "chloride", "glycerin", "propylene glycol", "polyethylene glycol", "alcohol"]);
const lettersOnly = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Ingredients printed on the pack. `ingNames` is the catalogue's ingredient list.
 * Glued OCR ("PheniramineMaleateInjection") is handled by matching on letters-only text.
 */
export function readIngredients(lines, ingNames, jaroWinkler) {
  // Letters only, remembering where each printed word starts (also inside glued OCR such as
  // "FexofenadineHydrochloride"), so "s-metoprolol" is not found inside "contains metoprolol".
  const text = lines.join(" \n ");
  let compact = "";
  const starts = new Set();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!/[a-zA-Z]/.test(ch)) continue;
    const prev = text[i - 1] || " ";
    if (!/[a-zA-Z]/.test(prev) || (/[A-Z]/.test(ch) && /[a-z]/.test(prev))) starts.add(compact.length);
    compact += ch.toLowerCase();
  }
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5);
  for (const w of words) if (SYNONYM[w]) { starts.add(compact.length); compact += SYNONYM[w]; }
  const at = (c) => { for (let i = compact.indexOf(c); i >= 0; i = compact.indexOf(c, i + 1)) if (starts.has(i)) return true; return false; };
  const found = [];
  for (const name of ingNames) {
    if (NOT_ACTIVE.test(name)) continue;
    const c = lettersOnly(name);
    if (c.length < 5) continue;
    if (/^[a-z]-/.test(name) && !text.toLowerCase().includes(name.slice(0, 3))) continue; // "s-", "l-", "d-" forms
    if (c.length >= 6 && at(c)) { found.push(name); continue; }
    if (/[\s-]/.test(name) || c.length < 8) { if (c.length < 6 && words.includes(c)) found.push(name); continue; }
    // OCR typos ("Amisuipride", "Ranitiding"): compare same-length windows starting at a word start
    for (const i of starts) {
      if (compact[i] !== c[0]) continue;
      let hit = false;
      for (const L of [c.length - 1, c.length, c.length + 1]) if (jaroWinkler(compact.slice(i, i + L), c) >= 0.94) { hit = true; break; }
      if (hit) { found.push(name); break; }
    }
  }
  // Keep the most specific name ("metoprolol succinate" over "metoprolol"); drop a lone salt word
  // ("calcium" in "atorvastatin calcium") when a real medicine was found next to it.
  let out = found.filter((n) => !found.some((m) => m !== n && lettersOnly(m).includes(lettersOnly(n))));
  if (out.length > 1) out = out.filter((n) => !SALT.has(n));
  // in printed order: the main medicine is usually named first
  const pos = (n) => { const c = lettersOnly(n); const i = compact.indexOf(c); return i < 0 ? compact.indexOf(c.slice(0, 5)) : i; };
  return out.sort((a, b) => pos(a) - pos(b));
}

/** Split a printed line into tokens: letters and numbers apart ("Dolo-650" -> dolo, 650; "Mectin6" -> mectin, 6). */
export function tokens(line) {
  return String(line)
    .replace(/[®™©*]/g, " ")
    .replace(/([a-zA-Z])0(?![0-9])/g, "$1o") // "Dol0-1000": a zero inside a word is the letter o
    .replace(/(\d)[oO](?=[oO]*\b|\s*mg)/g, "$10").replace(/(\d0)[oO]/g, "$10") // "3OO mg" -> 300
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9.]+/g, " ")
    .split(/\s+/).map((x) => x.replace(/^\.+|\.+$/g, "")).filter(Boolean)
    .map((x) => x.toLowerCase());
}

/**
 * Main entry. `ocr` = [{ t: text, h: line height px }], deps = search functions + data.
 * Returns { root, number, kind, ings, group, groupBy, candidates, lines } or { ings, kind } if no brand.
 */
export async function interpretPack(ocr, deps) {
  const { findRoots, confident, productsFor, meanings, ingNames, jaroWinkler, common } = deps;
  const lines = ocr.map((o) => o.t).filter(Boolean);
  const maxH = Math.max(1, ...ocr.map((o) => o.h || 0));
  const kind = readKind(lines.join(" \n "));
  const expiry = readExpiry(lines);
  const ings = readIngredients(lines, ingNames, jaroWinkler);
  const ingWords = new Set(ings.flatMap((n) => n.split(/\s+/)));
  const ingSet = deps.ingSet || (deps.ingSet = new Set(ingNames));

  // 1. brand candidates, span by span. Brands sit on short lines ("Dolo-650", "AVil 25");
  //    sentences ("For fever and pain...") are full of words that happen to be brand names too.
  const cands = new Map();
  ocr.forEach((o) => {
    const tk = tokens(o.t);
    const wordsInLine = tk.filter((x) => /^[a-z]{2,}$/.test(x)).length;
    const lineBonus = wordsInLine <= 3 ? 0.6 : wordsInLine <= 5 ? 0 : -0.8;
    for (let i = 0; i < tk.length; i++) {
      if (!/^[a-z]+$/.test(tk[i])) continue;
      for (let n = 1; n <= 2 && i + n <= tk.length; n++) {
        const parts = tk.slice(i, i + n);
        if (!parts.every((p) => /^[a-z]+$/.test(p))) break;
        const span = parts.join(" ");
        const flat = parts.join("");
        if (flat.length < 3 || LABEL.has(span) || LABEL.has(parts[0]) || parts.every((p) => LABEL.has(p) || p.length < 2)) continue;
        if (ingWords.has(parts[0]) || ings.some((g) => lettersOnly(g).startsWith(flat) && flat.length >= 5)) continue;
        const near = findRoots(span, 6);
        // A stylised logo is often misread by a letter ("AVil" -> "AVir"). When the pack's printed ingredients
        // are known, close spellings whose products contain exactly those ingredients are candidates too.
        const Jn = deps.ingJoined || (deps.ingJoined = "|" + ingNames.join("|"));
        const genericLike = Jn.includes("|" + flat.slice(0, 5)) || (common && common.has(flat)) || LABEL_LONG.some((w) => jaroWinkler(flat, w) >= 0.88) || ings.some((g) => jaroWinkler(flat, lettersOnly(g).slice(0, flat.length + 1)) >= 0.8);
        if (n === 1 && ings.length && wordsInLine <= 2 && flat.length >= 4 && !LABEL.has(flat) && !genericLike) {
          for (const alt of near) {
            const ar = alt.root;
            if (ar.includes(" ") || ar === flat || ingSet.has(ar) || Jn.includes(ar) || ar.slice(0, 2) !== flat.slice(0, 2)
              || Math.abs(ar.length - flat.length) > 1 || jaroWinkler(flat, ar) < 0.85) continue;
            const s0 = 1 + Math.min(alt.score, 1) * 0.5 + ((o.h || 0) / maxH) * 0.8 + lineBonus;
            const prev = cands.get(alt.root);
            if (!prev) cands.set(alt.root, { root: alt.root, s: s0, exact: false, span: flat, number: null, size: (o.h || 0) / maxH, everyday: false, lineBonus, hits: 1, needIng: true });
          }
        }
        let h = near[0];
        let glued = false;
        // glued suffix variants: "ClotrinAC", "AllegraM", "OlezDSR" -> clotrin, allegra, olez
        if ((!h || h.how !== "exact") && n === 1 && flat.length >= 7) {
          for (const k of [1, 2, 3]) {
            const e = findRoots(flat.slice(0, -k), 1)[0];
            if (e && e.how === "exact" && e.root === flat.slice(0, -k) && e.root.length >= 5) { h = e; glued = true; break; }
          }
        }
        if (!h || ingSet.has(h.root)) continue; // a generic name used as a brand ("Paracetamol") is not the brand
        const exact = h.how === "exact" && (h.root === span || h.root.replace(/ /g, "") === flat || glued);
        if (h.how === "exact" && !exact) continue; // "may and" -> brand "may": the span is not the name
        // a cut-off or misread generic name ("_osartan", "Rabeprazoi") is not a brand either
        const J = deps.ingJoined || (deps.ingJoined = "|" + ingNames.join("|"));
        const prefixOfIng = (x) => x.length >= 5 && J.includes("|" + x);
        if ((!exact || glued) && (J.includes(flat) || prefixOfIng(h.root))) continue;
        if (exact && !glued && flat.length >= 6 && prefixOfIng(flat)) continue;
        if (!exact && !(flat.length >= 5 && confident(span, h))) continue;
        const everyday = !!(common && common.has(h.root.replace(/ /g, "")));
        const numAt = tk.slice(i + n, i + n + 3).find((x) => /^\d+(\.\d+)?$/.test(x));
        const size = (o.h || 0) / maxH;
        const s = (exact ? 2 : 1 + h.score) + size * 0.8 + lineBonus + (numAt ? 0.3 : 0) - (everyday ? 1.5 : 0) - (flat.length <= 4 ? 0.4 : 0) + n * 0.05;
        const prev = cands.get(h.root);
        if (!prev || prev.s < s) cands.set(h.root, { root: h.root, s, exact, span, number: numAt || null, size, everyday, lineBonus, hits: (prev?.hits || 0) + 1 });
        else prev.hits++;
      }
    }
  });

  // 2. check each candidate against the ingredients and the kind printed on the pack
  const ranked = [];
  for (const c of [...cands.values()].sort((a, b) => b.s - a.s).slice(0, 14)) {
    const gs = meanings(await productsFor(c.root));
    if (!gs.length) continue;
    let best = null, bestOv = 0;
    for (const g of gs) {
      const ov = g.ings.filter((i) => ings.includes(i)).length / Math.max(g.ings.length, 1);
      if (ov > bestOv) { bestOv = ov; best = g; }
    }
    const kinds = new Set(gs.flatMap((g) => g.forms.map(kindOfForm)));
    let s = c.s + Math.min(c.hits - 1, 2) * 0.3; // a brand is printed several times on a pack
    if (ings.length) s += bestOv > 0 ? 2.5 * bestOv : -1.5;
    if (kind && kinds.has(kind)) s += 0.3;
    const makerWords = new Set(gs.flatMap((g) => g.makers.join(" ").toLowerCase().split(/[^a-z]+/)));
    const numberOk = !!c.number && gs.some((g) => g.strengths.some((x) => (x.match(/\d+(?:\.\d+)?/g) || []).includes(c.number)));
    if (numberOk) s += 0.4;
    else if (c.number && c.lineBonus > 0) s -= 0.8; // "AVir 50": no Avir comes in 50, so it is probably a misread
    if (c.needIng && bestOv < 1) continue; // a spelling guess must match the printed ingredients fully
    ranked.push({ ...c, score: s, gs, ingMatch: bestOv, ingGroup: best, makerWords, numberOk });
  }
  // The company name ("Micro Labs", "Nectar Pharma") is printed big too: it is not the brand.
  for (const r of ranked) if (ranked.some((o) => o !== r && o.makerWords.has(r.span.replace(/ /g, "")))) r.score -= 2.5;
  ranked.sort((a, b) => b.score - a.score);
  // Accept a name only when the pack backs it up: its printed ingredients match, or it is an exact,
  // non-everyday brand name standing on its own line.
  const short = (r) => r.span.replace(/ /g, "").length <= 4;
  const big = (r) => r.size >= (short(r) ? 0.7 : 0.45);
  const backed = (r) => r.ingMatch > 0 && (!r.everyday || r.lineBonus > 0) && (!short(r) || big(r) || r.numberOk || r.hits > 1) && r.score >= 3.2;
  const standalone = (r) => r.exact && !r.everyday && r.lineBonus >= 0 && big(r) && !(ings.length && r.ingMatch === 0) && r.score >= 2.6;
  // A misread brand ("Allegray 180mg") counts when the printed number is one of its real strengths.
  const misread = (r) => !r.exact && r.lineBonus > 0 && big(r) && r.numberOk && !(ings.length && r.ingMatch === 0);
  const top = ranked.find((r) => backed(r) || standalone(r) || misread(r));
  if (!top) return { root: null, kind, ings, expiry, candidates: ranked.slice(0, 3).map((r) => r.root), lines };

  // 3. which of the name's medicines is this one?
  const gs = top.gs;
  let group = null, groupBy = null;
  if (top.ingMatch > 0 && top.ingGroup) {
    const tied = gs.filter((g) => g.ings.filter((i) => ings.includes(i)).length / Math.max(g.ings.length, 1) === top.ingMatch);
    if (tied.length === 1) { group = top.ingGroup; groupBy = "ingredient"; }
  }
  if (!group && top.number) {
    const byNum = gs.filter((g) => g.strengths.some((s) => (s.match(/\d+(?:\.\d+)?/g) || []).includes(top.number)));
    if (byNum.length === 1) { group = byNum[0]; groupBy = "number"; }
  }
  if (!group && kind) {
    const byKind = gs.filter((g) => g.forms.some((f) => kindOfForm(f) === kind));
    if (byKind.length === 1) { group = byKind[0]; groupBy = "kind"; }
  }
  if (!group && gs.length === 1) { group = gs[0]; groupBy = "only"; }
  return { root: top.root, number: top.number, kind, ings, expiry, group, groupBy, candidates: ranked.slice(1, 4).map((r) => r.root), lines };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/**
 * Expiry date printed on the pack ("EXP. 12/2026", "Exp.Date: DEC.2026", "Use before 11-27").
 * Only a date right after an expiry label counts, so the manufacturing date is never mistaken for it.
 * Returns { month, year } or null.
 */
export function readExpiry(lines) {
  const L = lines.map((l) => String(l).toLowerCase());
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/\b(exp(?:iry|iration)?|use\s*before|best\s*before)\b\.?\s*(?:date)?\s*[:.\-]?/);
    if (!m) continue;
    // the value is on the same line after the label, or alone on the next line
    const rest = [L[i].slice(m.index + m[0].length), L[i + 1] || ""];
    for (const r of rest) {
      const v = r.slice(0, 24);
      let d = v.match(/^\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/);
      if (d) {
        const month = +d[1], year = d[2].length === 2 ? 2000 + +d[2] : +d[2];
        if (month >= 1 && month <= 12 && year >= 2015 && year <= 2045) return { month, year };
      }
      d = v.match(/^\s*([a-z]{3,4})\.?\s*[\/\-.,]?\s*'?(\d{4}|\d{2})\b/);
      if (d && MONTHS[d[1]]) {
        const year = d[2].length === 2 ? 2000 + +d[2] : +d[2];
        if (year >= 2015 && year <= 2045) return { month: MONTHS[d[1]], year };
      }
      if (/\d/.test(v.slice(0, 6))) break; // a number we cannot parse: do not look further
    }
  }
  return null;
}

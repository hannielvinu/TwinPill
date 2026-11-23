// Name lookup: exact brand match, then spelling and sound neighbours. Runs fully in the browser.
import { phoneticKey } from "./phonetic.js";
import { devoice, indicNorm, skeleton } from "./translit.js";

let ROOTS = null; // [root, phon, count, twinFlag(0 none,1 family,2 cross), harm, highAlert]
let RANKER = null; // learned weights (pipeline/s6b_ranker.py)
const shardCache = new Map();

export async function loadRoots() {
  if (!ROOTS) {
    const [r, w] = await Promise.all([fetch("data/roots.json"), fetch("data/ranker.json").catch(() => null)]);
    ROOTS = await r.json();
    try { RANKER = w && w.ok !== false ? await w.json() : null; } catch { RANKER = null; }
  }
  return ROOTS;
}

export function shardOf(root) {
  const k = root.replace(/ /g, "").slice(0, 2);
  return /^[a-z]{2}$/.test(k) ? k : "__";
}

export async function productsFor(root) {
  const k = shardOf(root);
  if (!shardCache.has(k)) shardCache.set(k, fetch(`data/p/${k}.json`).then((r) => r.json()));
  const shard = await shardCache.get(k);
  return (shard[root] || []).map((p) => ({
    name: p[0], maker: p[1], strength: p[2], form: p[3], route: p[4], ings: p[5],
    use: p[6], useTa: p[7], highAlert: !!p[8], price: p[9], suffix: p[10] || "", incomplete: !!p[11], useKn: p[12] || "",
  }));
}

export function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(i + win + 1, lb);
    for (let j = lo; j < hi; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

export function levSim(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** Same 8 features as pipeline/ranker.py rank_features(). */
export function rankFeatures(flat, ph, r, jw) {
  const rflat = r[0].replace(/ /g, "");
  return [jw, r[1] === ph && ph.length >= 2 ? 1 : 0, levSim(ph, r[1]), levSim(flat, rflat), Math.log10(r[2] + 1),
    r[0].includes(" ") ? 1 : 0, rflat[0] === flat[0] ? 1 : 0, Math.abs(rflat.length - flat.length)];
}

function learnedScore(x) {
  let z = RANKER.intercept;
  for (let i = 0; i < x.length; i++) z += RANKER.coef[i] * (x[i] - RANKER.mean[i]) / RANKER.scale[i];
  return z;
}

/** Split what the person typed or said into a name part and any number printed after it. */
export function parseQuery(q) {
  const raw = String(q || "").toLowerCase().trim();
  const nums = raw.match(/\d+(?:\.\d+)?/g) || [];
  const name = raw.replace(/\d+(?:\.\d+)?\s*(mg|mcg|ml|gm|g|iu|%)?/g, " ")
    .replace(/\b(tablet|tablets|capsule|capsules|syrup|injection|drop|drops|cream|gel|strip|mg|ml)\b/g, " ")
    .replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return { name, number: nums[0] || null };
}

/** Return the best brand match plus sound/spelling neighbours. */
export function findRoots(name, limit = 8, opts = {}) {
  if (!ROOTS || !name) return [];
  const flat = name.replace(/ /g, "");
  const ph = phoneticKey(flat);
  const dph = devoice(ph); // used only for Tamil/Kannada input, where voicing is not written
  const firstWord = name.split(" ")[0];
  const out = [];
  for (const r of ROOTS) {
    const root = r[0];
    const rflat = root.replace(/ /g, "");
    let score;
    let how;
    if (root === name || rflat === flat) { score = 2; how = "exact"; }
    else if (root === firstWord && name.includes(" ")) { score = 1.9; how = "exact"; }
    else {
      if (Math.abs(rflat.length - flat.length) > 3) continue;
      const indicSame = opts.indic && devoice(r[1]) === dph && dph.length >= 2;
      if (rflat[0] !== flat[0] && r[1] !== ph && !indicSame) continue;
      const jw = jaroWinkler(flat, rflat);
      const sameSound = (r[1] === ph || indicSame) && ph.length >= 2;
      if (jw < 0.80 && !sameSound) continue;
      if (RANKER) {
        const z = learnedScore(rankFeatures(flat, ph, r, jw));
        score = 1 / (1 + Math.exp(-z)); // 0..1, always below an exact match
      } else {
        if (jw < 0.86 && !sameSound) continue;
        score = jw + (sameSound ? 0.08 : 0) - 0.2;
      }
      how = sameSound ? "sounds" : "spelling";
    }
    out.push({ root, count: r[2], twin: r[3], harm: r[4], highAlert: !!r[5], score, how });
  }
  out.sort((a, b) => b.score - a.score || b.count - a.count);
  return out.slice(0, limit);
}

/** Group a root's products by ingredient set: each group is one possible "meaning" of the name. */
export function meanings(products) {
  const groups = new Map();
  for (const p of products) {
    const key = [...p.ings].sort().join("|");
    if (!groups.has(key)) groups.set(key, { key, ings: p.ings, use: p.use, useTa: p.useTa, useKn: p.useKn, highAlert: p.highAlert, products: [], complete: 0 });
    const g = groups.get(key);
    g.products.push(p);
    if (!p.incomplete) g.complete++;
  }
  const gs = [...groups.values()];
  for (const g of gs) {
    g.makers = [...new Set(g.products.map((p) => p.maker))];
    g.forms = [...new Set(g.products.map((p) => p.form))];
    g.routes = [...new Set(g.products.map((p) => p.route))];
    g.strengths = [...new Set(g.products.map((p) => p.strength).filter(Boolean))];
    g.suffixes = [...new Set(g.products.map((p) => p.suffix || ""))];
  }
  for (const g of gs) g.incomplete = g.complete === 0; // source may have dropped an ingredient (it lists at most two)
  gs.sort((a, b) => b.products.length - a.products.length);
  // A "twin" exists when two meanings with reliable ingredient lists share no ingredient at all.
  const twinWith = (g) => (g.incomplete ? [] : gs.filter((h) => h !== g && !h.incomplete && !h.ings.some((i) => g.ings.includes(i))));
  for (const g of gs) g.unrelated = twinWith(g).length;
  return gs;
}

export function isTwin(gs) {
  return gs.some((g) => g.unrelated > 0);
}

/**
 * Is a non-exact hit close enough to show as "did you mean"? The learned ranker orders candidates but is
 * not calibrated for names that are simply absent from the catalogue, so we also require the candidate to
 * sound the same or be spelt within ~20% of what was typed or heard.
 */
export function confident(name, hit, opts = {}) {
  if (!hit) return false;
  if (hit.how === "exact") return true;
  if (opts.indic) {
    // findRootsIndic score: >= 1.5 means the sound-normalised names are identical. Otherwise require a
    // strong match that is clearly ahead of the runner-up, so an absent brand is not mapped to a look-alike.
    if (hit.score >= 1.5) return true;
    const second = opts.second ? opts.second.score : 0;
    return hit.score >= 0.96 && hit.score - second >= 0.03;
  }
  const flat = name.replace(/ /g, ""), rflat = hit.root.replace(/ /g, "");
  if (flat.length < 4) return false;
  const sameKey = phoneticKey(flat) === phoneticKey(rflat) || (opts.indic && devoice(phoneticKey(flat)) === devoice(phoneticKey(rflat)));
  const jwMin = opts.indic ? 0.78 : 0.85; // transliteration from Tamil/Kannada is approximate
  return hit.score >= (opts.indic ? 0.3 : 0.5) && jaroWinkler(flat, rflat) >= jwMin && (sameKey || levSim(flat, rflat) >= 0.8);
}

let INGS = null; // [name, use, useTa, nBrands, topBrands, highAlert]
export async function loadIngredients() {
  if (!INGS) INGS = await fetch("data/ingredients.json").then((r) => r.json());
  return INGS;
}

/** A generic (molecule) name such as "metformin", typed instead of a brand. */
export function findIngredient(name) {
  if (!INGS || !name || name.length < 4) return null;
  let best = null;
  for (const r of INGS) {
    if (!r[3]) continue;
    const s = r[0] === name ? 2 : (r[0][0] === name[0] ? jaroWinkler(name, r[0]) : 0);
    if (s >= 0.94 && (!best || s > best.s)) best = { s, name: r[0], use: r[1], useTa: r[2], brands: r[3], top: r[4], highAlert: !!r[5], useKn: r[6] || "" };
  }
  return best;
}

const numOf = (s) => (String(s).match(/\d+(?:\.\d+)?/) || [null])[0];

/** Which groups match a number the person read off the strip (e.g. "500"). */
export function matchNumber(gs, number) {
  if (!number) return gs;
  return gs.filter((g) => g.strengths.some((s) => (s.match(/\d+(?:\.\d+)?/g) || []).includes(number)));
}

/** An ingredient every reliable meaning shares (e.g. pantoprazole for all "Pan" products), if any. */
export function commonIngredient(gs) {
  if (!gs.length) return null;
  return gs[0].ings.find((i) => gs.every((g) => g.ings.includes(i))) || null;
}

/**
 * The single question that best separates the unrelated meanings:
 * form first (tablet vs eye drop), then the printed number, then letters after the name, then the company.
 */
export function decidingQuestion(gs) {
  const top = gs.slice(0, 4);
  if (top.length < 2) return null;
  const forms = top.map((g) => g.forms[0]);
  if (new Set(forms).size === top.length) {
    return { kind: "form", options: top.map((g) => ({ label: g.forms[0], group: g })) };
  }
  const nums = top.map((g) => new Set(g.strengths.map(numOf).filter(Boolean)));
  const disjoint = nums.every((a, i) => nums.every((b, j) => i === j || ![...a].some((x) => b.has(x))));
  if (disjoint && nums.every((s) => s.size)) {
    return { kind: "strength", options: top.map((g, i) => ({ label: [...nums[i]].slice(0, 3).join(" / "), group: g })) };
  }
  const sufs = top.map((g) => new Set(g.suffixes));
  const sufDisjoint = sufs.every((a, i) => sufs.every((b, j) => i === j || ![...a].some((x) => b.has(x))));
  if (sufDisjoint) {
    return { kind: "suffix", options: top.map((g, i) => ({ label: [...sufs[i]].map((x) => (x ? x.toUpperCase() : "—")).slice(0, 3).join(" / "), group: g })) };
  }
  const makers = top.map((g) => new Set(g.makers));
  const makerDisjoint = makers.every((a, i) => makers.every((b, j) => i === j || ![...a].some((x) => b.has(x))));
  if (makerDisjoint) return { kind: "company", options: top.map((g) => ({ label: g.makers[0], group: g })) };
  // Same company, overlapping suffixes: ask for the full printed name.
  return { kind: "fullname", options: top.map((g) => ({ label: g.products[0].name.replace(/\s+(tablet|capsule|syrup|injection|suspension|drops?)\b.*$/i, ""), group: g })) };
}


let INDIC = null; // [norm, skeleton] per root, built once on first Tamil/Kannada query
/**
 * Candidates for a name heard or typed in Tamil/Kannada script (already transliterated to Latin).
 * Score = mean of Jaro-Winkler on the sound-normalised name and on its consonant skeleton, with a tiny
 * popularity tie-break. An exact catalogue match still wins outright.
 */
export function findRootsIndic(name, limit = 8) {
  if (!ROOTS || !name) return [];
  if (!INDIC) INDIC = ROOTS.map((r) => { const n = indicNorm(r[0]); return [n, skeleton(n)]; });
  const q = indicNorm(name), qs = skeleton(q);
  const out = [];
  for (let i = 0; i < ROOTS.length; i++) {
    const r = ROOTS[i], [n, sk] = INDIC[i];
    if (!n || Math.abs(n.length - q.length) > 3) continue;
    if (n === q) { out.push({ root: r[0], count: r[2], twin: r[3], harm: r[4], highAlert: !!r[5], score: 1.5 + Math.log10(r[2] + 1) * 0.01, how: "sounds" }); continue; }
    if (n[0] !== q[0] && sk[0] !== qs[0]) continue;
    const sc = 0.5 * jaroWinkler(q, n) + 0.5 * jaroWinkler(qs, sk);
    if (sc < 0.8) continue;
    out.push({ root: r[0], count: r[2], twin: r[3], harm: r[4], highAlert: !!r[5], score: sc + Math.log10(r[2] + 1) * 0.01, how: "sounds" });
  }
  out.sort((a, b) => b.score - a.score || b.count - a.count);
  return out.slice(0, limit);
}

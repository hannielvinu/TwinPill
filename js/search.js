// Name lookup: exact brand match, then spelling and sound neighbours. Runs fully in the browser.
import { phoneticKey } from "./phonetic.js";

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
    use: p[6], useTa: p[7], highAlert: !!p[8], price: p[9], suffix: p[10] || "",
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
export function findRoots(name, limit = 8) {
  if (!ROOTS || !name) return [];
  const flat = name.replace(/ /g, "");
  const ph = phoneticKey(flat);
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
      if (rflat[0] !== flat[0] && r[1] !== ph) continue;
      const jw = jaroWinkler(flat, rflat);
      const sameSound = r[1] === ph && ph.length >= 2;
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
    if (!groups.has(key)) groups.set(key, { key, ings: p.ings, use: p.use, useTa: p.useTa, highAlert: p.highAlert, products: [] });
    groups.get(key).products.push(p);
  }
  const gs = [...groups.values()];
  for (const g of gs) {
    g.makers = [...new Set(g.products.map((p) => p.maker))];
    g.forms = [...new Set(g.products.map((p) => p.form))];
    g.routes = [...new Set(g.products.map((p) => p.route))];
    g.strengths = [...new Set(g.products.map((p) => p.strength).filter(Boolean))];
    g.suffixes = [...new Set(g.products.map((p) => p.suffix || ""))];
  }
  gs.sort((a, b) => b.products.length - a.products.length);
  // A "twin" exists when two meanings share no ingredient at all.
  const twinWith = (g) => gs.filter((h) => h !== g && !h.ings.some((i) => g.ings.includes(i)));
  for (const g of gs) g.unrelated = twinWith(g).length;
  return gs;
}

export function isTwin(gs) {
  for (let i = 0; i < gs.length; i++)
    for (let j = i + 1; j < gs.length; j++)
      if (!gs[i].ings.some((x) => gs[j].ings.includes(x))) return true;
  return false;
}

const numOf = (s) => (String(s).match(/\d+(?:\.\d+)?/) || [null])[0];

/** Which groups match a number the person read off the strip (e.g. "500"). */
export function matchNumber(gs, number) {
  if (!number) return gs;
  const hit = gs.filter((g) => g.strengths.some((s) => (s.match(/\d+(?:\.\d+)?/g) || []).includes(number)));
  return hit.length ? hit : gs;
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
  return { kind: "company", options: top.map((g) => ({ label: g.makers[0], group: g })) };
}

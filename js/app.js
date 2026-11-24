import { T, FORM_TA, FORM_KN } from "./i18n.js";
import { toLatin, hasIndic } from "./translit.js";
import { loadRoots, findRoots, parseQuery, productsFor, meanings, isTwin, matchNumber, decidingQuestion, confident, loadIngredients, findIngredient, commonIngredient, findRootsIndic, bestFromSpeech, loadCommonWords } from "./search.js";

let lang = "en";
try { lang = localStorage.getItem("tp_lang") || "en"; } catch { /* private mode */ }
const t = (k, ...a) => { const v = T[lang][k] ?? T.en[k]; return typeof v === "function" ? v(...a) : v; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap = (s) => String(s || "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sent = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const formLabel = (f) => (lang === "ta" ? FORM_TA[f] || f : lang === "kn" ? FORM_KN[f] || f : f);
const pickUse = (o) => (lang === "ta" ? o.useTa || o.use_ta : lang === "kn" ? o.useKn || o.use_kn : null) || o.use;
const useLabel = (g) => pickUse(g) || ({ ta: "வகை தெரியவில்லை", kn: "ವರ್ಗ ತಿಳಿದಿಲ್ಲ" }[lang] || "class not listed");
const SPEECH = { en: "en-IN", ta: "ta-IN", kn: "kn-IN" };
const view = document.getElementById("view");
let lastQuery = "";
let lastHeard = null; // { heard, root } when the query came from the microphone
let LIVE = null;      // twins re-checked on a live pharmacy (results/live_check_1mg.json → data/live.json)
let shownGroups = [];

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = lang;
  document.getElementById("langSel").value = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
}
document.getElementById("langSel").addEventListener("change", (e) => {
  lang = e.target.value;
  try { localStorage.setItem("tp_lang", lang); } catch { /* ignore */ }
  route();
});

/* ---------- router ---------- */
const routes = { "": renderCheck, atlas: renderAtlas, evidence: renderEvidence, how: renderHow };
function route() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  (routes[path] || renderCheck)(new URLSearchParams(query || ""));
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("on", (a.dataset.route === "check" ? "" : a.dataset.route) === path));
  applyLang();
}
window.addEventListener("hashchange", route);

/* ---------- check page ---------- */
function renderCheck(params) {
  view.innerHTML = document.getElementById("tpl-check").innerHTML;
  applyLang();
  const q = document.getElementById("q");
  document.getElementById("searchForm").addEventListener("submit", (e) => { e.preventDefault(); runQuery(q.value); });
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { q.value = c.dataset.q; runQuery(c.dataset.q); }));
  document.getElementById("micBtn").addEventListener("click", onMic);
  document.getElementById("photo").addEventListener("change", onPhoto);
  loadRoots().then(() => fetch("data/stats.json")).then((r) => r.json()).then((s) => {
    const el = document.getElementById("ctr");
    if (el) countUp(el, s.twin_roots_cross_company);
  }).catch(() => {});
  const pre = params.get("q") || lastQuery;
  if (pre) { q.value = pre; runQuery(pre); }
}

function countUp(el, target) {
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / 1100);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString("en-US");
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const setStatus = (html) => { const s = document.getElementById("status"); if (s) s.innerHTML = html; };

async function runQuery(text) {
  lastQuery = text;
  const box = document.getElementById("result");
  if (!box) return;
  const indic = hasIndic(text); // typed or spoken in Tamil/Kannada script: compare by sound in Latin letters
  const opts = { indic };
  const { name, number } = parseQuery(indic ? toLatin(text) : text);
  if (!name) { box.innerHTML = ""; return; }
  await Promise.all([loadRoots(), loadIngredients()]);
  if (!LIVE) LIVE = await fetch("data/live.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  let hits = findRoots(name, 8, opts);
  if (indic && !(hits[0] && hits[0].how === "exact")) {
    hits = findRootsIndic(name, 8);
    opts.second = hits[1];
  }
  const exact = hits[0] && hits[0].how === "exact";
  const chip = (r) => `<button class="chip" data-q="${esc(r)}">${esc(cap(r))}</button>`;
  const wireChips = () => box.querySelectorAll("button.chip[data-q]").forEach((b) => b.addEventListener("click", () => { document.getElementById("q").value = b.dataset.q; runQuery(b.dataset.q); }));

  // A generic (molecule) name: explain it instead of guessing a brand.
  const ing = !exact ? findIngredient(name) : null;
  if (ing) {
    box.innerHTML = `<div class="verdict info"><span class="badge">GENERIC</span><div><h2>${esc(t("generic_title", cap(ing.name)))}</h2>
      <p>${esc(t("used_for"))}: <b>${esc(pickUse(ing))}</b>. ${esc(t("generic_sub", ing.brands.toLocaleString("en-US")))}</p></div></div>
      <div class="sounds"><h4>${esc(t("generic_brands"))}</h4><div class="chips" style="margin-top:10px">${ing.top.map(chip).join("")}</div></div>
      <p class="disclaimer">${esc(t("disclaimer"))}</p>`;
    wireChips();
    return;
  }
  // Not in the catalogue, or only a weak look-alike: say so plainly, never present a guess as the answer.
  if (!hits.length || !confident(name, hits[0], opts)) {
    const near = hits.filter((h) => h.score >= 0.2).slice(0, 5);
    box.innerHTML = `<div class="verdict unknown"><span class="badge">NOT FOUND</span><div><h2>${esc(t("nf_title", text.trim()))}</h2><p>${esc(t("nf_sub"))}</p></div></div>
      ${near.length ? `<div class="sounds"><h4>${esc(t("nf_closest"))}</h4><p class="muted small">${esc(t("nf_closest_sub"))}</p><div class="chips" style="margin-top:10px">${near.map((h) => chip(h.root)).join("")}</div></div>` : ""}`;
    wireChips();
    return;
  }
  const main = hits[0];
  const prods = await productsFor(main.root);
  const gs = meanings(prods);
  const twin = isTwin(gs);
  const display = cap(main.root);

  let html = "";
  if (lastHeard && lastHeard.root === main.root) {
    html += `<div class="heardcard"><div><span class="hl-label">${esc(t("ai_heard"))}</span><b>“${esc(lastHeard.heard)}”</b></div><div class="arrow">→</div><div><span class="hl-label">${esc(t("we_found"))}</span><b>${esc(display)}</b></div></div>`;
  }
  lastHeard = null;
  if (!exact && !html.includes("heardcard")) {
    const others = hits.slice(1, 4).filter((h) => (indic ? h.score >= 1.5 : confident(name, h, opts)));
    html += `<div class="didyou">${esc(t("dym", text.trim()))} <b>${esc(display)}</b>${others.length ? ` ${esc(t("dym_others"))} ${others.map((h) => chip(h.root)).join(" ")}` : ""}</div>`;
  }
  if (twin) {
    const unrelated = gs.filter((g) => g.unrelated > 0);
    const kindNote = new Set(gs.flatMap((g) => g.makers)).size > 1 && main.twin === 2 ? t("cross_note") : t("family_note");
    const live = LIVE?.names?.[main.root];
    const liveLine = live ? `<p class="live">✓ ${esc(t("live_ok", LIVE.date))}: ${live.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a> = ${esc(p.composition)}`).join(" · ")}</p>` : "";
    html += `<div class="verdict twin"><span class="badge">TWIN</span><div><h2>${esc(t("twin_title", unrelated.length, display))}</h2><p>${esc(kindNote)}</p>${liveLine}</div></div>`;
  } else {
    const common = commonIngredient(gs);
    const title = gs.length === 1 ? t("safe_title", display) : common ? t("family_title", display, cap(common)) : t("related_title", display);
    html += `<div class="verdict safe"><span class="badge">NO TWIN</span><div><h2>${esc(title)}</h2><p>${esc(t("safe_sub"))}</p></div></div>`;
  }

  // Always show the unrelated meanings first: the biggest group, then whatever shares nothing with it.
  const head = gs.find((g) => !g.incomplete) || gs[0];
  const unrel = gs.filter((g) => g !== head && !g.incomplete && !head.incomplete && !g.ings.some((i) => head.ings.includes(i)));
  const rest = gs.filter((g) => g !== head && !unrel.includes(g));
  let shown = [head, ...unrel, ...rest].slice(0, 4);
  let autoPick = -1;
  if (number && !matchNumber(gs, number).length) {
    html += `<div class="didyou">${esc(t("no_number", display, number))}</div>`;
  }
  if (twin && number) {
    const hit = matchNumber(gs, number);
    if (hit.length === 1) autoPick = shown.indexOf(hit[0]);
    if (hit.length && hit.length < gs.length) {
      html += `<div class="question"><div class="label">${esc(t("number_hit", number))}</div><h3>${hit.map((g) => esc(cap(g.ings.join(" + "))) + " · " + esc(useLabel(g))).join("<br>")}</h3></div>`;
    }
  }
  if (twin) {
    const dq = decidingQuestion([head, ...unrel].slice(0, 4).length > 1 ? [head, ...unrel].slice(0, 4) : shown);
    if (dq) {
      const art = (x) => (lang === "en" ? (/^[aeiou]/i.test(x) ? "an " : "a ") + x : x);
      let qtext = dq.kind === "form" ? t("q_form").replace("{a}", art(formLabel(dq.options[0].label))).replace("{b}", art(formLabel(dq.options[1].label)))
        : dq.kind === "strength" ? t("q_strength") : dq.kind === "suffix" ? t("q_suffix") : dq.kind === "fullname" ? t("q_fullname") : t("q_company");
      html += `<div class="question" id="dq"><div class="label">${esc(t("ask"))}</div><h3>${esc(qtext)}</h3>
        <div class="muted small" style="color:#d9d6f2;margin-bottom:10px">${esc(t("pick"))}</div>
        <div class="answers">${dq.options.map((o, i) => `<button class="answer" data-i="${i}"><b>${esc(dq.kind === "form" ? cap(formLabel(o.label)) : o.label)}</b><span>${esc(useLabel(o.group))}</span></button>`).join("")}</div>
        <div class="qactions"><button class="speak" id="speakBtn">🔊 ${esc(t("speak"))}</button>
        <a class="share" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText(display, main.root, qtext, dq))}">${esc(t("share"))}</a></div></div>`;
      setTimeout(() => wireQuestion(dq, qtext, autoPick), 0);
    }
  }

  shownGroups = shown;
  html += `<div class="twins" id="cards">${shown.map((g, i) => card(g, i)).join("")}</div>`;
  if (gs.length > 4) html += `<p class="muted small">${esc(t("and_more", gs.length - 4))}</p>`;

  const near = hits.slice(1).filter((h) => h.score >= 0.25 && h.root.replace(/ /g, "").length >= 4 && confident(main.root, { ...h, score: 1 })).slice(0, 5);
  if (near.length) {
    const rows = await Promise.all(near.map(async (h) => {
      const g2 = meanings(await productsFor(h.root));
      const mainIngs = new Set(gs.flatMap((g) => g.ings));
      const differs = !g2[0].ings.some((i) => mainIngs.has(i));
      return `<li><button data-q="${esc(h.root)}">${esc(cap(h.root))}</button><span class="how">${h.how === "sounds" ? "sounds alike" : "spelt alike"}</span>
        <span>${esc(cap(g2[0].ings.join(" + ")))} · ${esc(useLabel(g2[0]))}</span>${differs ? `<span class="ha">different medicine</span>` : ""}</li>`;
    }));
    html += `<div class="sounds"><h4>${esc(t("sounds_title"))}</h4><p class="muted small">${esc(t("sounds_sub"))}</p><ul>${rows.join("")}</ul></div>`;
  }
  html += `<p class="disclaimer">${esc(t("disclaimer"))}</p>`;
  box.innerHTML = html;
  box.querySelectorAll(".sounds button").forEach((b) => b.addEventListener("click", () => { document.getElementById("q").value = b.dataset.q; runQuery(b.dataset.q); }));
  wireChips();
  if (window.innerWidth < 760) box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function shareText(display, root, qtext, dq) {
  const lab = (o) => (dq.kind === "form" ? `${display} ${formLabel(o.label)}` : dq.kind === "company" ? `${display} (${o.label})` : dq.kind === "fullname" ? o.label : `${display} ${o.label}`);
  const lines = dq.options.map((o) => `• ${lab(o)} → ${useLabel(o.group)}`).join("\n");
  return `${t("share_intro", display)}\n${lines}\n${t("share_ask", qtext)}\n${t("share_tail")}\nhttps://hannielvinu.github.io/TwinPill/#/?q=${encodeURIComponent(root)}`;
}

function card(g, i) {
  const names = [...new Set(g.products.map((p) => p.name))];
  return `<article class="mcard" data-i="${i}">
    <span class="tag">${esc(t("used_for"))}</span>${g.highAlert ? `<span class="ha">${esc(t("high_alert"))}</span>` : ""}${g.incomplete ? `<span class="partial" title="${esc(t("partial_tip"))}">${esc(t("partial"))}</span>` : ""}
    <div class="use">${esc(sent(useLabel(g)))}</div>
    <dl>
      <dt>${esc(t("contains"))}</dt><dd>${esc(cap(g.ings.join(" + ")))}</dd>
      <dt>${esc(t("forms"))}</dt><dd>${esc(g.forms.map(formLabel).join(", "))}</dd>
      ${g.strengths.length ? `<dt>${esc(t("strengths"))}</dt><dd>${esc(g.strengths.slice(0, 5).join(", "))}</dd>` : ""}
      <dt>${esc(t("made_by"))}</dt><dd>${esc(g.makers.slice(0, 2).join(", "))}${g.makers.length > 2 ? ` ${esc(t("and_more", g.makers.length - 2))}` : ""}</dd>
    </dl>
    <div class="names">${names.slice(0, 4).map((n) => `<span class="pill">${esc(n)}</span>`).join("")}${names.length > 4 ? `<span class="pill">${esc(t("and_more", names.length - 4))}</span>` : ""}</div>
  </article>`;
}

function wireQuestion(dq, qtext, autoPick = -1) {
  const root = document.getElementById("dq");
  if (!root) return;
  setTimeout(() => { if (autoPick >= 0) { const i = dq.options.findIndex((o) => o.group === shownGroups[autoPick]); root.querySelectorAll(".answer")[i]?.click(); } }, 50);
  root.querySelectorAll(".answer").forEach((b) => b.addEventListener("click", () => {
    root.querySelectorAll(".answer").forEach((x) => x.classList.toggle("on", x === b));
    const g = dq.options[Number(b.dataset.i)].group;
    const ci = shownGroups.indexOf(g);
    document.querySelectorAll(".mcard").forEach((c) => {
      const on = Number(c.dataset.i) === ci;
      c.classList.toggle("dim", !on);
      c.classList.toggle("pick", on);
    });
  }));
  const sp = document.getElementById("speakBtn");
  sp?.addEventListener("click", () => {
    const opts = dq.options.map((o) => `${dq.kind === "form" ? formLabel(o.label) : o.label}: ${useLabel(o.group)}`).join(". ");
    const u = new SpeechSynthesisUtterance(`${qtext} ${opts}`);
    u.lang = SPEECH[lang];
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/* ---------- voice (browser speech recognition: Google in Chrome/Android) ---------- */
async function onMic() {
  const btn = document.getElementById("micBtn");
  const { speechSupported, listen, stopListening } = await import("./voice.js");
  if (btn.classList.contains("rec")) { stopListening(); return; }
  if (!speechSupported()) { setStatus(esc(t("voice_none"))); return; }
  btn.classList.add("rec");
  setStatus(esc(t("listening_in", t("voice_lang"))));
  try {
    const q = document.getElementById("q");
    const alts = await listen(SPEECH[lang], (live) => { q.value = live; setStatus(`${esc(t("listening_in", t("voice_lang")))} <b>${esc(live)}</b>`); });
    btn.classList.remove("rec");
    // Google returns several guesses, and in English it often splits a brand into everyday words
    // ("a seat am 500"). Score every guess by the catalogue name it contains and keep the strongest.
    await Promise.all([loadRoots(), loadIngredients(), loadCommonWords()]);
    let pick = null;
    for (const a of alts) {
      const latin = hasIndic(a) ? toLatin(a) : a;
      const ing = findIngredient(parseQuery(latin).name.replace(/ /g, ""));
      if (ing && (!pick || pick.score < 3)) { pick = { heard: a, query: ing.name, score: 3, others: [] }; continue; }
      const b = bestFromSpeech(latin);
      const num = (latin.match(/\d+(?:\.\d+)?/) || [""])[0];
      const sc = b ? b.score + (num ? 0.01 : 0) : 0;
      if (b && (!pick || sc > pick.score)) pick = { heard: a, query: `${b.root}${num ? " " + num : ""}`, score: sc, root: b.root, others: b.others };
    }
    const heardAll = alts.slice(0, 4).map(esc).join(" · ");
    if (!pick) {
      setStatus(esc(t("heard", alts[0])) + (alts.length > 1 ? ` <span class="muted small">(${heardAll})</span>` : ""));
      document.getElementById("q").value = alts[0];
      runQuery(alts[0]);
      return;
    }
    const chips = (pick.others || []).map((r) => `<button class="chip" data-q="${esc(r)}">${esc(cap(r))}</button>`).join(" ");
    setStatus(`${esc(t("heard", pick.heard))}${pick.root ? ` → <b>${esc(cap(pick.root))}</b>` : ""}${chips ? ` <span class="muted small">${esc(t("dym_others"))}</span> ${chips}` : ""}`);
    document.querySelectorAll("#status .chip").forEach((c) => c.addEventListener("click", () => { document.getElementById("q").value = c.dataset.q; runQuery(c.dataset.q); }));
    document.getElementById("q").value = pick.query;
    if (pick.root) lastHeard = { heard: pick.heard, root: pick.root };
    runQuery(pick.query);
  } catch (err) {
    btn.classList.remove("rec");
    setStatus(esc(t("voice_err", String(err.message || err))));
  }
}

/* ---------- photo (on-device OCR) ---------- */
async function onPhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  setStatus(`<span class="spinner"></span>${esc(t("reading"))}`);
  try {
    const { readNames } = await import("./ocr.js");
    const found = await readNames(file, (p) => setStatus(`<span class="spinner"></span>${esc(t("reading"))} ${Math.round(p * 100)}%`));
    if (!found.length) { setStatus(esc(t("read_none"))); return; }
    setStatus(esc(t("read_ok", found[0].text)));
    document.getElementById("q").value = found[0].text;
    runQuery(found[0].text);
  } catch (err) { setStatus(esc(String(err.message || err))); }
  e.target.value = "";
}

/* ---------- atlas ---------- */
async function renderAtlas() {
  const [atlas, stats, live] = await Promise.all([fetch("data/atlas.json").then((r) => r.json()), fetch("data/stats.json").then((r) => r.json()),
    fetch("data/live.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  const n = (x) => Number(x).toLocaleString("en-US");
  view.innerHTML = `<section class="page-head"><p class="kicker">Twin Atlas</p><h1>India's medicine name clashes, mapped.</h1>
    <p>Every brand name in ${n(stats.products)} active Indian listings, checked against every other product with the same name. A <b>twin</b> is a name that covers medicines sharing no active ingredient at all.</p></section>
    <div class="tiles">
      <div class="tile red"><b>${n(stats.twin_roots_cross_company)}</b><span>names used by <b>different companies</b> for unrelated medicines</span></div>
      <div class="tile"><b>${n(stats.twin_roots_same_company_family)}</b><span>names one company reuses for unrelated medicines (suffix variants)</span></div>
      <div class="tile red"><b>${n(stats.twin_roots_high_alert)}</b><span>twin names involving a <b>high-alert</b> medicine (sedatives, epilepsy, diabetes, opioids, blood thinners…)</span></div>
      <div class="tile"><b>${n(stats.roots_where_strength_is_only_clue_and_high_alert)}</b><span>high-alert twins where the <b>printed number</b> is the only clue on the strip</span></div>
    </div>
    ${live ? `<div class="livebar">✓ <b>Still on sale today.</b> We re-checked ${live.summary.with_2plus_listings} of the most dangerous twin names on a live online pharmacy (1mg, ${esc(live.summary.date)}): <b>${live.summary.still_twins}</b> are still sold as different medicines under one name. Rows marked <span class="livetag">LIVE</span> were verified.</div>` : ""}
    <div class="filters" id="flt"><button class="on" data-f="all">All top 400</button><button data-f="cross">Different companies</button><button data-f="family">Same company</button><button data-f="strength">Number is the only clue</button><button data-f="company">Only the company differs</button></div>
    <div class="atlas" id="atlasList"></div>`;
  const list = document.getElementById("atlasList");
  const draw = (f) => {
    const rows = atlas.filter((r) => f === "all" || r.kind === f || r.clue === f).slice(0, 150);
    list.innerHTML = rows.map((r) => `<div class="arow" data-q="${esc(r.root)}"><div class="rn">${esc(r.root)}${live?.names?.[r.root] ? ` <span class="livetag">LIVE</span>` : ""}<div class="how">${r.kind === "cross" ? "2+ companies" : "same company"}</div></div>
      <div class="side"><b>${esc(r.a.name)}</b><span>${esc(cap(r.a.ings.join(" + ")))} · ${esc(pickUse(r.a))}</span></div>
      <div class="side"><b>${esc(r.b.name)}</b><span>${esc(cap(r.b.ings.join(" + ")))} · ${esc(pickUse(r.b))}</span></div>
      <div class="harm">${r.harm}<small>${esc(t("harm"))}</small></div></div>`).join("");
    list.querySelectorAll(".arow").forEach((el) => el.addEventListener("click", () => { location.hash = `#/?q=${encodeURIComponent(el.dataset.q)}`; }));
  };
  document.querySelectorAll("#flt button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#flt button").forEach((x) => x.classList.toggle("on", x === b));
    draw(b.dataset.f);
  }));
  draw("all");
}

/* ---------- evidence ---------- */
async function renderEvidence() {
  let m = null;
  try { m = await fetch("data/metrics.json").then((r) => (r.ok ? r.json() : null)); } catch { /* not built yet */ }
  const stats = await fetch("data/stats.json").then((r) => r.json());
  const pct = (x) => (x == null ? "–" : (100 * x).toFixed(1) + "%");
  const fmtCell = (v, f) => (typeof v !== "number" ? esc(v) : f === "num" ? v.toFixed(3) : f === "int" || v > 1 ? v.toLocaleString("en-US") : pct(v));
  let html = `<section class="page-head"><p class="kicker">Evidence</p><h1>Tested, with numbers.</h1>
    <p>Every result below comes from held-out data the system never saw while being built, compared against the simple method a pharmacy app would use today. Reproduce all of it with <code>make all</code> from the repository.</p></section>`;
  if (m) {
    for (const sec of m.sections) {
      html += `<div class="card"><h3>${esc(sec.title)}</h3><p class="muted">${esc(sec.what)}</p><table><thead><tr><th>Method</th>${sec.cols.map((c) => `<th class="num">${esc(c)}</th>`).join("")}</tr></thead><tbody>
        ${sec.rows.map((r) => `<tr class="${r.ours ? "ours" : ""}"><td>${esc(r.name)}</td>${r.vals.map((v, i) => `<td class="${typeof v === "number" ? "num" : "txt"}">${fmtCell(v, (sec.fmt || [])[i])}</td>`).join("")}</tr>`).join("")}
        </tbody></table>${sec.note ? `<p class="muted small">${esc(sec.note)}</p>` : ""}${sec.plot ? `<img src="${esc(sec.plot)}" alt="${esc(sec.title)}" style="width:100%;max-width:760px;margin-top:12px;border-radius:12px">` : ""}</div>`;
    }
  } else {
    html += `<div class="card"><p>Evaluation results are being generated.</p></div>`;
  }
  html += `<div class="card"><h3>Data quality</h3><table><tbody>
    <tr><td>Listings in source snapshot</td><td class="num">${stats.rows_raw.toLocaleString("en-US")}</td></tr>
    <tr><td>Active (not discontinued)</td><td class="num">${stats.rows_active.toLocaleString("en-US")}</td></tr>
    <tr><td>After de-duplication and cleaning</td><td class="num">${stats.products.toLocaleString("en-US")}</td></tr>
    <tr><td>Distinct brand names</td><td class="num">${stats.roots.toLocaleString("en-US")}</td></tr>
    <tr><td>Distinct ingredients · mapped to WHO ATC class</td><td class="num">${stats.ingredient_ingredients} · ${stats.ingredient_with_atc}</td></tr>
    <tr><td>Share of products with a mapped class</td><td class="num">${pct(stats.ingredient_product_weighted_atc_coverage)}</td></tr>
    </tbody></table></div>`;
  view.innerHTML = html;
}

/* ---------- how it works ---------- */
function renderHow() {
  view.innerHTML = `<section class="page-head"><p class="kicker">How it works</p><h1>From a name to the one right question.</h1>
    <p>Twinpill runs in your browser. The catalogue, the matching and the photo reader run on your device. Voice uses your browser's speech recognition (Google in Chrome and Android) in English, Tamil or Kannada; a name said or typed in Tamil or Kannada script is matched to the brand by sound.</p></section>
    <ol class="steps">
      <li><b>Clean the catalogue.</b> 246,068 active Indian listings → 242,924 products after removing duplicates; brand name, strength, form and ingredients parsed from each.</li>
      <li><b>Find the twins.</b> Products are grouped by the name a person would say. Any two products under one name with no shared ingredient form a twin pair (different companies or one company's suffix variants). Products whose ingredient list may be cut short by the source are left out, so every twin is checkable.</li>
      <li><b>Know what each medicine is for.</b> 1,643 ingredients mapped to WHO ATC classes (99.0% of products) and rewritten in plain English, Tamil and Kannada (“fits (epilepsy)”, not “antiepileptic”).</li>
      <li><b>Score the danger.</b> Different purpose, different body system, a high-alert medicine, the same form and route, and whether the printed number or the company is the only clue.</li>
      <li><b>Catch near-names.</b> An Indian-English sound key plus a learned confusability model (trained on ISMP's published confused-name pairs and on speech-AI mishearings) finds names a listener or a voice app could land on instead.</li>
      <li><b>Ask the one question.</b> For each name the app picks the single question that splits the unrelated meanings: the form first, then the printed number, then the company.</li>
    </ol>
    <div class="card" style="margin-top:18px"><h3>Hard questions, straight answers</h3>
      <p><b>“The strip prints the ingredient. Why not just read it?”</b><br>The mix-up happens before anyone holds the strip: a handwritten brand-only prescription, a name read over the phone, a voice order, a refill request. The ingredient is printed in tiny English that many elders cannot read, and few people know that “levetiracetam” is an epilepsy drug. Twinpill works on the one thing everyone has: the name.</p>
      <p><b>“Your catalogue is from 2021–22. Are these twins still sold?”</b><br>Yes. We re-checked our top twin names on a live online pharmacy (1mg). <span id="liveFaq">See the Evidence page for the list and links.</span></p>
      <p><b>“Where is the AI?”</b><br>Three trained or tested models: a confusability model learned from 440 real confused-name pairs; a ranker that recovers names speech AI mishears (75.5% vs 48.8% for plain search, on a voice it never saw); and on-screen speech and photo reading. Plus a measured finding nobody had published: speech AI spells half of Indian medicine names wrong.</p>
      <p><b>“Has a real mix-up ever happened?”</b><br>The Lancet (2024) documented brand-name clashes in India and warned that a pharmacist “has no way” to tell which drug a brand-only prescription means. India's drug regulator opened a consultation on it in July 2026. Twinpill gives both a tool and the evidence.</p>
      <p><b>“Is my data safe?”</b><br>Typing and photo reading run on your device. Voice uses your browser's speech service. Nothing is stored, there is no account and no tracking.</p>
    </div>
    <div class="card" style="margin-top:18px"><h3>Limits we state openly</h3><ul>
      <li>The catalogue is a public snapshot (scraped around 2021–22); some products have since changed or stopped. Counts describe that snapshot.</li>
      <li>The source lists at most two ingredients per product. Products that may be missing one (8,863) are never used to declare a twin, so the counts are conservative.</li>
      <li>Twinpill never names the right medicine. It shows what a name could mean so a person asks the pharmacist or doctor.</li>
    </ul></div>`;
}

route();

// Offline support (see sw.js)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

import { T, FORM_TA } from "./i18n.js";
import { loadRoots, findRoots, parseQuery, productsFor, meanings, isTwin, matchNumber, decidingQuestion } from "./search.js";

let lang = "en";
try { lang = localStorage.getItem("tp_lang") || "en"; } catch { /* private mode */ }
const t = (k, ...a) => { const v = T[lang][k] ?? T.en[k]; return typeof v === "function" ? v(...a) : v; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap = (s) => String(s || "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const sent = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const formLabel = (f) => (lang === "ta" ? FORM_TA[f] || f : f);
const useLabel = (g) => (lang === "ta" ? g.useTa || g.use : g.use) || (lang === "ta" ? "வகை தெரியவில்லை" : "class not listed");
const view = document.getElementById("view");
let lastQuery = "";
let shownGroups = [];

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = lang;
  document.getElementById("langBtn").textContent = lang === "en" ? "தமிழ்" : "English";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
}
document.getElementById("langBtn").addEventListener("click", () => {
  lang = lang === "en" ? "ta" : "en";
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
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString("en-IN");
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const setStatus = (html) => { const s = document.getElementById("status"); if (s) s.innerHTML = html; };

async function runQuery(text) {
  lastQuery = text;
  const box = document.getElementById("result");
  if (!box) return;
  const { name, number } = parseQuery(text);
  if (!name) { box.innerHTML = ""; return; }
  await loadRoots();
  const hits = findRoots(name, 8);
  if (!hits.length) { box.innerHTML = `<div class="verdict safe"><div><h2>${esc(t("not_found"))}</h2></div></div>`; return; }
  const main = hits[0];
  const prods = await productsFor(main.root);
  const gs = meanings(prods);
  const twin = isTwin(gs);
  const display = cap(main.root);

  let html = "";
  if (twin) {
    const unrelated = gs.filter((g) => g.unrelated > 0);
    const kindNote = new Set(gs.flatMap((g) => g.makers)).size > 1 && main.twin === 2 ? t("cross_note") : t("family_note");
    html += `<div class="verdict twin"><span class="badge">TWIN</span><div><h2>${esc(t("twin_title", unrelated.length, display))}</h2><p>${esc(kindNote)}</p></div></div>`;
  } else {
    html += `<div class="verdict safe"><span class="badge">ONE</span><div><h2>${esc(t("safe_title", display))}</h2><p>${esc(t("safe_sub"))}</p></div></div>`;
  }

  // Always show the unrelated meanings first: the biggest group, then whatever shares nothing with it.
  const head = gs[0];
  const unrel = gs.filter((g) => g !== head && !g.ings.some((i) => head.ings.includes(i)));
  const rest = gs.filter((g) => g !== head && !unrel.includes(g));
  let shown = [head, ...unrel, ...rest].slice(0, 4);
  let autoPick = -1;
  if (twin && number) {
    const hit = matchNumber(gs, number);
    if (hit.length === 1) autoPick = shown.indexOf(hit[0]);
    if (hit.length < gs.length) {
      html += `<div class="question"><div class="label">${esc(t("number_hit", number))}</div><h3>${hit.map((g) => esc(cap(g.ings.join(" + "))) + " · " + esc(useLabel(g))).join("<br>")}</h3></div>`;
    }
  }
  if (twin) {
    const dq = decidingQuestion([head, ...unrel].slice(0, 4).length > 1 ? [head, ...unrel].slice(0, 4) : shown);
    if (dq) {
      let qtext = dq.kind === "form" ? t("q_form").replace("{a}", formLabel(dq.options[0].label)).replace("{b}", formLabel(dq.options[1].label))
        : dq.kind === "strength" ? t("q_strength") : dq.kind === "suffix" ? t("q_suffix") : t("q_company");
      html += `<div class="question" id="dq"><div class="label">${esc(t("ask"))}</div><h3>${esc(qtext)}</h3>
        <div class="muted small" style="color:#d9d6f2;margin-bottom:10px">${esc(t("pick"))}</div>
        <div class="answers">${dq.options.map((o, i) => `<button class="answer" data-i="${i}"><b>${esc(dq.kind === "form" ? cap(formLabel(o.label)) : o.label)}</b><span>${esc(useLabel(o.group))}</span></button>`).join("")}</div>
        <button class="speak" id="speakBtn">🔊 ${esc(t("speak"))}</button></div>`;
      setTimeout(() => wireQuestion(dq, qtext, autoPick), 0);
    }
  }

  shownGroups = shown;
  html += `<div class="twins" id="cards">${shown.map((g, i) => card(g, i)).join("")}</div>`;
  if (gs.length > 4) html += `<p class="muted small">${esc(t("and_more", gs.length - 4))}</p>`;

  const near = hits.slice(1).filter((h) => h.score >= 0.25 && h.root.replace(/ /g, "").length >= 4).slice(0, 5);
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
  if (window.innerWidth < 760) box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function card(g, i) {
  const names = [...new Set(g.products.map((p) => p.name))];
  return `<article class="mcard" data-i="${i}">
    <span class="tag">${esc(t("used_for"))}</span>${g.highAlert ? `<span class="ha">${esc(t("high_alert"))}</span>` : ""}
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
    u.lang = lang === "ta" ? "ta-IN" : "en-IN";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/* ---------- voice (on-device Whisper) ---------- */
let asr = null, rec = null, chunks = [];
async function onMic() {
  const btn = document.getElementById("micBtn");
  if (rec && rec.state === "recording") { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      btn.classList.remove("rec");
      stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      setStatus(`<span class="spinner"></span>${esc(t("loading_voice"))}`);
      try {
        const { transcribe } = await import("./voice.js");
        const text = await transcribe(blob, (msg) => setStatus(`<span class="spinner"></span>${esc(msg)}`));
        setStatus(esc(t("heard", text)));
        document.getElementById("q").value = text;
        runQuery(text);
      } catch (err) { setStatus(esc(String(err.message || err))); }
    };
    rec.start();
    btn.classList.add("rec");
    setStatus(esc(t("listening")));
    setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 5000);
  } catch (err) { setStatus(esc("Microphone not available: " + (err.message || err))); }
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
    setStatus(esc(t("read_ok", found.map((f) => f.text).join(", "))));
    document.getElementById("q").value = found[0].text;
    runQuery(found[0].text);
  } catch (err) { setStatus(esc(String(err.message || err))); }
  e.target.value = "";
}

/* ---------- atlas ---------- */
async function renderAtlas() {
  const [atlas, stats] = await Promise.all([fetch("data/atlas.json").then((r) => r.json()), fetch("data/stats.json").then((r) => r.json())]);
  const n = (x) => Number(x).toLocaleString("en-IN");
  view.innerHTML = `<section class="page-head"><p class="kicker">Twin Atlas</p><h1>India's medicine name clashes, mapped.</h1>
    <p>Every brand name in ${n(stats.products)} active Indian listings, checked against every other product with the same name. A <b>twin</b> is a name that covers medicines sharing no active ingredient at all.</p></section>
    <div class="tiles">
      <div class="tile red"><b>${n(stats.twin_roots_cross_company)}</b><span>names used by <b>different companies</b> for unrelated medicines</span></div>
      <div class="tile"><b>${n(stats.twin_roots_same_company_family)}</b><span>names one company reuses for unrelated medicines (suffix variants)</span></div>
      <div class="tile red"><b>${n(stats.twin_roots_high_alert)}</b><span>twin names involving a <b>high-alert</b> medicine (sedatives, epilepsy, diabetes, opioids, blood thinners…)</span></div>
      <div class="tile"><b>${n(stats.roots_where_strength_is_only_clue_and_high_alert)}</b><span>high-alert twins where the <b>printed number</b> is the only clue on the strip</span></div>
    </div>
    <div class="filters" id="flt"><button class="on" data-f="all">All top 400</button><button data-f="cross">Different companies</button><button data-f="family">Same company</button><button data-f="strength">Number is the only clue</button><button data-f="company">Only the company differs</button></div>
    <div class="atlas" id="atlasList"></div>`;
  const list = document.getElementById("atlasList");
  const draw = (f) => {
    const rows = atlas.filter((r) => f === "all" || r.kind === f || r.clue === f).slice(0, 150);
    list.innerHTML = rows.map((r) => `<div class="arow" data-q="${esc(r.root)}"><div class="rn">${esc(r.root)}<div class="how">${r.kind === "cross" ? "2+ companies" : "same company"}</div></div>
      <div class="side"><b>${esc(r.a.name)}</b><span>${esc(cap(r.a.ings.join(" + ")))} · ${esc(lang === "ta" ? r.a.use_ta : r.a.use)}</span></div>
      <div class="side"><b>${esc(r.b.name)}</b><span>${esc(cap(r.b.ings.join(" + ")))} · ${esc(lang === "ta" ? r.b.use_ta : r.b.use)}</span></div>
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
  let html = `<section class="page-head"><p class="kicker">Evidence</p><h1>Tested, with numbers.</h1>
    <p>Every result below comes from held-out data the system never saw while being built, compared against the simple method a pharmacy app would use today. Reproduce all of it with <code>make all</code> from the repository.</p></section>`;
  if (m) {
    for (const sec of m.sections) {
      html += `<div class="card"><h3>${esc(sec.title)}</h3><p class="muted">${esc(sec.what)}</p><table><thead><tr><th>Method</th>${sec.cols.map((c) => `<th class="num">${esc(c)}</th>`).join("")}</tr></thead><tbody>
        ${sec.rows.map((r) => `<tr class="${r.ours ? "ours" : ""}"><td>${esc(r.name)}</td>${r.vals.map((v) => `<td class="num">${typeof v === "number" ? (v <= 1 ? pct(v) : v.toLocaleString("en-IN")) : esc(v)}</td>`).join("")}</tr>`).join("")}
        </tbody></table>${sec.note ? `<p class="muted small">${esc(sec.note)}</p>` : ""}${sec.plot ? `<img src="${esc(sec.plot)}" alt="${esc(sec.title)}" style="width:100%;max-width:760px;margin-top:12px;border-radius:12px">` : ""}</div>`;
    }
  } else {
    html += `<div class="card"><p>Evaluation results are being generated.</p></div>`;
  }
  html += `<div class="card"><h3>Data quality</h3><table><tbody>
    <tr><td>Listings in source snapshot</td><td class="num">${stats.rows_raw.toLocaleString("en-IN")}</td></tr>
    <tr><td>Active (not discontinued)</td><td class="num">${stats.rows_active.toLocaleString("en-IN")}</td></tr>
    <tr><td>After de-duplication and cleaning</td><td class="num">${stats.products.toLocaleString("en-IN")}</td></tr>
    <tr><td>Distinct brand names</td><td class="num">${stats.roots.toLocaleString("en-IN")}</td></tr>
    <tr><td>Distinct ingredients · mapped to WHO ATC class</td><td class="num">${stats.ingredient_ingredients} · ${stats.ingredient_with_atc}</td></tr>
    <tr><td>Share of products with a mapped class</td><td class="num">${pct(stats.ingredient_product_weighted_atc_coverage)}</td></tr>
    </tbody></table></div>`;
  view.innerHTML = html;
}

/* ---------- how it works ---------- */
function renderHow() {
  view.innerHTML = `<section class="page-head"><p class="kicker">How it works</p><h1>From a name to the one right question.</h1>
    <p>Twinpill runs entirely in your browser. The catalogue, the matching and the speech and photo readers all run on your device, so a prescription never leaves your phone.</p></section>
    <ol class="steps">
      <li><b>Clean the catalogue.</b> 246,068 active Indian listings → 242,924 products after removing duplicates; brand name, strength, form and ingredients parsed from each.</li>
      <li><b>Find the twins.</b> Products are grouped by the name a person would say. Any two products under one name with no shared ingredient form a twin pair (different companies or one company's suffix variants).</li>
      <li><b>Know what each medicine is for.</b> 1,643 ingredients mapped to WHO ATC classes (98.9% of products) and rewritten in plain English and Tamil (“fits (epilepsy)”, not “antiepileptic”).</li>
      <li><b>Score the danger.</b> Different purpose, different body system, a high-alert medicine, the same form and route, and whether the printed number or the company is the only clue.</li>
      <li><b>Catch near-names.</b> An Indian-English sound key plus a learned confusability model (trained on ISMP's published confused-name pairs and on speech-AI mishearings) finds names a listener or a voice app could land on instead.</li>
      <li><b>Ask the one question.</b> For each name the app picks the single question that splits the unrelated meanings: the form first, then the printed number, then the company.</li>
    </ol>
    <div class="card" style="margin-top:18px"><h3>Limits we state openly</h3><ul>
      <li>The catalogue is a public snapshot (scraped around 2021–22); some products have since changed or stopped. Counts describe that snapshot.</li>
      <li>Only the first two listed ingredients of each product are in the source data; rare three-ingredient overlaps can be missed.</li>
      <li>Twinpill never names the right medicine. It shows what a name could mean so a person asks the pharmacist or doctor.</li>
    </ul></div>`;
}

route();

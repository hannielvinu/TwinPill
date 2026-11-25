import { T, FORM_TA, FORM_KN, KIND, SAY, PHOTO, TALK, MONTH_NAMES } from "./i18n.js";
import { kindOfForm } from "./photo.js";
import { say, hush } from "./speak.js";
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
const sv = (v, a) => (typeof v === "function" ? v(...a) : v);
const S = (k, ...a) => sv(SAY[lang][k] ?? SAY.en[k], a);
const SE = (k, ...a) => sv(SAY.en[k], a);
const P = (k) => PHOTO[lang][k] ?? PHOTO.en[k];
const K = (k, ...a) => sv(TALK[lang][k] ?? TALK.en[k], a);
const KE = (k, ...a) => sv(TALK.en[k], a);
const kindWord = (k, l = lang) => (k ? KIND[l][k] || KIND.en[k] : "");
const sameGroup = (a, b) => a && b && a.ings.join("+") === b.ings.join("+");
/** Speak in the chosen language; English is the fallback when the device has no Tamil/Kannada voice. */
const speakOut = (local, en) => say(local, SPEECH[lang], en);

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = lang;
  document.getElementById("langSel").value = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-talk]").forEach((el) => { el.textContent = K(el.dataset.i18nTalk); });
}
document.getElementById("langSel").addEventListener("change", (e) => {
  lang = e.target.value;
  try { localStorage.setItem("tp_lang", lang); } catch { /* ignore */ }
  route();
});

/* ---------- router ---------- */
const routes = { "": renderCheck, talk: renderTalk, atlas: renderAtlas, evidence: renderEvidence, how: renderHow };
function route() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  if (path !== "talk") stopScan();
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
  document.getElementById("photoBtn").addEventListener("click", () => document.getElementById("photo").click());
  warmPhotoReader();
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

async function runQuery(text, ctx = {}) {
  lastQuery = text;
  hush();
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
    box.innerHTML = photoCard(ctx.photo, null) + `<div class="verdict info"><span class="badge">GENERIC</span><div><h2>${esc(t("generic_title", cap(ing.name)))}</h2>
      <p>${esc(t("used_for"))}: <b>${esc(pickUse(ing))}</b>. ${esc(t("generic_sub", ing.brands.toLocaleString("en-US")))}</p></div></div>
      <div class="sounds"><h4>${esc(t("generic_brands"))}</h4><div class="chips" style="margin-top:10px">${ing.top.map(chip).join("")}</div></div>
      <p class="disclaimer">${esc(t("disclaimer"))}</p>`;
    wireChips();
    if (ctx.speak) {
      const k = ctx.photo?.kind;
      const loc = ctx.photo ? (k ? S("looks_like", kindWord(k)) + " " : "") + S("ing_only", cap(ing.name), pickUse(ing))
        : S("contains", cap(ing.name)) + " " + S("for_use", pickUse(ing));
      const en = ctx.photo ? (k ? SE("looks_like", kindWord(k, "en")) + " " : "") + SE("ing_only", cap(ing.name), ing.use)
        : SE("contains", cap(ing.name)) + " " + SE("for_use", ing.use);
      speakOut(loc, en);
    }
    return;
  }
  // Not in the catalogue, or only a weak look-alike: say so plainly, never present a guess as the answer.
  if (!hits.length || !confident(name, hits[0], opts)) {
    const near = hits.filter((h) => h.score >= 0.2).slice(0, 5);
    box.innerHTML = `<div class="verdict unknown"><span class="badge">NOT FOUND</span><div><h2>${esc(t("nf_title", text.trim()))}</h2><p>${esc(t("nf_sub"))}</p></div></div>
      ${near.length ? `<div class="sounds"><h4>${esc(t("nf_closest"))}</h4><p class="muted small">${esc(t("nf_closest_sub"))}</p><div class="chips" style="margin-top:10px">${near.map((h) => chip(h.root)).join("")}</div></div>` : ""}`;
    wireChips();
    if (ctx.speak) speakOut(S("not_found", text.trim()), SE("not_found", text.trim()));
    return;
  }
  const main = hits[0];
  const prods = await productsFor(main.root);
  const gs = meanings(prods);
  const twin = isTwin(gs);
  const display = cap(main.root);

  let html = photoCard(ctx.photo, main.root);
  let pendingDq = null;
  if (lastHeard && lastHeard.root === main.root) {
    html += `<div class="heardcard"><div><span class="hl-label">${esc(t("ai_heard"))}</span><b>“${esc(lastHeard.heard)}”</b></div><div class="arrow">→</div><div><span class="hl-label">${esc(t("we_found"))}</span><b>${esc(display)}</b></div></div>`;
  }
  lastHeard = null;
  if (!exact && !html.includes("heardcard") && !ctx.photo) {
    const others = hits.slice(1, 4).filter((h) => (indic ? h.score >= 1.5 : confident(name, h, opts)));
    html += `<div class="didyou">${esc(t("dym", text.trim()))} <b>${esc(display)}</b>${others.length ? ` ${esc(t("dym_others"))} ${others.map((h) => chip(h.root)).join(" ")}` : ""}</div>`;
  }
  if (twin) {
    const unrelated = gs.filter((g) => g.unrelated > 0);
    const kindNote = new Set(gs.flatMap((g) => g.makers)).size > 1 && main.twin === 2 ? t("cross_note") : t("family_note");
    const live = LIVE?.names?.[main.root];
    const liveLine = live ? `<p class="live">${esc(t("live_ok", LIVE.date))}: ${live.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a> = ${esc(p.composition)}`).join(" · ")}</p>` : "";
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
  let shown = [head, ...unrel, ...rest];
  const photoGroup = ctx.photo?.group ? gs.find((g) => sameGroup(g, ctx.photo.group)) : null;
  if (photoGroup) shown = [photoGroup, ...shown.filter((g) => g !== photoGroup)];
  shown = shown.slice(0, 4);
  let autoPick = photoGroup ? 0 : -1;
  if (number && !matchNumber(gs, number).length) {
    html += `<div class="didyou">${esc(t("no_number", display, number))}</div>`;
  }
  if (twin && number) {
    const hit = matchNumber(gs, number);
    if (hit.length === 1 && autoPick < 0) autoPick = shown.indexOf(hit[0]);
    if (hit.length && hit.length < gs.length) {
      html += `<div class="question"><div class="label">${esc(t("number_hit", number))}</div><h3>${hit.map((g) => esc(cap(g.ings.join(" + "))) + " · " + esc(useLabel(g))).join("<br>")}</h3></div>`;
    }
  }
  if (twin) {
    const dq = decidingQuestion([head, ...unrel].slice(0, 4).length > 1 ? [head, ...unrel].slice(0, 4) : shown);
    if (dq) {
      const qtext = questionText(dq);
      html += `<div class="question" id="dq"><div class="label">${esc(t("ask"))}</div><h3>${esc(qtext)}</h3>
        <div class="muted small" style="color:#d9d6f2;margin-bottom:10px">${esc(t("pick"))}</div>
        <div class="answers">${dq.options.map((o, i) => `<button class="answer" data-i="${i}"><b>${esc(dq.kind === "form" ? cap(formLabel(o.label)) : o.label)}</b><span>${esc(useLabel(o.group))}</span></button>`).join("")}</div>
        <div class="chosen" aria-live="polite"></div>
        <div class="qactions">
        <a class="share" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText(display, main.root, qtext, dq))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>${esc(t("share"))}</a></div></div>`;
      pendingDq = { dq, qtext, autoPick };
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
  // Wire the question only now that it is on the page (it used to be wired too early and taps did nothing).
  if (pendingDq) { wireQuestion(pendingDq.dq, pendingDq.qtext, pendingDq.autoPick, display, !!ctx.speak); }
  if (ctx.speak) speakResult({ display, number: ctx.photo?.number || number, kind: ctx.photo?.kind, twin, gs, shown, autoPick, photo: ctx.photo, qtext: pendingDq?.qtext });
  box.querySelectorAll(".sounds button").forEach((b) => b.addEventListener("click", () => { document.getElementById("q").value = b.dataset.q; runQuery(b.dataset.q); }));
  wireChips();
  if (window.innerWidth < 760) box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function questionText(dq, l = lang) {
  const tl = (k) => T[l][k] ?? T.en[k];
  const fl = (f) => (l === "ta" ? FORM_TA[f] || f : l === "kn" ? FORM_KN[f] || f : f);
  const art = (x) => (l === "en" ? (/^[aeiou]/i.test(x) ? "an " : "a ") + x : x);
  return dq.kind === "form" ? tl("q_form").replace("{a}", art(fl(dq.options[0].label))).replace("{b}", art(fl(dq.options[1].label)))
    : dq.kind === "strength" ? tl("q_strength") : dq.kind === "suffix" ? tl("q_suffix") : dq.kind === "fullname" ? tl("q_fullname") : tl("q_company");
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

function wireQuestion(dq, qtext, autoPick = -1, display = "", silentAuto = false) {
  const root = document.getElementById("dq");
  if (!root) return;
  const labelOf = (o) => (dq.kind === "form" ? cap(formLabel(o.label)) : dq.kind === "company" ? o.label : `${display} ${o.label}`);
  const choose = (b, speak) => {
    root.querySelectorAll(".answer").forEach((x) => x.classList.toggle("on", x === b));
    const o = dq.options[Number(b.dataset.i)];
    const ci = shownGroups.findIndex((g) => sameGroup(g, o.group));
    const cards = document.getElementById("cards");
    document.querySelectorAll(".mcard").forEach((c) => {
      const on = Number(c.dataset.i) === ci;
      c.classList.toggle("dim", !on);
      c.classList.toggle("pick", on);
      if (on && cards) cards.prepend(c); // the chosen medicine moves to the top
    });
    const out = root.querySelector(".chosen");
    if (out) out.innerHTML = `<span>${esc(labelOf(o))}</span> = <b>${esc(sent(useLabel(o.group)))}</b> · ${esc(cap(o.group.ings.join(" + ")))}`;
    if (speak) {
      speakOut(S("picked", labelOf(o), useLabel(o.group)), SE("picked", dq.kind === "form" ? o.label : labelOf(o), o.group.use || ""));
      document.querySelector(".mcard.pick")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };
  root.querySelectorAll(".answer").forEach((b) => b.addEventListener("click", () => choose(b, true)));
  if (autoPick >= 0) {
    const i = dq.options.findIndex((o) => sameGroup(o.group, shownGroups[autoPick]));
    const b = root.querySelectorAll(".answer")[i];
    if (b) choose(b, false); // chosen from the photo or the typed number: the spoken answer covers it
  }
}

/** The card at the top of a photo result: what was read from the pack. */
function photoCard(ph, root) {
  if (!ph) return "";
  const kind = ph.kind ? sent(kindWord(ph.kind)) : P("unknown_kind");
  const brand = ph.root ? `${cap(ph.root)}${ph.number ? " " + ph.number : ""}` : P("no_brand");
  return `<div class="photocard">${ph.thumb ? `<img src="${esc(ph.thumb)}" alt="">` : ""}
    <div class="pc-body"><span class="hl-label">${esc(P("read_from"))}</span>
      <div class="pc-brand">${esc(brand)}</div>
      <dl><dt>${esc(P("kind"))}</dt><dd><span class="kindtag">${esc(kind)}</span></dd>
      ${ph.ings?.length ? `<dt>${esc(P("printed"))}</dt><dd>${esc(cap(ph.ings.join(" + ")))}</dd>` : ""}
      ${ph.expiry ? `<dt>${esc(K("expires", "", "").replace(/[:.\s]+$/, ""))}</dt><dd>${esc(MONTH_NAMES[lang][ph.expiry.month - 1])} ${ph.expiry.year}${expiryLines(ph.expiry).past ? ` <span class="ha">${esc(K("expired").split(/[:.]/)[0])}</span>` : ""}</dd>` : ""}
      ${ph.group ? `<dt>${esc(P("this_one"))}</dt><dd><b class="pc-use">${esc(sent(useLabel(ph.group)))}</b>${ph.group.highAlert ? ` <span class="ha">${esc(t("high_alert"))}</span>` : ""}</dd>` : ""}</dl></div></div>`;
}

/** Say the answer out loud: which medicine this is, what it is for, and the twin warning. */
function speakResult({ display, number, kind, twin, gs, shown, autoPick, photo }) {
  const name = `${display}${number ? " " + number : ""}`;
  const L = [], E = [];
  const add = (k, ...a) => { L.push(S(k, ...a)); E.push(SE(k, ...a.map((x) => x))); };
  const known = autoPick >= 0 ? shown[autoPick] : !twin ? gs[0] : null;
  if (known) {
    L.push(S("this_is", name, kindWord(kind))); E.push(SE("this_is", name, kindWord(kind, "en")));
    L.push(S("for_use", useLabel(known))); E.push(SE("for_use", known.use || "an unlisted use"));
    if (photo) { L.push(S("contains", cap(known.ings.join(", ")))); E.push(SE("contains", cap(known.ings.join(", ")))); }
    if (twin) {
      // warn only about a medicine for a different purpose (an antacid twin of an ulcer tablet is not news)
      const other = gs.find((g) => g !== known && !g.ings.some((i) => known.ings.includes(i)) && useLabel(g) !== useLabel(known));
      if (other) { L.push(S("careful", display, useLabel(other))); E.push(SE("careful", display, other.use || "another use")); }
    } else { add("no_twin"); }
  } else if (twin) {
    const unrel = [shown[0], ...shown.slice(1).filter((g) => !g.ings.some((i) => shown[0].ings.includes(i)))].slice(0, 3);
    if (kind) { L.push(S("looks_like", kindWord(kind))); E.push(SE("looks_like", kindWord(kind, "en"))); }
    L.push(S("twin", display, unrel.length, unrel.map(useLabel).join(S("or", "")))); E.push(SE("twin", display, unrel.length, unrel.map((g) => g.use).join(" or ")));
    const q = document.querySelector("#dq h3")?.textContent;
    if (q) { L.push(q); if (lang === "en") E.push(q); }
  }
  const x = expiryLines(photo?.expiry);
  L.push(...x.l); E.push(...x.e);
  speakOut(L.join(" "), E.join(" "));
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
    const pick = await pickFromSpeech(alts);
    const heardAll = alts.slice(0, 4).map(esc).join(" · ");
    if (!pick) {
      setStatus(esc(t("heard", alts[0])) + (alts.length > 1 ? ` <span class="muted small">(${heardAll})</span>` : ""));
      document.getElementById("q").value = alts[0];
      runQuery(alts[0], { speak: true });
      return;
    }
    const chips = (pick.others || []).map((r) => `<button class="chip" data-q="${esc(r)}">${esc(cap(r))}</button>`).join(" ");
    setStatus(`${esc(t("heard", pick.heard))}${pick.root ? ` → <b>${esc(cap(pick.root))}</b>` : ""}${chips ? ` <span class="muted small">${esc(t("dym_others"))}</span> ${chips}` : ""}`);
    document.querySelectorAll("#status .chip").forEach((c) => c.addEventListener("click", () => { document.getElementById("q").value = c.dataset.q; runQuery(c.dataset.q); }));
    document.getElementById("q").value = pick.query;
    if (pick.root) lastHeard = { heard: pick.heard, root: pick.root };
    runQuery(pick.query, { speak: true });
  } catch (err) {
    btn.classList.remove("rec");
    setStatus(esc(t("voice_err", String(err.message || err))));
  }
}

/** Google returns several guesses; score each by the catalogue name it contains and keep the strongest. */
async function pickFromSpeech(alts) {
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
    return pick;
}

/* ---------- photo (on-device OCR: PaddleOCR in the browser) ---------- */
async function onPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  hush();
  const thumb = URL.createObjectURL(file);
  const box = document.getElementById("result");
  if (box) box.innerHTML = `<div class="photocard reading"><img src="${esc(thumb)}" alt=""><div class="pc-body"><span class="hl-label">${esc(P("read_from"))}</span><div class="pc-brand"><span class="spinner"></span><span id="pcStage">${esc(P("reading"))}</span></div></div></div>`;
  setStatus("");
  const stage = (k) => { const el = document.getElementById("pcStage"); if (el) el.textContent = P(k === "load" ? "loading" : "reading"); };
  try {
    const { readPack } = await import("./ocr.js");
    const r = await readPack(file, stage);
    window.__lastPack = r; // for tests
    const ph = { ...r, thumb };
    if (r.root) {
      const q = `${r.root}${r.number ? " " + r.number : ""}`;
      document.getElementById("q").value = cap(q);
      await runQuery(q, { photo: ph, speak: true });
    } else if (r.ings.length) {
      document.getElementById("q").value = cap(r.ings[0]);
      await runQuery(r.ings[0], { photo: ph, speak: true });
    } else {
      if (box) box.innerHTML = photoCard(ph, null) + `<div class="verdict unknown"><span class="badge">NOT READ</span><div><h2>${esc(t("read_none"))}</h2></div></div>`;
      speakOut(S("nothing"), SE("nothing"));
    }
  } catch (err) {
    setStatus(esc(String(err.message || err)));
  }
}

/** Fetch the photo reader in the background so the first photo is quick (skipped on data-saver). */
function warmPhotoReader() {
  const c = navigator.connection;
  if (c && (c.saveData || /2g/.test(c.effectiveType || ""))) return;
  const go = () => import("./ocr.js").then((m) => m.warmOcr()).catch(() => {});
  (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(go, { timeout: 6000 });
}

/* ---------- Talk mode: for people who cannot read the strip ---------- */
// Point the phone at a medicine. Twinpill keeps looking, says what to do until it can read the name,
// then says which medicine it is, what it is for, the twin warning and the expiry date.
let talkStream = null, talkLoop = false, lastSaid = null, audioCtx = null;

function beep(freq = 880, ms = 70, vol = 0.05) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* no audio */ }
}
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* ignore */ } };

function talkSay(l, e) {
  lastSaid = { l, e };
  const st = document.getElementById("talkStatus");
  if (st) st.textContent = l;
  return speakOut(l, e);
}

function expiryLines(x) {
  if (!x) return { l: [], e: [] };
  const now = new Date();
  const past = x.year < now.getFullYear() || (x.year === now.getFullYear() && x.month < now.getMonth() + 1);
  const l = [K("expires", MONTH_NAMES[lang][x.month - 1], x.year)], e = [KE("expires", MONTH_NAMES.en[x.month - 1], x.year)];
  if (past) { l.push(K("expired")); e.push(KE("expired")); }
  return { l, e, past };
}

/** Everything a person needs to hear about a medicine read from a pack or said aloud. */
async function describe(r) {
  const L = [], E = [];
  const push = (l, e = l) => { L.push(l); E.push(e); };
  let known = null, gs = [], twin = false, title = "";
  await loadIngredients();
  if (r.root) {
    gs = meanings(await productsFor(r.root));
    if (!gs.length) return null;
    twin = isTwin(gs);
    if (r.group) known = gs.find((g) => sameGroup(g, r.group)) || null;
    if (!known && r.number) { const h = matchNumber(gs, r.number); if (h.length === 1) known = h[0]; }
    if (!known && r.kind) { const h = gs.filter((g) => g.forms.some((f) => kindOfForm(f) === r.kind)); if (h.length === 1) known = h[0]; }
    if (!known && !twin) known = gs[0];
    const name = `${cap(r.root)}${r.number ? " " + r.number : ""}`;
    title = name;
    if (known) {
      push(S("this_is", name, kindWord(r.kind)), SE("this_is", name, kindWord(r.kind, "en")));
      push(S("for_use", useLabel(known)), SE("for_use", known.use || "an unlisted use"));
      push(S("contains", cap(known.ings.join(", "))), SE("contains", cap(known.ings.join(", "))));
      if (twin) {
        const other = gs.find((g) => g !== known && !g.ings.some((i) => known.ings.includes(i)) && useLabel(g) !== useLabel(known));
        if (other) push(S("careful", cap(r.root), useLabel(other)), SE("careful", cap(r.root), other.use || "another use"));
      } else push(S("no_twin"), SE("no_twin"));
    } else {
      const head = gs.find((g) => !g.incomplete) || gs[0];
      const unrel = [head, ...gs.filter((g) => g !== head && !g.ings.some((i) => head.ings.includes(i)))].slice(0, 3);
      if (r.kind) push(S("looks_like", kindWord(r.kind)), SE("looks_like", kindWord(r.kind, "en")));
      push(S("twin", cap(r.root), unrel.length, unrel.map(useLabel).join(S("or"))), SE("twin", cap(r.root), unrel.length, unrel.map((g) => g.use).join(" or ")));
      const dq = decidingQuestion(unrel);
      if (dq) push(questionText(dq), questionText(dq, "en"));
      push(K("unsure_strength"), KE("unsure_strength"));
    }
  } else if (r.ings?.length) {
    const ing = findIngredient(r.ings[0]);
    if (!ing) return null;
    title = cap(ing.name);
    if (r.kind) push(S("looks_like", kindWord(r.kind)), SE("looks_like", kindWord(r.kind, "en")));
    push(S("ing_only", cap(ing.name), pickUse(ing)), SE("ing_only", cap(ing.name), ing.use));
  } else return null;
  const x = expiryLines(r.expiry);
  L.push(...x.l); E.push(...x.e);
  return { l: L.join(" "), e: E.join(" "), title, known, twin, expired: x.past, root: r.root };
}

function showTalkResult(d) {
  const box = document.getElementById("talkResult");
  if (!box || !d) return;
  box.innerHTML = `<div class="talk-card${d.twin ? " twin" : ""}${d.expired ? " expired" : ""}"><div class="tc-name">${esc(d.title)}</div>
    <p>${esc(d.l)}</p>${d.root ? `<a href="#/?q=${encodeURIComponent(d.root)}">${esc(t("nav_check"))} →</a>` : ""}</div>`;
}

function renderTalk() {
  const mic = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>';
  const cam = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';
  view.innerHTML = `<section class="talk">
    <p class="kicker">${esc(K("nav"))}</p>
    <h1>${esc(K("title"))}</h1>
    <p class="talk-sub">${esc(K("sub"))}</p>
    <button class="talk-btn primary" id="tScan" aria-pressed="false">${cam}<span>${esc(K("scan"))}</span></button>
    <div class="talk-row">
      <button class="talk-btn" id="tSay">${mic}<span>${esc(K("say"))}</span></button>
      <button class="talk-btn" id="tAgain"><span>${esc(K("again"))}</span></button>
    </div>
    <button class="talk-link" id="tPhoto">${esc(K("pick_photo"))}</button>
    <input id="tFile" type="file" accept="image/*" capture="environment" hidden aria-hidden="true" tabindex="-1">
    <video id="tVideo" playsinline muted aria-hidden="true"></video>
    <p id="talkStatus" class="talk-status"></p>
    <div id="talkResult"></div>
  </section>`;
  applyLang();
  document.getElementById("tScan").addEventListener("click", toggleScan);
  document.getElementById("tSay").addEventListener("click", talkListen);
  document.getElementById("tAgain").addEventListener("click", () => { if (lastSaid) speakOut(lastSaid.l, lastSaid.e); else talkSay(K("intro"), KE("intro")); });
  document.getElementById("tPhoto").addEventListener("click", () => document.getElementById("tFile").click());
  document.getElementById("tFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    stopScan();
    beep(660);
    const { readPack } = await import("./ocr.js");
    const r = await readPack(f, (k) => { if (k === "load") document.getElementById("talkStatus").textContent = K("loading"); });
    await announce(r, true);
  });
  document.getElementById("tScan").focus();
  talkSay(K("intro"), KE("intro"));
  warmPhotoReader();
}

async function announce(r, final) {
  const d = await describe(r);
  if (!d) { if (final) talkSay(S("nothing"), SE("nothing")); return false; }
  buzz([90, 60, 90]); beep(1320, 120, 0.07);
  showTalkResult(d);
  talkSay(`${K("found")} ${d.l}`, `${KE("found")} ${d.e}`);
  const st = document.getElementById("talkStatus");
  if (st) st.textContent = K("found"); // the card below holds the full answer
  return true;
}

function stopScan() {
  talkLoop = false;
  if (talkStream) { talkStream.getTracks().forEach((tr) => tr.stop()); talkStream = null; }
  const v = document.getElementById("tVideo");
  if (v) { v.srcObject = null; v.classList.remove("on"); }
  const b = document.getElementById("tScan");
  if (b) { b.setAttribute("aria-pressed", "false"); b.querySelector("span").textContent = K("scan"); }
}

async function frameBlob(video) {
  const k = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
}

async function toggleScan() {
  if (talkLoop) { stopScan(); hush(); return; }
  const btn = document.getElementById("tScan"), video = document.getElementById("tVideo");
  try {
    talkStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch { talkSay(K("no_camera"), KE("no_camera")); return; }
  video.srcObject = talkStream; video.classList.add("on");
  await video.play().catch(() => {});
  talkLoop = true;
  btn.setAttribute("aria-pressed", "true"); btn.querySelector("span").textContent = K("stop");
  document.getElementById("talkResult").innerHTML = "";
  talkSay(K("starting"), KE("starting"));
  const ocr = await import("./ocr.js");
  let ready = false;
  const warm = ocr.warmOcr().then(() => { ready = true; });
  setTimeout(() => { if (!ready && talkLoop) talkSay(K("loading"), KE("loading")); }, 3500);
  await warm;
  let tries = 0, ingOnly = 0, lastHint = Date.now();
  while (talkLoop) {
    if (!video.videoWidth) { await new Promise((r) => setTimeout(r, 200)); continue; }
    beep(520, 40, 0.025); // a soft tick: still looking
    const blob = await frameBlob(video);
    const r = await ocr.readPack(blob, null, { rotate: false });
    if (!talkLoop) break;
    tries++;
    if (r.root) { stopScan(); await announce(r, true); return; }
    if (r.ings.length && ++ingOnly >= 3) { stopScan(); await announce(r, true); return; } // no brand side in view: say the medicine inside
    if (Date.now() - lastHint > 6000 && !speechSynthesis.speaking) {
      lastHint = Date.now();
      r.textLines >= 2 ? talkSay(K("text_no_name"), KE("text_no_name")) : talkSay(K("no_text"), KE("no_text"));
    }
    if (tries > 60) { stopScan(); talkSay(S("nothing"), SE("nothing")); return; }
  }
}

async function talkListen() {
  stopScan();
  const { speechSupported, listen } = await import("./voice.js");
  if (!speechSupported()) { talkSay(t("voice_none"), T.en.voice_none); return; }
  hush();
  beep(880);
  try {
    const alts = await listen(SPEECH[lang], (live) => { const st = document.getElementById("talkStatus"); if (st) st.textContent = live; });
    const pick = await pickFromSpeech(alts);
    if (!pick) { talkSay(S("not_found", alts[0] || ""), SE("not_found", alts[0] || "")); return; }
    const { name, number } = parseQuery(pick.query);
    const r = pick.root ? { root: pick.root, number } : { ings: [name] };
    if (!(await announce(r, false))) talkSay(S("not_found", pick.heard), SE("not_found", pick.heard));
  } catch (err) { talkSay(t("voice_err", String(err.message || err))); }
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
    ${live ? `<div class="livebar"><b>Still on sale today.</b> We re-checked ${live.summary.with_2plus_listings} of the most dangerous twin names on a live online pharmacy (1mg, ${esc(live.summary.date)}): <b>${live.summary.still_twins}</b> are still sold as different medicines under one name. Rows marked <span class="livetag">LIVE</span> were verified.</div>` : ""}
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
      <p><b>“Can someone who cannot see use it?”</b><br>Yes: open <a href="#/talk">Talk mode</a>. One huge button turns on the camera; Twinpill keeps looking, tells you how to hold the medicine, then says the name, what it is for, the twin warning and the expiry date, in English, Tamil or Kannada. Every button has a spoken label for TalkBack and VoiceOver, and the pages pass an automated WCAG 2 AA check (axe-core).</p>
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

// Speak the answer out loud with the browser's own voices (no server, no audio files).
// Chrome loads its voice list late and drops long utterances, so we wait for the voices,
// pick one that really speaks the language, and say the text one sentence at a time.

let voicesReady = null;
function voices() {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  if (!voicesReady) {
    voicesReady = new Promise((res) => {
      const have = speechSynthesis.getVoices();
      if (have.length) return res(have);
      const done = () => res(speechSynthesis.getVoices());
      speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 700);
    });
  }
  return voicesReady;
}

/** The best voice for a BCP-47 tag like "en-IN": exact match, then same language; Google/natural voices first. */
export async function voiceFor(tag) {
  const vs = await voices();
  const base = tag.split("-")[0];
  const score = (v) => (v.lang.replace("_", "-") === tag ? 4 : 0) + (v.lang.toLowerCase().startsWith(base) ? 2 : 0) + (/google|natural|online/i.test(v.name) ? 1 : 0);
  const best = vs.filter((v) => v.lang.toLowerCase().startsWith(base)).sort((a, b) => score(b) - score(a))[0];
  return best || null;
}

let token = 0;
/**
 * Say `text` in language `tag`. If the device has no voice for Tamil or Kannada, say `fallbackEn`
 * in English instead of reading Tamil letters with an English voice.
 */
export async function say(text, tag = "en-IN", fallbackEn = null) {
  if (!("speechSynthesis" in window) || !text) return false;
  const my = ++token;
  speechSynthesis.cancel();
  let v = await voiceFor(tag);
  let lang = tag;
  if (!v && !tag.startsWith("en") && fallbackEn) { text = fallbackEn; lang = "en-IN"; v = await voiceFor(lang); }
  if (my !== token) return false; // a newer answer arrived
  const parts = String(text).split(/(?<=[.!?।])\s+/); // "0.5" stays in one piece
  // Chrome needs a tick after cancel() or the first utterance can be dropped
  await new Promise((r) => setTimeout(r, 60));
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    const u = new SpeechSynthesisUtterance(s);
    u.lang = lang;
    if (v) u.voice = v;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }
  // Chrome on desktop pauses long queues: keep it going
  const keep = setInterval(() => { if (my !== token || !speechSynthesis.speaking) clearInterval(keep); else if (speechSynthesis.paused) speechSynthesis.resume(); }, 5000);
  return true;
}

export function hush() { token++; if ("speechSynthesis" in window) speechSynthesis.cancel(); }

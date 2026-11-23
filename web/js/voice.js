// Voice input through the browser's speech recognition (Web Speech API).
// In Chrome/Android this is Google's speech service, the same engine as Google voice typing, with Indian
// English, Tamil and Kannada.
//
// Chrome on Android delivers results in pieces: it can fire a "final" result after only the first
// syllables and then keep sending longer, cumulative versions of the same phrase. So we never stop at the
// first result: we keep listening until the recogniser ends, show the live text as it grows, and use the
// longest complete phrase (with its alternatives) at the end.
let current = null;

export function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function stopListening() {
  try { current?.stop(); } catch { /* already stopped */ }
}

/**
 * Resolve with up to 5 transcript alternatives for one utterance in the given language (en-IN, ta-IN, kn-IN).
 * onPartial(text) is called with the live transcript while the person is still speaking.
 */
export function listen(langCode, onPartial) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return new Promise((resolve, reject) => {
    const rec = new SR();
    current = rec;
    rec.lang = langCode;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 5;
    let best = [];      // alternatives of the longest phrase seen so far
    let bestLen = 0;
    let finished = false;
    let silence = null;
    let lastJoined = ""; // used if the recogniser ends without marking anything final

    const consider = (alts) => {
      const len = (alts[0] || "").length;
      if (len >= bestLen) { best = alts; bestLen = len; }
    };

    rec.onresult = (e) => {
      // Phrase built from every result so far (desktop sends separate pieces)…
      // Android repeats the phrase as it grows ("ac", "acetam", "acetam 500"): keep the grown copy only.
      const pieces = [];
      for (let i = 0; i < e.results.length; i++) {
        const p = String(e.results[i][0].transcript || "").replace(/\s+/g, " ").trim();
        if (!p) continue;
        const last = pieces[pieces.length - 1];
        const norm = (x) => x.toLowerCase().replace(/[^a-z0-9\u0B80-\u0BFF\u0C80-\u0CFF]/g, "");
        if (last && norm(p).startsWith(norm(last))) pieces[pieces.length - 1] = p;
        else if (last && norm(last).startsWith(norm(p))) continue;
        else pieces.push(p);
      }
      const joined = pieces.join(" ");
      onPartial?.(joined);
      if (joined.length >= lastJoined.length) lastJoined = joined;
      // …and the alternatives of each individual result (Android sends growing copies of one phrase).
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) continue;
        const alts = [];
        for (let k = 0; k < res.length; k++) {
          const tx = String(res[k].transcript || "").replace(/\s+/g, " ").trim();
          if (tx && !alts.includes(tx)) alts.push(tx);
        }
        consider(alts);
      }
      // If the joined phrase is longer than any single result, it is the real utterance.
      const finals = [...e.results].every((r) => r.isFinal);
      if (finals && joined.length > bestLen) consider([joined, ...best.filter((a) => a !== joined)]);
      // Stop a moment after the person stops talking.
      clearTimeout(silence);
      silence = setTimeout(() => { try { rec.stop(); } catch { /* ended */ } }, 1500);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // handled in onend
      if (!finished) { finished = true; clearTimeout(silence); reject(new Error(e.error || "error")); }
    };
    rec.onend = () => {
      current = null;
      clearTimeout(silence);
      if (finished) return;
      finished = true;
      if (lastJoined.length > bestLen) best = [lastJoined, ...best];
      best.length ? resolve(best) : reject(new Error("no-speech"));
    };
    rec.start();
    setTimeout(() => { if (!finished) try { rec.stop(); } catch { /* ended */ } }, 10000);
  });
}

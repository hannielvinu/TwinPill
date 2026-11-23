// Voice input through the browser's speech recognition (Web Speech API).
// In Chrome/Android this is Google's speech service, the same engine as Google voice typing, with Indian
// English, Tamil and Kannada. We ask for several alternatives and let the catalogue pick the best one.
let current = null;

export function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function stopListening() {
  try { current?.stop(); } catch { /* already stopped */ }
}

/** Resolve with up to 5 transcript alternatives for one utterance in the given language (en-IN, ta-IN, kn-IN). */
export function listen(langCode) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return new Promise((resolve, reject) => {
    const rec = new SR();
    current = rec;
    rec.lang = langCode;
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 5;
    let done = false;
    rec.onresult = (e) => {
      const res = e.results[0];
      const alts = [];
      for (let i = 0; i < res.length; i++) {
        const tx = String(res[i].transcript || "").trim();
        if (tx && !alts.includes(tx)) alts.push(tx);
      }
      done = true;
      alts.length ? resolve(alts) : reject(new Error("no-speech"));
    };
    rec.onerror = (e) => { if (!done) { done = true; reject(new Error(e.error || "error")); } };
    rec.onend = () => { current = null; if (!done) { done = true; reject(new Error("no-speech")); } };
    rec.start();
    setTimeout(() => { if (!done) rec.stop(); }, 8000);
  });
}

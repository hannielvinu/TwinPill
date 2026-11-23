// On-device photo reading with Tesseract.js, then brand-name lookup on every word it finds.
import { findRoots, loadRoots } from "./search.js";

const SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load the photo reader"));
    document.head.appendChild(s);
  });
}

export async function readNames(file, onProgress) {
  await Promise.all([loadScript(SRC), loadRoots()]);
  const { data } = await window.Tesseract.recognize(file, "eng", {
    logger: (m) => { if (m.status === "recognizing text") onProgress?.(m.progress); },
  });
  const words = (data.words || [])
    .map((w) => ({ w: w.text.toLowerCase().replace(/[^a-z]/g, ""), conf: w.confidence, h: w.bbox.y1 - w.bbox.y0, raw: w.text }))
    .filter((w) => w.w.length >= 4 && w.conf > 40);
  const seen = new Set();
  const found = [];
  for (const w of words) {
    if (seen.has(w.w)) continue;
    seen.add(w.w);
    const hit = findRoots(w.w, 1)[0];
    if (hit && (hit.score >= 1.9 || hit.score >= 0.7)) {
      const after = data.text.slice(data.text.toLowerCase().indexOf(w.raw.toLowerCase()) + w.raw.length).match(/\d+(?:\.\d+)?/);
      found.push({ text: `${hit.root}${after ? " " + after[0] : ""}`, root: hit.root, size: w.h, score: hit.score + (hit.twin ? 0.2 : 0) });
    }
  }
  // Brand names are usually the largest text on a strip.
  found.sort((a, b) => b.size - a.size || b.score - a.score);
  return found.slice(0, 5);
}

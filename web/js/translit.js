// Tamil and Kannada script → Latin letters, so a brand name said or typed in either language
// (e.g. "அசிட்டம்" or "ಅಸಿಟಮ್") can be matched against the catalogue's Latin brand names.

const TA = {
  vowels: { "அ": "a", "ஆ": "aa", "இ": "i", "ஈ": "ii", "உ": "u", "ஊ": "uu", "எ": "e", "ஏ": "ee", "ஐ": "ai", "ஒ": "o", "ஓ": "oo", "ஔ": "au" },
  signs: { "ா": "aa", "ி": "i", "ீ": "ii", "ு": "u", "ூ": "uu", "ெ": "e", "ே": "ee", "ை": "ai", "ொ": "o", "ோ": "oo", "ௌ": "au" },
  cons: { "க": "k", "ங": "ng", "ச": "s", "ஞ": "nj", "ட": "t", "ண": "n", "த": "th", "ந": "n", "ப": "p", "ம": "m", "ய": "y", "ர": "r", "ல": "l", "வ": "v", "ழ": "l", "ள": "l", "ற": "r", "ன": "n", "ஜ": "j", "ஷ": "sh", "ஸ": "s", "ஹ": "h", "ஃ": "f" },
  virama: "்",
};
const KN = {
  vowels: { "ಅ": "a", "ಆ": "aa", "ಇ": "i", "ಈ": "ii", "ಉ": "u", "ಊ": "uu", "ಋ": "ru", "ಎ": "e", "ಏ": "ee", "ಐ": "ai", "ಒ": "o", "ಓ": "oo", "ಔ": "au" },
  signs: { "ಾ": "aa", "ಿ": "i", "ೀ": "ii", "ು": "u", "ೂ": "uu", "ೃ": "ru", "ೆ": "e", "ೇ": "ee", "ೈ": "ai", "ೊ": "o", "ೋ": "oo", "ೌ": "au", "ಂ": "m", "ಃ": "h" },
  cons: { "ಕ": "k", "ಖ": "kh", "ಗ": "g", "ಘ": "gh", "ಙ": "ng", "ಚ": "ch", "ಛ": "chh", "ಜ": "j", "ಝ": "jh", "ಞ": "nj", "ಟ": "t", "ಠ": "th", "ಡ": "d", "ಢ": "dh", "ಣ": "n", "ತ": "t", "ಥ": "th", "ದ": "d", "ಧ": "dh", "ನ": "n", "ಪ": "p", "ಫ": "ph", "ಬ": "b", "ಭ": "bh", "ಮ": "m", "ಯ": "y", "ರ": "r", "ಲ": "l", "ವ": "v", "ಶ": "sh", "ಷ": "sh", "ಸ": "s", "ಹ": "h", "ಳ": "l", "ೞ": "l", "ಱ": "r" },
  virama: "್",
};
const DIGITS = { "௦": "0", "௧": "1", "௨": "2", "௩": "3", "௪": "4", "௫": "5", "௬": "6", "௭": "7", "௮": "8", "௯": "9",
  "೦": "0", "೧": "1", "೨": "2", "೩": "3", "೪": "4", "೫": "5", "೬": "6", "೭": "7", "೮": "8", "೯": "9" };

export const hasIndic = (s) => /[஀-௿ಀ-೿]/.test(s);

function run(chars, i, map) {
  const c = chars[i];
  const next = chars[i + 1];
  if (map.vowels[c]) return [map.vowels[c], 1];
  if (map.cons[c]) {
    if (next === map.virama) return [map.cons[c], 2];
    if (map.signs[next] && next !== "ಂ" && next !== "ಃ") return [map.cons[c] + map.signs[next], 2];
    return [map.cons[c] + "a", 1];
  }
  if (map.signs[c]) return [map.signs[c], 1];
  return null;
}

/** Latin approximation of Tamil/Kannada text; Latin text and digits pass through unchanged. */
export function toLatin(text) {
  const chars = [...String(text)];
  let out = "";
  for (let i = 0; i < chars.length;) {
    const c = chars[i];
    if (DIGITS[c]) { out += DIGITS[c]; i++; continue; }
    const map = /[஀-௿]/.test(c) ? TA : /[ಀ-೿]/.test(c) ? KN : null;
    if (!map) { out += c; i++; continue; }
    const r = run(chars, i, map);
    if (!r) { i++; continue; }
    out += r[0];
    i += r[1];
  }
  // Tamil writes a final inherent 'a' that brand names rarely have ("டோலோ" is fine, "அசிட்டம" → keep)
  return out.replace(/\s+/g, " ").trim();
}

/** Tamil does not mark voicing (k/g, t/d, p/b): compare names with voicing removed. */
export function devoice(key) {
  return String(key).replace(/g/g, "k").replace(/d/g, "t").replace(/b/g, "p");
}

/**
 * Sound-normalised form for comparing a name heard or written in Tamil/Kannada with Latin brand names:
 * long vowels shortened, voicing removed (Tamil does not write it), c/k/q/g → k, s/z/j/sh/ch → s,
 * f/ph/b → p, d/th → t, w → v, doubled letters collapsed, and the helper 'u' Tamil adds inside
 * consonant clusters dropped ("kuroosin" → "krosin" ≈ "crocin").
 */
export function indicNorm(word) {
  let s = String(word).toLowerCase().replace(/[^a-z]/g, "");
  s = s.replace(/aa/g, "a").replace(/ii|ee/g, "i").replace(/uu|oo/g, "u");
  s = s.replace(/x/g, "ks").replace(/c(?=[eiy])/g, "s").replace(/ch|sh|z|j/g, "s").replace(/ck|c|q|kh|gh|g/g, "k");
  s = s.replace(/ph|bh|f|b/g, "p").replace(/th|dh|d/g, "t").replace(/w/g, "v").replace(/y/g, "i").replace(/o/g, "u").replace(/e/g, "i");
  s = s.replace(/h/g, ""); // remaining h is silent or a breath ("oh lip" → "ulip")
  s = s.replace(/^([kptsm])u(?=[rlv])/, "$1");
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}
export const skeleton = (n) => n.replace(/[aeiou]/g, "");

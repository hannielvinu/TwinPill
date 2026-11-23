// Indian-English phonetic key. Mirrors pipeline/phonetic.py exactly (checked by tests/test_phonetic_parity.py).
const RULES = [
  [/ph/g, "f"], [/gh/g, "g"], [/kh/g, "k"], [/bh/g, "b"], [/dh/g, "d"], [/th/g, "t"],
  [/sch/g, "sk"], [/ck/g, "k"], [/q/g, "k"], [/x/g, "ks"],
  [/c(?=[eiy])/g, "s"], [/c/g, "k"], [/z/g, "s"], [/j/g, "s"], [/w/g, "v"],
  [/y/g, "i"], [/ee/g, "i"], [/oo/g, "u"], [/ou/g, "u"],
];

export function phoneticKey(name) {
  let s = String(name).toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  s = s.replace(/(.)\1+/g, "$1");
  s = s.replace(/(?<=[^aeiou])h/g, "");
  const first = s[0];
  let rest = s.slice(1).replace(/[aeiou]/g, "");
  s = (first + rest).replace(/(.)\1+/g, "$1");
  return s;
}

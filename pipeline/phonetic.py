"""Indian-English phonetic key for brand names.

Collapses spellings a listener cannot tell apart when the name is spoken at a chemist counter:
ph/f, c/k/q/s, v/w, z/s/j, aspirated pairs (bh/b, dh/d, th/t, kh/k, gh/g), double letters, and most
vowels after the first sound. Mirrored exactly in web/js/phonetic.js (tests/test_phonetic_parity.py).
"""
from __future__ import annotations

import re

_RULES = [
    (r"ph", "f"), (r"gh", "g"), (r"kh", "k"), (r"bh", "b"), (r"dh", "d"), (r"th", "t"),
    (r"sch", "sk"), (r"ck", "k"), (r"q", "k"), (r"x", "ks"),
    (r"c(?=[eiy])", "s"), (r"c", "k"), (r"z", "s"), (r"j", "s"), (r"w", "v"),
    (r"y", "i"), (r"ee", "i"), (r"oo", "u"), (r"ou", "u"),
]


def phonetic_key(name: str) -> str:
    s = re.sub(r"[^a-z]", "", name.lower())
    if not s:
        return ""
    for pat, rep in _RULES:
        s = re.sub(pat, rep, s)
    s = re.sub(r"(.)\1+", r"\1", s)  # double letters
    s = re.sub(r"(?<=[^aeiou])h", "", s)  # silent h after a consonant
    first, rest = s[0], s[1:]
    rest = re.sub(r"[aeiou]", "", rest)  # vowels after the first sound carry little
    s = first + rest
    s = re.sub(r"(.)\1+", r"\1", s)
    return s

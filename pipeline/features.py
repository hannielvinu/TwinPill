"""Pair features for 'could these two medicine names be confused?' (sound, spelling and handwriting)."""
from __future__ import annotations

import re

import jellyfish
from rapidfuzz.distance import DamerauLevenshtein, Indel, JaroWinkler, Levenshtein

from phonetic import phonetic_key

# Glyph groups that blur together in handwriting or small print.
_VISUAL = [("rn", "m"), ("cl", "d"), ("vv", "w"), ("nn", "m"), ("ii", "u"), ("l", "i"), ("j", "i"),
           ("q", "g"), ("h", "n"), ("e", "c"), ("o", "a"), ("u", "v"), ("t", "f")]

FEATURES = [
    "lev_ratio", "dl_ratio", "jw", "indel", "dice2", "dice3", "prefix", "suffix", "len_diff", "len_mean",
    "same_first", "same_last", "ph_eq", "ph_lev", "soundex_eq", "metaphone_eq", "metaphone_lev",
    "nysiis_eq", "visual_lev", "vowel_skel_eq", "consonant_lev",
]


def _clean(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _ngrams(s: str, n: int) -> set[str]:
    s = f"^{s}$"
    return {s[i:i + n] for i in range(len(s) - n + 1)}


def _dice(a: set, b: set) -> float:
    return 2 * len(a & b) / (len(a) + len(b)) if a and b else 0.0


def _visual(s: str) -> str:
    for a, b in _VISUAL:
        s = s.replace(a, b)
    return s


def _common_prefix(a: str, b: str) -> int:
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n


def pair_features(x: str, y: str) -> list[float]:
    a, b = _clean(x), _clean(y)
    if not a or not b:
        return [0.0] * len(FEATURES)
    pa, pb = phonetic_key(a), phonetic_key(b)
    ma, mb = jellyfish.metaphone(a), jellyfish.metaphone(b)
    cons_a, cons_b = re.sub(r"[aeiou]", "", a), re.sub(r"[aeiou]", "", b)
    return [
        Levenshtein.normalized_similarity(a, b),
        DamerauLevenshtein.normalized_similarity(a, b),
        JaroWinkler.similarity(a, b),
        Indel.normalized_similarity(a, b),
        _dice(_ngrams(a, 2), _ngrams(b, 2)),
        _dice(_ngrams(a, 3), _ngrams(b, 3)),
        _common_prefix(a, b) / max(len(a), len(b)),
        _common_prefix(a[::-1], b[::-1]) / max(len(a), len(b)),
        abs(len(a) - len(b)),
        (len(a) + len(b)) / 2,
        float(a[0] == b[0]),
        float(a[-1] == b[-1]),
        float(pa == pb),
        Levenshtein.normalized_similarity(pa, pb),
        float(jellyfish.soundex(a) == jellyfish.soundex(b)),
        float(ma == mb),
        Levenshtein.normalized_similarity(ma, mb),
        float(jellyfish.nysiis(a) == jellyfish.nysiis(b)),
        Levenshtein.normalized_similarity(_visual(a), _visual(b)),
        float(re.sub(r"[^aeiou]", "", a) == re.sub(r"[^aeiou]", "", b)),
        Levenshtein.normalized_similarity(cons_a, cons_b),
    ]


def poca_like(x: str, y: str) -> float:
    """Baseline in the spirit of FDA POCA: mean of a spelling score and a sound score (0-1)."""
    a, b = _clean(x), _clean(y)
    if not a or not b:
        return 0.0
    ortho = Levenshtein.normalized_similarity(a, b)
    phon = Levenshtein.normalized_similarity(jellyfish.metaphone(a), jellyfish.metaphone(b))
    return (ortho + phon) / 2

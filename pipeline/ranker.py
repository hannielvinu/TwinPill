"""Candidate generation + learned ranking for a heard or typed name. Mirrored in web/js/search.js."""
from __future__ import annotations

import math

from rapidfuzz.distance import JaroWinkler, Levenshtein

RANK_FEATURES = ["jw", "same_sound", "sound_sim", "spell_sim", "log_count", "multiword", "same_first", "len_diff"]


def candidates(flat: str, ph: str, roots: list[list]) -> list[tuple[list, list[float]]]:
    out = []
    for r in roots:
        rflat = r[0].replace(" ", "")
        if abs(len(rflat) - len(flat)) > 3:
            continue
        if rflat[:1] != flat[:1] and r[1] != ph:
            continue
        jw = JaroWinkler.similarity(flat, rflat)
        same = float(r[1] == ph and len(ph) >= 2)
        if jw < 0.80 and not same:
            continue
        out.append((r, rank_features(flat, ph, r, jw, same)))
    return out


def rank_features(flat, ph, r, jw=None, same=None) -> list[float]:
    rflat = r[0].replace(" ", "")
    if jw is None:
        jw = JaroWinkler.similarity(flat, rflat)
    if same is None:
        same = float(r[1] == ph and len(ph) >= 2)
    return [
        jw,
        same,
        Levenshtein.normalized_similarity(ph, r[1]),
        Levenshtein.normalized_similarity(flat, rflat),
        math.log10(r[2] + 1),
        float(" " in r[0]),
        float(rflat[:1] == flat[:1]),
        float(abs(len(rflat) - len(flat))),
    ]


def score(x: list[float], w: dict) -> float:
    return w["intercept"] + sum(c * (v - m) / s for c, v, m, s in zip(w["coef"], x, w["mean"], w["scale"]))

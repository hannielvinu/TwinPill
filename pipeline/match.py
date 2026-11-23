"""Python twin of web/js/search.js findRoots(), so offline evaluation measures exactly what the app does."""
from __future__ import annotations

import json
import math
import re

from rapidfuzz.distance import JaroWinkler

from common import PROC
from features import pair_features
from phonetic import phonetic_key


class Matcher:
    def __init__(self, roots: list[list]):
        # roots rows: [root, phon, count, twin, harm, high_alert]
        self.roots = roots
        self.exact = {r[0].replace(" ", ""): r for r in roots}
        lr = json.loads((PROC / "confusability_lr.json").read_text())
        self.lr = lr

    def confusability(self, a: str, b: str) -> float:
        x = pair_features(a, b)
        z = self.lr["intercept"] + sum(c * (v - m) / s for c, v, m, s in zip(self.lr["coef"], x, self.lr["mean"], self.lr["scale"]))
        return 1 / (1 + math.exp(-z))

    @staticmethod
    def clean(text: str) -> str:
        t = re.sub(r"\d+(?:\.\d+)?", " ", text.lower())
        return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", t)).strip()

    def find(self, text: str, limit: int = 8, rerank: bool = True) -> list[dict]:
        name = self.clean(text)
        if not name:
            return []
        flat = name.replace(" ", "")
        ph = phonetic_key(flat)
        out = []
        for r in self.roots:
            rflat = r[0].replace(" ", "")
            if rflat == flat:
                out.append({"root": r[0], "count": r[2], "score": 2.0, "how": "exact"})
                continue
            if abs(len(rflat) - len(flat)) > 3:
                continue
            if rflat[:1] != flat[:1] and r[1] != ph:
                continue
            jw = JaroWinkler.similarity(flat, rflat)
            same = r[1] == ph and len(ph) >= 2
            if jw < 0.86 and not same:
                continue
            out.append({"root": r[0], "count": r[2], "score": jw + (0.08 if same else 0), "how": "sounds" if same else "spelling"})
        out.sort(key=lambda d: (-d["score"], -d["count"]))
        out = out[:30]
        if rerank:
            for d in out:
                if d["how"] != "exact":
                    d["score"] = 1.0 + self.confusability(flat, d["root"].replace(" ", "")) * 0.9 + min(math.log10(d["count"] + 1), 3) * 0.01
            out.sort(key=lambda d: (-d["score"], -d["count"]))
        return out[:limit]

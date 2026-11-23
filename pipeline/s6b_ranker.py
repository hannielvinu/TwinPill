"""Step 6b: learn how to rank candidate brand names for a misheard or misspelt name.

Trained on the heard-alike utterances of one synthetic voice, tested on the other voice (and vice versa),
so the reported accuracy is always on speech the ranker never saw.
"""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from common import PROC, RESULTS, WEB_DATA
from phonetic import phonetic_key
from ranker import RANK_FEATURES, candidates, score

RULE = {"jw": 1.0, "same_sound": 0.08}  # the hand-set rule used before learning


def table(df: pd.DataFrame, roots: list[list]) -> list[dict]:
    exact = {r[0].replace(" ", ""): r for r in roots}
    items = []
    for row in df.itertuples(index=False):
        flat = re.sub(r"[^a-z]", "", str(row.heard).lower())
        if not flat:
            items.append({"voice": row.voice, "name": row.name, "cands": [], "exact": None})
            continue
        ph = phonetic_key(flat)
        cands = candidates(flat, ph, roots)
        items.append({"voice": row.voice, "name": row.name, "heard": flat,
                      "exact": exact[flat][0] if flat in exact else None, "cands": cands})
    return items


def topk(item, scorer, k):
    if item["exact"] is not None and scorer != "exact_only":
        pass
    if not item["cands"]:
        return []
    ranked = sorted(item["cands"], key=lambda c: -scorer(c[1]))
    return [c[0][0] for c in ranked[:k]]


def evaluate(items, scorer):
    t1 = np.mean([bool(topk(i, scorer, 1)) and topk(i, scorer, 1)[0] == i["name"] for i in items])
    t3 = np.mean([i["name"] in topk(i, scorer, 3) for i in items])
    return round(float(t1), 4), round(float(t3), 4)


def fit(items):
    X, y = [], []
    for it in items:
        for r, f in it["cands"]:
            X.append(f)
            y.append(int(r[0] == it["name"]))
    X, y = np.array(X), np.array(y)
    sc = StandardScaler().fit(X)
    lr = LogisticRegression(max_iter=3000, class_weight="balanced").fit(sc.transform(X), y)
    return {"features": RANK_FEATURES, "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
            "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0])}


def main() -> None:
    roots = json.loads((WEB_DATA / "roots.json").read_text())
    df = pd.read_csv(RESULTS / "heard_alike.csv").fillna("")
    items = table(df, roots)
    voices = sorted(df["voice"].unique())
    rule = lambda f: RULE["jw"] * f[0] + RULE["same_sound"] * f[1]  # noqa: E731
    out = {"folds": []}
    agg = {"exact": [], "rule": [], "learned": []}
    for test_v in voices:
        tr = [i for i in items if i["voice"] != test_v]
        te = [i for i in items if i["voice"] == test_v]
        w = fit(tr)
        ex1 = round(float(np.mean([i["exact"] == i["name"] for i in te])), 4)
        r1, r3 = evaluate(te, rule)
        # the app always lists an exact catalogue match first, then the learned order
        l1, l3 = evaluate(te, lambda f, w=w: score(f, w) + (100.0 if f[3] == 1.0 else 0.0))
        out["folds"].append({"test_voice": test_v, "exact_top1": ex1, "rule_top1": r1, "rule_top3": r3,
                             "learned_top1": l1, "learned_top3": l3, "n": len(te)})
        agg["exact"].append((ex1, ex1)); agg["rule"].append((r1, r3)); agg["learned"].append((l1, l3))
    out["mean"] = {k: {"top1": round(float(np.mean([a for a, _ in v])), 4), "top3": round(float(np.mean([b for _, b in v])), 4)}
                   for k, v in agg.items()}
    final = fit(items)
    (WEB_DATA / "ranker.json").write_text(json.dumps(final, indent=1))
    (PROC / "ranker.json").write_text(json.dumps(final, indent=1))
    (RESULTS / "ranker.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

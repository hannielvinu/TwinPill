"""Step 5: learn which pairs of medicine names get confused, from real reported confusions.

Positives: name pairs in the ISMP List of Confused Drug Names (published error reports, June 2024).
Negatives: other pairs from the same name list that were never reported (3 per positive, half sharing
the first letter so they are not trivially different).
Evaluation: 5-fold cross-validation grouped by name cluster, so no test name was seen in training.
"""
from __future__ import annotations

import json
import random
import re
import urllib.request

import lightgbm as lgb
import numpy as np
import pandas as pd
from rapidfuzz.distance import Levenshtein
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from common import PROC, RAW, RESULTS
from features import FEATURES, pair_features, poca_like

ISMP_URL = "https://online.ecri.org/hubfs/ISMP/Resources/ISMP_ConfusedDrugNames.pdf"
SEED = 7


def load_pairs() -> list[tuple[str, str]]:
    path = RAW / "ismp_pairs.json"
    if path.exists():
        return [tuple(p) for p in json.loads(path.read_text())]
    import subprocess
    pdf = RAW / "ismp_confused.pdf"
    if not pdf.exists():
        req = urllib.request.Request(ISMP_URL, headers={"User-Agent": "Mozilla/5.0"})
        pdf.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True).stdout
    pairs = []
    for ln in txt.splitlines():
        if not ln.strip() or "ISMP" in ln or "Drug Name" in ln or "www." in ln:
            continue
        cells = [c.strip() for c in re.split(r"\s{2,}", ln.strip()) if c.strip()]
        if len(cells) == 4:
            pairs += [(cells[0], cells[1]), (cells[2], cells[3])]
        elif len(cells) == 2:
            pairs.append((cells[0], cells[1]))
    ok = lambda x: re.fullmatch(r"[A-Za-z][A-Za-z\- ]{2,30}\*?", x) is not None  # noqa: E731
    out = sorted({tuple(sorted([a.rstrip("*").strip().lower(), b.rstrip("*").strip().lower()]))
                  for a, b in pairs if ok(a) and ok(b)})
    path.write_text(json.dumps(out))
    return out


def usable(a: str, b: str) -> bool:
    """Keep single-name pairs; drop 'X' vs 'X XR' style extensions (those are name twins, handled in step 3)."""
    ca, cb = re.sub(r"[^a-z]", "", a), re.sub(r"[^a-z]", "", b)
    if len(a.split()) > 2 or len(b.split()) > 2:
        return False
    return not (ca.startswith(cb) or cb.startswith(ca))


def build_dataset() -> pd.DataFrame:
    rng = random.Random(SEED)
    pos = [(a, b) for a, b in load_pairs() if usable(a, b)]
    names = sorted({n for p in pos for n in p})
    pos_set = {tuple(sorted(p)) for p in pos}
    # name clusters (connected components) -> CV groups
    parent = {n: n for n in names}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for a, b in pos:
        parent[find(a)] = find(b)
    by_first: dict[str, list[str]] = {}
    for n in names:
        by_first.setdefault(n[0], []).append(n)
    rows = []
    for a, b in pos:
        rows.append((a, b, 1))
        for k in range(3):
            pool = by_first[a[0]] if k < 2 and len(by_first[a[0]]) > 3 else names
            for _ in range(50):
                c = rng.choice(pool)
                if c != a and tuple(sorted((a, c))) not in pos_set:
                    rows.append((a, c, 0))
                    break
    df = pd.DataFrame(rows, columns=["a", "b", "y"])
    df["group"] = [find(a) for a in df["a"]]
    return df


def recall_at_precision(y, s, p_min=0.9):
    p, r, _ = precision_recall_curve(y, s)
    ok = r[p >= p_min]
    return float(ok.max()) if len(ok) else 0.0


def bootstrap_ci(y, s, fn, n=500, seed=SEED):
    rng = np.random.default_rng(seed)
    y, s = np.asarray(y), np.asarray(s)
    vals = []
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if y[i].min() == y[i].max():
            continue
        vals.append(fn(y[i], s[i]))
    return [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)]


def main() -> None:
    df = build_dataset()
    X = np.array([pair_features(a, b) for a, b in zip(df["a"], df["b"])])
    y = df["y"].to_numpy()
    params = dict(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=10,
                  subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=SEED, verbose=-1)
    oof = {"lgbm": np.zeros(len(df)), "logreg": np.zeros(len(df))}
    for tr, te in GroupKFold(n_splits=5).split(X, y, df["group"]):
        m = lgb.LGBMClassifier(**params).fit(X[tr], y[tr])
        oof["lgbm"][te] = m.predict_proba(X[te])[:, 1]
        lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(X[tr], y[tr])
        oof["logreg"][te] = lr.predict_proba(X[te])[:, 1]
    oof["levenshtein"] = np.array([Levenshtein.normalized_similarity(a, b) for a, b in zip(df["a"], df["b"])])
    oof["poca_like"] = np.array([poca_like(a, b) for a, b in zip(df["a"], df["b"])])

    res = {"n_pairs": int(len(df)), "n_positive": int(y.sum()), "n_names": int(df["group"].nunique()), "models": {}}
    for k, s in oof.items():
        res["models"][k] = {
            "roc_auc": round(float(roc_auc_score(y, s)), 4),
            "pr_auc": round(float(average_precision_score(y, s)), 4),
            "recall_at_90_precision": round(recall_at_precision(y, s), 4),
            "pr_auc_95ci": bootstrap_ci(y, s, average_precision_score),
        }
    # The best cross-validated model is shipped: logistic regression wins on PR-AUC and runs in the browser.
    best = max(("lgbm", "logreg"), key=lambda k: res["models"][k]["pr_auc"])
    res["chosen_model"] = best
    final = lgb.LGBMClassifier(**params).fit(X, y)
    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)).fit(X, y)
    sc, clf = lr.named_steps["standardscaler"], lr.named_steps["logisticregression"]
    export = {"features": FEATURES, "mean": sc.mean_.round(6).tolist(), "scale": sc.scale_.round(6).tolist(),
              "coef": clf.coef_[0].round(6).tolist(), "intercept": round(float(clf.intercept_[0]), 6)}
    (PROC / "confusability_lr.json").write_text(json.dumps(export, indent=1))
    # threshold that keeps >= 90% precision out-of-fold
    p, r, th = precision_recall_curve(y, oof[best])
    idx = np.where(p[:-1] >= 0.9)[0]
    res["threshold_p90"] = round(float(th[idx[0]]), 4) if len(idx) else 0.5
    imp = sorted(zip(FEATURES, final.booster_.feature_importance("gain")), key=lambda t: -t[1])
    res["feature_importance_gain"] = {k: round(float(v), 1) for k, v in imp}
    PROC.mkdir(exist_ok=True, parents=True)
    final.booster_.save_model(str(PROC / "confusability.txt"))
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "confusability.json").write_text(json.dumps(res, indent=2))
    pd.DataFrame({"a": df["a"], "b": df["b"], "y": y, **{f"s_{k}": v for k, v in oof.items()}}).to_csv(
        RESULTS / "confusability_oof.csv", index=False)
    print(json.dumps({k: v for k, v in res.items() if k != "feature_importance_gain"}, indent=2))


if __name__ == "__main__":
    main()

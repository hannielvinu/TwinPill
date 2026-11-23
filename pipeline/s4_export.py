"""Step 4: export compact JSON for the browser app (no server needed; every lookup runs on the device)."""
from __future__ import annotations

import json
from collections import defaultdict

import pandas as pd

from common import PROC, WEB_DATA
from phonetic import phonetic_key
from plain_uses import USE_KN, USE_TA


def ta(use: str) -> str:
    return " + ".join(USE_TA.get(u, u) for u in use.split(" + ")) if use else ""


def kn(use: str) -> str:
    return " + ".join(USE_KN.get(u, u) for u in use.split(" + ")) if use else ""


def shard_of(root: str) -> str:
    k = root.replace(" ", "")[:2]
    return k if len(k) == 2 and k.isalpha() else "__"


def main() -> None:
    prods = pd.read_pickle(PROC / "products_enriched.pkl")
    tw = pd.read_pickle(PROC / "twins.pkl")
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_DATA / "p").mkdir(exist_ok=True)

    # per-root twin summary
    summ = {}
    for root, g in tw.groupby("root"):
        top = g.sort_values("harm", ascending=False).iloc[0]
        summ[root] = {
            "kind": "cross" if (g["kind"] == "cross").any() else "family",
            "harm": int(top["harm"]),
            "ha": bool(g["high_alert"].any()),
        }

    counts = prods.groupby("root").size()
    roots = []
    for root, n in counts.items():
        s = summ.get(root)
        flag = 0 if s is None else (2 if s["kind"] == "cross" else 1)
        roots.append([root, phonetic_key(root.replace(" ", "")), int(n), flag, 0 if s is None else s["harm"],
                      1 if (s and s["ha"]) else 0])
    roots.sort(key=lambda r: -r[2])
    (WEB_DATA / "roots.json").write_text(json.dumps(roots, separators=(",", ":")))

    shards: dict[str, dict] = defaultdict(dict)
    cols = ["name", "maker", "strength", "form", "route", "ings", "use", "high_alert", "price", "suffix", "incomplete"]
    for root, g in prods.groupby("root"):
        rows = []
        for r in g[cols].itertuples(index=False):
            rows.append([r.name, r.maker, r.strength, r.form, r.route, r.ings, r.use, ta(r.use), int(r.high_alert),
                         None if pd.isna(r.price) else round(float(r.price), 2), r.suffix, int(r.incomplete), kn(r.use)])
        shards[shard_of(root)][root] = rows
    for k, v in shards.items():
        (WEB_DATA / "p" / f"{k}.json").write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":")))

    # atlas: worst twin per root; cross-company twins first, then by harm, then by product count
    best = tw.sort_values(["harm"], ascending=False).drop_duplicates("root")
    best = best.assign(n=best["root"].map(counts), cross=(best["kind"] == "cross").astype(int)).sort_values(["cross", "harm", "n"], ascending=[False, False, False])
    atlas = []
    for r in best.head(400).itertuples(index=False):
        atlas.append({
            "root": r.root, "kind": r.kind, "harm": int(r.harm), "clue": r.clue, "why": r.why,
            "a": {"name": r.a_name, "maker": r.a_maker, "ings": r.a_ings, "use": r.a_use, "use_ta": ta(r.a_use), "use_kn": kn(r.a_use)},
            "b": {"name": r.b_name, "maker": r.b_maker, "ings": r.b_ings, "use": r.b_use, "use_ta": ta(r.b_use), "use_kn": kn(r.b_use)},
        })
    (WEB_DATA / "atlas.json").write_text(json.dumps(atlas, ensure_ascii=False, separators=(",", ":")))

    # ingredient index: lets the app recognise a generic name ("metformin") instead of guessing a brand
    ing = pd.read_pickle(PROC / "ingredients.pkl")
    brands_by_ing: dict[str, dict] = defaultdict(dict)
    for r in prods[["root", "ings"]].itertuples(index=False):
        for i in r.ings:
            brands_by_ing[i][r.root] = brands_by_ing[i].get(r.root, 0) + 1
    ing_rows = []
    for r in ing.itertuples(index=False):
        b = brands_by_ing.get(r.ingredient, {})
        top = sorted(b.items(), key=lambda kv: -kv[1])[:8]
        ing_rows.append([r.ingredient, r.use, ta(r.use), len(b), [k for k, _ in top], int(r.high_alert), kn(r.use)])
    (WEB_DATA / "ingredients.json").write_text(json.dumps(ing_rows, ensure_ascii=False, separators=(",", ":")))

    stats = json.loads((PROC / "s3_report.json").read_text())
    stats.update(json.loads((PROC / "s1_report.json").read_text()))
    stats.update({"ingredient_" + k: v for k, v in json.loads((PROC / "s2_report.json").read_text()).items()})
    harm_hist = pd.cut(best["harm"], bins=[0, 20, 40, 60, 80, 100], include_lowest=True).value_counts().sort_index()
    stats["harm_histogram"] = {str(k): int(v) for k, v in harm_hist.items()}
    stats["clue_counts_roots"] = {k: int(v) for k, v in best["clue"].value_counts().items()}
    (WEB_DATA / "stats.json").write_text(json.dumps(stats, indent=1))
    print("roots", len(roots), "shards", len(shards), "atlas", len(atlas))


if __name__ == "__main__":
    main()

"""Step 3: find 'name twins' - one brand name root that covers medicines with no ingredient in common.

Two kinds:
  cross  - different companies use the same name for unrelated medicines (e.g. Acetam: paracetamol vs levetiracetam)
  family - one company reuses a name for unrelated medicines via suffixes (e.g. Medzol / Medzol-DSR)
Each twin pair gets a transparent harm score and the 'only clue' that tells the two apart.
"""
from __future__ import annotations

import itertools
import json

import pandas as pd

from common import PROC


def product_use(ings: list[str], use_of: dict[str, str]) -> str:
    uses = []
    for i in ings:
        u = use_of.get(i, "")
        if u and u not in uses:
            uses.append(u)
    return " + ".join(uses[:2])


def harm_score(a: dict, b: dict) -> tuple[int, list[str]]:
    score, why = 0, []
    if a["atc3"] and b["atc3"] and not (set(a["atc3"]) & set(b["atc3"])):
        score += 35
        why.append("different purpose")
    if a["atc1"] and b["atc1"] and not (set(a["atc1"]) & set(b["atc1"])):
        score += 15
        why.append("different body system")
    if a["high_alert"] or b["high_alert"]:
        score += 30
        why.append("high-alert medicine involved")
    if a["route"] == b["route"]:
        score += 10
        why.append("taken the same way")
        if a["form"] == b["form"]:
            score += 5
            why.append("same dosage form")
    if a["form"] == b["form"] and a["strength"] == b["strength"]:
        score += 5
        why.append("only the company name differs")
    return min(score, 100), why


def only_clue(a: dict, b: dict) -> str:
    if a["route"] != b["route"] or a["form"] != b["form"]:
        return "form"
    if a["strength"] and b["strength"] and a["strength"] != b["strength"]:
        return "strength"
    return "company"


def main() -> None:
    prods = pd.read_pickle(PROC / "products.pkl")
    ing = pd.read_pickle(PROC / "ingredients.pkl").set_index("ingredient")
    use_of = ing["use"].to_dict()
    atc3_of = ing["atc3"].to_dict()
    ha_of = ing["high_alert"].to_dict()

    prods["use"] = [product_use(x, use_of) for x in prods["ings"]]
    prods["atc3"] = [sorted({c for i in x for c in atc3_of.get(i, [])}) for x in prods["ings"]]
    prods["atc1"] = [sorted({c[0] for c in a}) for a in prods["atc3"]]
    prods["high_alert"] = [any(ha_of.get(i, False) for i in x) for x in prods["ings"]]
    prods["ingkey"] = prods["ings"].map(lambda x: "|".join(sorted(x)))
    prods.to_pickle(PROC / "products_enriched.pkl")

    pairs = []
    multi = prods.groupby("root").filter(lambda g: g["ingkey"].nunique() > 1)
    for root, g in multi.groupby("root"):
        # one representative product per (maker, ingredient set, form, strength)
        reps = g.drop_duplicates(["maker", "ingkey", "form", "strength"]).to_dict("records")
        for a, b in itertools.combinations(reps, 2):
            if set(a["ings"]) & set(b["ings"]):
                continue
            kind = "family" if a["maker"] == b["maker"] else "cross"
            h, why = harm_score(a, b)
            pairs.append({
                "root": root, "kind": kind, "harm": h, "why": why, "clue": only_clue(a, b),
                "a_id": a["id"], "a_name": a["name"], "a_maker": a["maker"], "a_ings": a["ings"], "a_use": a["use"],
                "b_id": b["id"], "b_name": b["name"], "b_maker": b["maker"], "b_ings": b["ings"], "b_use": b["use"],
                "high_alert": bool(a["high_alert"] or b["high_alert"]),
            })
    tw = pd.DataFrame(pairs)
    tw.to_pickle(PROC / "twins.pkl")

    roots_cross = set(tw.loc[tw.kind == "cross", "root"])
    roots_family = set(tw.loc[tw.kind == "family", "root"])
    multi_maker_roots = int((prods.groupby("root")["maker"].nunique() > 1).sum())
    top = tw.sort_values("harm", ascending=False).drop_duplicates("root")
    rep = {
        "products": int(len(prods)),
        "roots": int(prods["root"].nunique()),
        "roots_used_by_2plus_companies": multi_maker_roots,
        "twin_roots_cross_company": len(roots_cross),
        "twin_roots_same_company_family": len(roots_family),
        "twin_roots_any": len(roots_cross | roots_family),
        "share_of_multi_company_roots_with_cross_twin": round(len(roots_cross) / multi_maker_roots, 4),
        "twin_pairs": int(len(tw)),
        "twin_roots_high_alert": int(tw.loc[tw.high_alert, "root"].nunique()),
        "twin_roots_harm_ge_70": int(top.loc[top.harm >= 70, "root"].nunique()),
        "products_under_a_twin_name": int(prods["root"].isin(roots_cross | roots_family).sum()),
        "pairs_where_strength_is_only_clue": int((tw.clue == "strength").sum()),
        "roots_where_strength_is_only_clue_and_high_alert": int(tw[(tw.clue == "strength") & tw.high_alert]["root"].nunique()),
        "pairs_where_only_company_differs": int((tw.clue == "company").sum()),
        "roots_where_only_company_differs": int(tw.loc[tw.clue == "company", "root"].nunique()),
    }
    (PROC / "s3_report.json").write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))
    show = tw[(tw.kind == "cross") & tw.high_alert].sort_values("harm", ascending=False).drop_duplicates("root").head(30)
    print(show[["root", "harm", "clue", "a_name", "a_use", "b_name", "b_use"]].to_string())


if __name__ == "__main__":
    main()

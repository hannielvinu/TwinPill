"""Step 7: collect every test into results/metrics.json (+ plots) and publish it to the app's Evidence page."""
from __future__ import annotations

import json
import re
import shutil

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import precision_recall_curve  # noqa: E402

from common import PROC, RESULTS, WEB_DATA  # noqa: E402

INK, A, B, TWIN, GREY = "#14112b", "#5b4bff", "#ff7a1a", "#ff3b5c", "#b9b5cc"
plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#888", "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK})

# Cases named in published reports (Lancet Regional Health SE Asia 2024; CDSCO consultation 2026).
PUBLISHED = [
    {"name": "Linamac", "root": "linamac", "expect": [["lenalidomide"], ["linagliptin"]], "source": "Lancet RH-SEA 2024"},
    {"name": "Medzole", "root": "medzole", "expect": [["metronidazole"], ["itraconazole"], ["albendazole"], ["midazolam"]], "source": "Lancet RH-SEA 2024"},
    {"name": "Flucor", "root": "flucor", "expect": [["fluconazole"], ["flupentixol", "flupenthixol", "melitracen"]], "source": "Lancet RH-SEA 2024"},
    {"name": "Medzol", "root": "medzol", "expect": [["midazolam"], ["pantoprazole"]], "source": "CDSCO notice 2026 (as reported)"},
]


def num_set(strengths):
    out = set()
    for s in strengths:
        out |= set(re.findall(r"\d+(?:\.\d+)?", s))
    return out


def question_kind(groups: list[dict]) -> str:
    top = groups[:4]
    if len({g["forms"][0] for g in top}) == len(top):
        return "form"
    nums = [num_set(g["strengths"]) for g in top]
    if all(nums) and all(not (nums[i] & nums[j]) for i in range(len(nums)) for j in range(len(nums)) if i != j):
        return "strength"
    sufs = [set(g["suffixes"]) for g in top]
    if all(not (sufs[i] & sufs[j]) for i in range(len(sufs)) for j in range(len(sufs)) if i != j):
        return "suffix"
    return "company"


def published_cases(prods: pd.DataFrame, twins: set) -> dict:
    rows = []
    for case in PUBLISHED:
        g = prods[prods["root"] == case["root"]]
        present = []
        for alts in case["expect"]:
            present.append(any(any(a in i for i in ings for a in alts) for ings in g["ings"]))
        in_data = sum(present)
        rows.append({"name": case["name"], "source": case["source"], "meanings_reported": len(case["expect"]),
                     "meanings_in_snapshot": in_data, "flagged_as_twin": case["root"] in twins,
                     "detectable": in_data >= 2})
    det = [r for r in rows if r["detectable"]]
    return {"cases": rows, "detectable": len(det), "caught": sum(r["flagged_as_twin"] for r in det)}


def coverage(prods: pd.DataFrame, twin_roots: list[str]) -> dict:
    kinds = []
    sub = prods[prods["root"].isin(set(twin_roots))]
    for root, g in sub.groupby("root"):
        groups = []
        for key, h in g.groupby("ingkey"):
            groups.append({"n": len(h), "forms": list(dict.fromkeys(h["form"])), "strengths": [s for s in h["strength"] if s], "suffixes": list(dict.fromkeys(h["suffix"]))})
        groups.sort(key=lambda d: -d["n"])
        kinds.append(question_kind(groups))
    s = pd.Series(kinds).value_counts()
    n = int(s.sum())
    return {"twin_names": n, "by_form": int(s.get("form", 0)), "by_printed_number": int(s.get("strength", 0)),
            "by_letters_after_name": int(s.get("suffix", 0)), "company_only": int(s.get("company", 0)),
            "resolved_without_company": round((s.get("form", 0) + s.get("strength", 0) + s.get("suffix", 0)) / n, 4)}


def plot_pr(oof: pd.DataFrame, path):
    fig, ax = plt.subplots(figsize=(6.4, 4.2), dpi=160)
    for col, lab, c, lw in [("s_logreg", "Twinpill model", A, 2.6), ("s_poca_like", "POCA-style score", B, 1.6),
                            ("s_levenshtein", "Edit distance", GREY, 1.6)]:
        p, r, _ = precision_recall_curve(oof["y"], oof[col])
        ax.plot(r, p, color=c, lw=lw, label=lab)
    ax.set_xlabel("Recall (share of real confused pairs found)")
    ax.set_ylabel("Precision")
    ax.set_ylim(0.2, 1.01)
    ax.legend(frameon=False)
    ax.set_title("Which name pairs get confused? (held-out ISMP pairs)", loc="left", fontsize=11, color=INK)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


def plot_heard(h: dict, path):
    labels = ["Exact-match search", "Fuzzy search", "Twinpill"]
    vals = [h["retrieval_top1"]["plain_exact_search"], h["retrieval_top1"]["fuzzy_jw_phonetic"], h["retrieval_top1"]["twinpill"]]
    fig, ax = plt.subplots(figsize=(6.4, 3.2), dpi=160)
    bars = ax.barh(labels, [100 * v for v in vals], color=[GREY, B, A])
    for b_, v in zip(bars, vals):
        ax.text(b_.get_width() + 1, b_.get_y() + b_.get_height() / 2, f"{100 * v:.0f}%", va="center", color=INK, fontweight="bold")
    ax.set_xlim(0, 110)
    ax.set_xlabel("Spoken names recovered correctly (top-1)")
    ax.set_title("Spoken name → speech AI → lookup (held-out voice)", loc="left", fontsize=11, color=INK)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


def plot_atlas(stats: dict, path):
    fig, ax = plt.subplots(figsize=(6.4, 3.0), dpi=160)
    labels = ["Different companies,\nunrelated medicines", "Same company,\nsuffix variants", "Involves a\nhigh-alert medicine"]
    vals = [stats["twin_roots_cross_company"], stats["twin_roots_same_company_family"], stats["twin_roots_high_alert"]]
    bars = ax.bar(labels, vals, color=[TWIN, A, INK])
    for b_, v in zip(bars, vals):
        ax.text(b_.get_x() + b_.get_width() / 2, v + 80, f"{v:,}", ha="center", color=INK, fontweight="bold")
    ax.set_ylabel("Brand names")
    ax.set_title("Twin names in 242,924 Indian medicine listings", loc="left", fontsize=11, color=INK)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


def main() -> None:
    prods = pd.read_pickle(PROC / "products_enriched.pkl")
    tw = pd.read_pickle(PROC / "twins.pkl")
    stats = json.loads((WEB_DATA / "stats.json").read_text())
    conf = json.loads((RESULTS / "confusability.json").read_text())
    oof = pd.read_csv(RESULTS / "confusability_oof.csv")
    heard_path = RESULTS / "heard_alike.json"
    heard = json.loads(heard_path.read_text()) if heard_path.exists() else None
    rk_path = RESULTS / "ranker.json"
    if heard and rk_path.exists():
        rk = json.loads(rk_path.read_text())["mean"]
        heard["retrieval_top1"] = {"plain_exact_search": rk["exact"]["top1"], "fuzzy_jw_phonetic": rk["rule"]["top1"], "twinpill": rk["learned"]["top1"]}
        heard["retrieval_top3"] = {"fuzzy_jw_phonetic": rk["rule"]["top3"], "twinpill": rk["learned"]["top3"]}
    pub = published_cases(prods, set(tw["root"]))
    cov = coverage(prods, list(tw["root"].unique()))
    plots = RESULTS / "plots"
    plots.mkdir(parents=True, exist_ok=True)
    plot_pr(oof, plots / "confusability_pr.png")
    plot_atlas(stats, plots / "twin_counts.png")
    if heard:
        plot_heard(heard, plots / "heard_alike.png")

    M = conf["models"]
    sections = [
        {"title": "1 · Which name pairs get confused?",
         "what": f"{conf['n_positive']} real confused pairs from the ISMP list vs {conf['n_pairs'] - conf['n_positive']} never-reported pairs; 5-fold cross-validation with no name shared between train and test.",
         "cols": ["ROC-AUC", "PR-AUC", "Recall at 90% precision"], "fmt": ["num", "num", "pct"],
         "rows": [
             {"name": "Edit distance (what fuzzy search uses)", "vals": [M["levenshtein"]["roc_auc"], M["levenshtein"]["pr_auc"], M["levenshtein"]["recall_at_90_precision"]]},
             {"name": "POCA-style sound + spelling score (FDA approach)", "vals": [M["poca_like"]["roc_auc"], M["poca_like"]["pr_auc"], M["poca_like"]["recall_at_90_precision"]]},
             {"name": "Gradient boosting, 21 features", "vals": [M["lgbm"]["roc_auc"], M["lgbm"]["pr_auc"], M["lgbm"]["recall_at_90_precision"]]},
             {"name": "Twinpill model (logistic regression, 21 features)", "vals": [M["logreg"]["roc_auc"], M["logreg"]["pr_auc"], M["logreg"]["recall_at_90_precision"]], "ours": True},
         ],
         "note": f"Twinpill PR-AUC 95% CI {M['logreg']['pr_auc_95ci']}; edit distance {M['levenshtein']['pr_auc_95ci']}.",
         "plot": "data/plots/confusability_pr.png"},
    ]
    if heard:
        sections.append({
            "title": "2 · Heard-alike: medicine names through speech AI",
            "what": f"{heard['names']} Indian brand names spoken by {len(heard['voices'])} synthetic voices ({heard['utterances']} utterances), transcribed by {heard['asr_model']}, then looked up.",
            "cols": ["Top-1 correct", "Top-3 correct"], "fmt": ["pct", "pct"],
            "rows": [
                {"name": "Exact-match search on the transcript", "vals": [heard["retrieval_top1"]["plain_exact_search"], heard["retrieval_top1"]["plain_exact_search"]]},
                {"name": "Fuzzy spelling + sound search", "vals": [heard["retrieval_top1"]["fuzzy_jw_phonetic"], heard["retrieval_top3"]["fuzzy_jw_phonetic"]]},
                {"name": "Twinpill learned ranker (trained on one voice, tested on the other)", "vals": [heard["retrieval_top1"]["twinpill"], heard["retrieval_top3"]["twinpill"]], "ours": True},
            ],
            "note": f"Speech AI spelled only {100 * heard['spelled_right']:.0f}% of names exactly right; {100 * heard['lands_on_other_real_brand']:.1f}% of transcripts were a different real Indian brand.",
            "plot": "data/plots/heard_alike.png"})
    sections.append({
        "title": f"{len(sections) + 1} · Does one question separate the twins?",
        "what": f"For all {cov['twin_names']:,} twin names, which single question splits the unrelated medicines.",
        "cols": ["Names", "Share"], "fmt": ["int", "pct"],
        "rows": [
            {"name": "Asked by form (tablet or eye drop?)", "vals": [cov["by_form"], round(cov["by_form"] / cov["twin_names"], 4)]},
            {"name": "Asked by the printed number", "vals": [cov["by_printed_number"], round(cov["by_printed_number"] / cov["twin_names"], 4)]},
            {"name": "Asked by the letters after the name (DSR, Plus…)", "vals": [cov["by_letters_after_name"], round(cov["by_letters_after_name"] / cov["twin_names"], 4)]},
            {"name": "Only the company or full printed name tells them apart", "vals": [cov["company_only"], round(cov["company_only"] / cov["twin_names"], 4)]},
        ],
        "note": "When only the company differs, Twinpill says so plainly and asks the person to read the company name on the strip.",
        "plot": "data/plots/twin_counts.png"})

    live_path = RESULTS / "live_check_summary.json"
    if live_path.exists():
        lv = json.loads(live_path.read_text())
        sections.insert(0, {
            "title": "0 · Still sold today? Re-checked on a live pharmacy",
            "what": f"Our top twin names, searched on 1mg on {lv['summary']['date']}; each product page's composition and marketer read directly. "
                    f"{lv['summary']['still_twins']} of {lv['summary']['with_2plus_listings']} names with 2+ live listings are still twins.",
            "cols": ["Listing A", "Listing B"],
            "rows": [{"name": r["root"].capitalize(), "vals": [r["a"], r["b"]], "ours": False} for r in lv["rows"][:12]],
            "note": "Full list with product links: results/live_check_1mg.json (re-run: make live)."})
    metrics = {"sections": sections, "published_cases": pub, "question_coverage": cov, "confusability": conf,
               "heard_alike": heard, "atlas": stats}
    (RESULTS / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (WEB_DATA / "metrics.json").write_text(json.dumps({"sections": sections}, indent=1))
    dst = WEB_DATA / "plots"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(plots, dst)
    print(json.dumps({"published": pub, "coverage": cov}, indent=2))


if __name__ == "__main__":
    main()

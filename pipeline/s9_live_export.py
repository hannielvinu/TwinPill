"""Step 9: publish the live-pharmacy re-check (results/live_check_1mg.json) to the app and the Evidence page.

For each name that is still a twin today, keep up to 3 listings with different compositions,
choosing the pair whose medicines differ most in purpose (by our plain-language use labels)."""
from __future__ import annotations

import itertools
import json
import re

import pandas as pd

from common import PROC, RESULTS, WEB_DATA


def ings(comp: str) -> set[str]:
    return {re.sub(r"\(.*?\)", "", x).strip().lower() for x in re.split(r"\s*\+\s*|,\s*", comp) if x.strip()}


def main() -> None:
    src = json.loads((RESULTS / "live_check_1mg.json").read_text())
    use_of = pd.read_pickle(PROC / "ingredients.pkl").set_index("ingredient")["use"].to_dict()
    date = src["checked_at"][:10]
    names, rows = {}, []
    for n in src["names"]:
        live = [p for p in n["products"] if not p.get("discontinued")]
        if not n.get("live_twin"):
            continue
        # distinct compositions
        seen, uniq = set(), []
        for p in live:
            k = frozenset(ings(p["composition"]))
            if k not in seen:
                seen.add(k)
                uniq.append(p)
        def purpose(p):
            return {use_of.get(i, "") for i in ings(p["composition"])} - {""}
        best = max(itertools.combinations(uniq, 2),
                   key=lambda ab: (not (ings(ab[0]["composition"]) & ings(ab[1]["composition"])),
                                   not (purpose(ab[0]) & purpose(ab[1]))))
        keep = list(best) + [p for p in uniq if p not in best][:1]
        names[n["root"]] = [{"name": p["name"], "composition": p["composition"], "marketer": p["marketer"], "url": p["url"]} for p in keep]
        a, b = best
        rows.append({"root": n["root"], "a": f"{a['name']} = {a['composition']} ({a['marketer']})",
                     "b": f"{b['name']} = {b['composition']} ({b['marketer']})"})
    summary = {"date": date, "checked": len(src["names"]),
               "with_2plus_listings": sum(len(n["products"]) >= 2 for n in src["names"]),
               "still_twins": len(names)}
    (WEB_DATA / "live.json").write_text(json.dumps({"date": date, "summary": summary, "names": names}, ensure_ascii=False, indent=1))
    (RESULTS / "live_check_summary.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=1))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()

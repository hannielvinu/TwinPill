"""Step 2: map every ingredient to WHO ATC codes (via Wikidata) and to a plain-language use."""
from __future__ import annotations

import csv
import json
import re
import urllib.parse
import urllib.request

import pandas as pd

from common import PROC, RAW
from plain_uses import ATC1_PLAIN, ATC3_PLAIN, HIGH_ALERT, MANUAL_ATC, USE_OVERRIDE

SPARQL = """SELECT ?item ?atc ?label (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  ?item wdt:P267 ?atc .
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label)="en") }
  OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias)="en") }
} GROUP BY ?item ?atc ?label"""

SALT_WORDS = r"\b(hydrochloride|hcl|hydrobromide|sodium|potassium|calcium|magnesium|sulphate|sulfate|maleate|" \
             r"mesylate|besilate|besylate|tartrate|succinate|citrate|acetate|phosphate|fumarate|dihydrate|" \
             r"monohydrate|trihydrate|anhydrous|bromide|chloride|disodium|dipropionate|propionate|valerate|" \
             r"furoate|butyrate|hyclate|proxetil|axetil|pivoxil|cilexetil|medoxomil|ip|bp|usp|ph eur)\b"


def fetch_wikidata() -> pd.DataFrame:
    path = RAW / "wikidata_atc.csv"
    if not path.exists():
        url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": SPARQL})
        req = urllib.request.Request(url, headers={"Accept": "text/csv", "User-Agent": "twinpill-research/0.1"})
        path.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    return pd.read_csv(path)


def norm(s: str) -> str:
    s = s.lower().replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_salt(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(SALT_WORDS, " ", s)).strip()


def main() -> None:
    wd = fetch_wikidata()
    wd = wd[wd["atc"].astype(str).str.len() == 7]  # substances only (level 5)
    lookup: dict[str, set[str]] = {}
    for _, r in wd.iterrows():
        names = [r["label"]] + (str(r["aliases"]).split("|") if isinstance(r["aliases"], str) else [])
        for n in names:
            if isinstance(n, str) and n.strip():
                for key in {norm(n), strip_salt(norm(n))}:
                    if key:
                        lookup.setdefault(key, set()).add(r["atc"])

    prods = pd.read_pickle(PROC / "products.pkl")
    ings = sorted({i for x in prods["ings"] for i in x})
    counts = pd.Series([i for x in prods["ings"] for i in x]).value_counts()

    rows = []
    for ing in ings:
        key = norm(ing)
        codes = lookup.get(key) or lookup.get(strip_salt(key)) or set()
        if not codes and " " in key:  # e.g. 'vitamin d3' / 'ofloxacin ophthalmic'
            codes = lookup.get(key.split(" ")[0], set())
        if ing in MANUAL_ATC:
            codes = set(codes) | {MANUAL_ATC[ing].ljust(7, '_')}
        codes = sorted(codes)
        atc3 = sorted({c[:4] for c in codes})
        use = next((ATC3_PLAIN[c] for c in atc3 if c in ATC3_PLAIN), None)
        if use is None and codes:
            use = ATC1_PLAIN.get(codes[0][0])
        use = USE_OVERRIDE.get(ing, use)
        ha = any(h in ing for h in HIGH_ALERT) or any(c[:4] in {"B01A", "A10A", "L01X", "N02A"} for c in codes)
        rows.append({"ingredient": ing, "products": int(counts.get(ing, 0)), "atc": codes, "atc3": atc3,
                     "use": use or "", "high_alert": bool(ha)})
    out = pd.DataFrame(rows)
    out.to_pickle(PROC / "ingredients.pkl")
    with_code = out[out["atc"].map(len) > 0]
    weighted = with_code["products"].sum() / out["products"].sum()
    rep = {
        "ingredients": int(len(out)),
        "with_atc": int(len(with_code)),
        "with_plain_use": int((out["use"] != "").sum()),
        "product_weighted_atc_coverage": round(float(weighted), 4),
        "high_alert_ingredients": int(out["high_alert"].sum()),
    }
    (PROC / "s2_report.json").write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))
    print(out[out["atc"].map(len) == 0].sort_values("products", ascending=False).head(40)[["ingredient", "products"]].to_string())


if __name__ == "__main__":
    main()

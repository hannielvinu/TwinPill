"""Step 1: download (if needed) and clean the Indian medicine catalogue into one tidy product table."""
from __future__ import annotations

import json
import urllib.request

import pandas as pd

from common import DATASET_URL, PROC, RAW, brand_key, form_group, ingredients, name_root, parse_form, parse_strength, suffix


def load_raw() -> pd.DataFrame:
    path = RAW / "indian_medicine_data.csv"
    if not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print("downloading", DATASET_URL)
        urllib.request.urlretrieve(DATASET_URL, path)
    return pd.read_csv(path)


def main() -> None:
    df = load_raw()
    report = {"rows_raw": int(len(df))}
    df = df[df["Is_discontinued"].astype(str).str.upper() == "FALSE"].copy()
    report["rows_active"] = int(len(df))
    df["name"] = df["name"].astype(str).str.strip()
    df = df.drop_duplicates(subset=["name", "manufacturer_name", "short_composition1", "short_composition2"])
    report["rows_after_dedup"] = int(len(df))

    df["root"] = df["name"].map(brand_key)
    df["first_word"] = df["name"].map(name_root)
    df["suffix"] = df["name"].map(suffix)
    df["form"] = df["name"].map(parse_form)
    df["route"] = df["form"].map(form_group)
    df["strength"] = df["name"].map(parse_strength)
    df["ings"] = [ingredients(a, b) for a, b in zip(df["short_composition1"], df["short_composition2"])]
    missing_ing = df["ings"].map(len) == 0
    report["dropped_no_ingredient"] = int(missing_ing.sum())
    short_root = df["root"].str.replace(" ", "").str.len() < 3
    report["dropped_root_under_3_letters"] = int((short_root & ~missing_ing).sum())
    df = df[~missing_ing & ~short_root]
    report["rows_clean"] = int(len(df))
    report["unique_roots"] = int(df["root"].nunique())
    report["unique_ingredients"] = int(len({i for x in df["ings"] for i in x}))
    report["manufacturers"] = int(df["manufacturer_name"].nunique())

    out = df.rename(columns={"price(₹)": "price", "manufacturer_name": "maker"})[
        ["id", "name", "root", "first_word", "suffix", "strength", "form", "route", "maker", "price", "pack_size_label", "ings"]
    ].reset_index(drop=True)
    PROC.mkdir(parents=True, exist_ok=True)
    out.to_pickle(PROC / "products.pkl")
    (PROC / "s1_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

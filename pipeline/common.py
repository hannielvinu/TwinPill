"""Shared helpers: paths, name parsing and ingredient normalisation."""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
RESULTS = ROOT / "results"
WEB_DATA = ROOT / "web" / "data"

DATASET_URL = (
    "https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/"
    "main/DATA/indian_medicine_data.csv"
)

# Dosage-form words, longest first so "eye drop" wins over "drop".
FORMS = [
    "soft gelatin capsule", "dry syrup", "oral suspension", "oral solution", "eye drop",
    "ear drop", "nasal spray", "nasal drop", "eye ointment", "eye/ear drop", "oral drops",
    "oral gel", "mouth wash", "transdermal patch", "rotacap", "respules", "inhaler",
    "injection", "infusion", "tablet", "capsule", "syrup", "suspension", "drop", "drops",
    "cream", "ointment", "gel", "lotion", "spray", "powder", "sachet", "granules",
    "solution", "suppository", "shampoo", "soap", "patch", "kit", "liquid", "linctus",
    "expectorant", "elixir", "lozenges", "vial", "paste", "emulsion", "foam", "serum",
]
FORM_GROUP = {
    "eye drop": "eye", "eye ointment": "eye", "eye/ear drop": "eye", "ear drop": "ear",
    "nasal spray": "nose", "nasal drop": "nose", "injection": "injection", "infusion": "injection",
    "vial": "injection", "cream": "skin", "ointment": "skin", "gel": "skin", "lotion": "skin",
    "shampoo": "skin", "soap": "skin", "patch": "skin", "transdermal patch": "skin",
    "foam": "skin", "serum": "skin", "inhaler": "inhaled", "rotacap": "inhaled", "respules": "inhaled",
    "suppository": "rectal",
}
SUFFIX_NOISE = {"tablet", "capsule", "mg", "ml", "mcg", "gm", "g", "iu", "sr", "er", "dt", "xr",
                "cr", "md", "od", "ds", "kid", "kids", "new", "with", "of", "and", "sugar", "free"}

SYNONYMS = {
    "acetaminophen": "paracetamol",
    "paracetamol/acetaminophen": "paracetamol",
    "amoxycillin": "amoxicillin",
    "clavulanic acid": "clavulanic acid",
    "salbutamol/albuterol": "salbutamol",
    "albuterol": "salbutamol",
    "glyburide": "glibenclamide",
    "lignocaine": "lidocaine",
    "frusemide": "furosemide",
    "valproate": "valproic acid",
    "sodium valproate": "valproic acid",
    "divalproex sodium": "valproic acid",
    "levosalbutamol/levalbuterol": "levosalbutamol",
    "rabeprazole sodium": "rabeprazole",
}


def ascii_fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def name_root(name: str) -> str:
    """First word of the brand name, letters only, lower case ('Medzole-DSR' -> 'medzole')."""
    first = re.split(r"[\s\-_/]+", ascii_fold(str(name)).strip().lower())[0]
    return re.sub(r"[^a-z]", "", first)


def parse_form(name: str) -> str:
    low = str(name).lower()
    for f in FORMS:
        if re.search(r"\b" + re.escape(f) + r"\b", low):
            return "drop" if f == "drops" else f
    return "other"


def form_group(form: str) -> str:
    return FORM_GROUP.get(form, "oral")


STRENGTH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|mcg|g|gm|ml|iu|i\.u|%)", re.I)


def parse_strength(name: str) -> str:
    """Strength as printed in the name: '650mg' or '5mg/500mg'; a bare number ('Dolo 650') counts too."""
    low = str(name).lower()
    m = re.findall(r"\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%)?(?:\s*/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|iu|%)?)*", low)
    m = [x.replace(" ", "") for x in m if x.strip()]
    return m[0] if m else ""


def suffix(name: str) -> str:
    """Letters that follow the root and are not strength/form words ('Medzole-DSR' -> 'dsr')."""
    low = ascii_fold(str(name)).lower()
    toks = re.split(r"[\s\-_/]+", low)[1:]
    out = []
    for t in toks:
        t = re.sub(r"[^a-z]", "", t)
        if not t or t in SUFFIX_NOISE:
            continue
        if any(t == f or t in f.split() for f in FORMS):
            continue
        out.append(t)
    return " ".join(out[:2])


def clean_ingredient(raw: str) -> str:
    s = re.sub(r"\(.*?\)", "", str(raw)).strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = SYNONYMS.get(s, s)
    for k, v in SYNONYMS.items():
        if s == k:
            s = v
    return s


def ingredients(c1, c2) -> list[str]:
    out = []
    for c in (c1, c2):
        if isinstance(c, str) and c.strip():
            x = clean_ingredient(c)
            if x and x not in out:
                out.append(x)
    return out


def _is_generic_word(tok: str) -> bool:
    """Short tokens and everyday English words ('new', 'mega', 'all') are not distinctive brand names."""
    if len(tok) <= 3:
        return True
    try:
        from wordfreq import zipf_frequency
    except ImportError:  # pragma: no cover
        return False
    return zipf_frequency(tok, "en") >= 3.0


def brand_key(name: str) -> str:
    """The part of the name a person would say: first word, or first two words when the first is generic.

    'Acetam 500mg Tablet' -> 'acetam';  'New Triglucored Forte Tablet' -> 'new triglucored';
    'Zen Retard 100mg Tablet' -> 'zen retard';  'Zen 100mg Tablet' -> 'zen'.
    """
    toks = [re.sub(r"[^a-z]", "", t) for t in re.split(r"[\s\-_/]+", ascii_fold(str(name)).strip().lower())]
    raw = re.split(r"[\s\-_/]+", ascii_fold(str(name)).strip().lower())
    if not toks or not toks[0]:
        return ""
    first = toks[0]
    if _is_generic_word(first) and len(raw) > 1:
        second_raw = raw[1]
        second = toks[1]
        is_form = any(second == f or second in f.split() for f in FORMS)
        if second and not re.search(r"\d", second_raw) and not is_form and len(second) >= 2:
            return f"{first} {second}"
    return first

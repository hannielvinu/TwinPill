from common import brand_key, ingredients, name_root, parse_form, parse_strength, suffix


def test_brand_key_keeps_distinct_names():
    assert brand_key("Acetam 500mg Tablet") == "acetam"
    assert brand_key("Medzole-DSR Capsule") == "medzole"
    assert brand_key("Olip 0.1% Eye Drop") == "olip"


def test_brand_key_extends_generic_first_word():
    assert brand_key("New Triglucored Forte Tablet") == "new triglucored"
    assert brand_key("Zen Retard 100mg Tablet") == "zen retard"
    assert brand_key("Zen 100mg Tablet") == "zen"


def test_form_and_strength():
    assert parse_form("Olip 0.1% Eye Drop") == "eye drop"
    assert parse_form("Acetam 200mg Injection") == "injection"
    assert parse_strength("Acetam 650mg Tablet") == "650mg"
    assert parse_strength("Dolo 650 Tablet") == "650"
    assert parse_strength("Pandol P 37.5mg/325mg Tablet") == "37.5mg/325mg"


def test_suffix_and_root():
    assert suffix("Medzole-DSR Capsule") == "dsr"
    assert name_root("Medzole-DSR Capsule") == "medzole"


def test_ingredients_normalised():
    assert ingredients("Paracetamol (500mg) ", "Acetaminophen (500mg)") == ["paracetamol"]
    assert ingredients("Amoxycillin  (500mg) ", " Clavulanic Acid (125mg)") == ["amoxicillin", "clavulanic acid"]


def test_truncation_guard_flags_possibly_cut_ingredient_lists():
    import sys, pathlib
    import pandas as pd
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "pipeline"))
    from s3_twins import flag_incomplete
    prods = pd.DataFrame({
        "root": ["telma"] * 4,
        "maker": ["Glenmark"] * 4,
        "strength": ["40mg", "40mg/12.5mg", "40mg/5mg", "50mg/25mg/12.5mg"],
        "ings": [["telmisartan"], ["telmisartan", "hydrochlorothiazide"], ["telmisartan", "amlodipine"], ["metoprolol", "chlorthalidone"]],
    })
    inc = flag_incomplete(prods)
    # 3 printed doses but 2 listed ingredients, and missing the family molecule telmisartan (Telma-MCT)
    assert bool(inc.iloc[3]) is True
    assert not inc.iloc[:3].any()

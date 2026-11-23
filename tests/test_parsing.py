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

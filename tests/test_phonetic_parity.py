"""The browser (web/js/phonetic.js) and the pipeline (pipeline/phonetic.py) must produce identical keys."""
import json
import subprocess
from pathlib import Path

from phonetic import phonetic_key

WORDS = ["acetam", "asetam", "acitam", "adnil", "olip", "zentra", "sentra", "linamac", "phenytoin", "fenitoin",
         "calpol", "kalpol", "dolo", "medzole", "medzol", "biopam", "xyzal", "quicklax", "thyronorm", "ciplox",
         "bhavya", "dhanvantari", "khushi", "jazz", "wysolone", "chymoral", "cheston", "zyrop", "a", ""]
ROOT = Path(__file__).resolve().parents[1]


def test_parity_with_browser():
    js = (
        f"import {{ phoneticKey }} from '{(ROOT / 'web/js/phonetic.js').as_uri()}';"
        f"console.log(JSON.stringify({json.dumps(WORDS)}.map(phoneticKey)));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == [phonetic_key(w) for w in WORDS]


def test_sound_alikes_share_a_key():
    assert phonetic_key("acetam") == phonetic_key("asetam")
    assert phonetic_key("phenytoin") == phonetic_key("fenitoin")
    assert phonetic_key("calpol") == phonetic_key("kalpol")
    assert phonetic_key("zentra") == phonetic_key("sentra")
    assert phonetic_key("dolo") != phonetic_key("calpol")

"""The app's learned ranking (web/js/search.js) must match the evaluated one (pipeline/ranker.py)."""
import json
import subprocess
from pathlib import Path

from phonetic import phonetic_key
from ranker import candidates, score

ROOT = Path(__file__).resolve().parents[1]
QUERIES = ["acetum", "metal", "eaten", "onyx", "tamric", "enziker", "phloxen", "adnil", "olip"]


def python_top3(q, roots, w):
    c = candidates(q, phonetic_key(q), roots)
    c.sort(key=lambda t: -(score(t[1], w) + (100 if t[1][3] == 1.0 else 0)))
    return [x[0][0] for x in c[:3]]


def test_js_matches_python():
    web = ROOT / "web"
    roots = json.loads((web / "data/roots.json").read_text())
    w = json.loads((web / "data/ranker.json").read_text())
    js = (
        "import fs from 'node:fs';"
        f"globalThis.fetch = async (u) => ({{ ok: true, json: async () => JSON.parse(fs.readFileSync('{web.as_posix()}/' + u)) }});"
        f"const s = await import('{(web / 'js/search.js').as_uri()}');"
        "await s.loadRoots();"
        f"console.log(JSON.stringify({json.dumps(QUERIES)}.map((q) => s.findRoots(q, 3).map((h) => h.root))));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == [python_top3(q, roots, w) for q in QUERIES]

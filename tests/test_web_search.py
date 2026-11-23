import subprocess
from pathlib import Path


def test_browser_search_logic():
    root = Path(__file__).resolve().parents[1]
    out = subprocess.run(["node", str(root / "tests/test_search.mjs")], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr

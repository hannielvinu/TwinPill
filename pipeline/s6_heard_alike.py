"""Step 6: the heard-alike audit. What does speech AI write down when an Indian medicine name is spoken?

1. Pick 300 single-word Indian brand names: the 150 most dangerous twin names + 150 random common names.
2. Speak them with two synthetic voices (Gemini TTS), 15 numbered names per clip.
3. Transcribe with Whisper large-v3 (Groq), the model family most voice products use.
4. Measure: how often the spelling comes back right, how often it lands on a *different real brand*,
   and whether (a) plain exact search or (b) Twinpill's matcher recovers the intended name.
Audio and transcripts are cached in data/processed/heard/ so reruns cost nothing.
"""
from __future__ import annotations

import base64
import json
import random
import re
import subprocess
import time
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from common import PROC, RESULTS, WEB_DATA
from match import Matcher

SEED = 11
VOICES = ["Kore", "Puck"]
TTS_MODEL = "gemini-3.8-flash-tts"
TTS_FALLBACKS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]
ASR_MODEL = "whisper-large-v3"
HEARD = PROC / "heard"
PER_CLIP = 15


def pick_names(roots: list[list]) -> list[str]:
    rng = random.Random(SEED)
    tw = pd.read_pickle(PROC / "twins.pkl")
    single = {r[0] for r in roots if " " not in r[0] and len(r[0]) >= 4}
    danger = (tw[tw.kind == "cross"].sort_values("harm", ascending=False).drop_duplicates("root"))
    danger = [r for r in danger["root"] if r in single][:150]
    common = [r[0] for r in roots if r[0] in single and r[2] >= 5 and r[0] not in danger]
    return danger + rng.sample(common, 150)


def tts(text: str, voice: str) -> bytes:
    """Try each Gemini TTS model in turn; free-tier quotas are per model."""
    err = None
    for model in TTS_FALLBACKS:
        try:
            return _tts(text, voice, model)
        except Exception as e:  # 429 on one model -> next model
            err = e
    raise err


def _tts(text: str, voice: str, model: str) -> bytes:
    body = {"contents": [{"parts": [{"text": text}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": "proxy"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    return base64.b64decode(d["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])


def asr(path) -> str:
    out = subprocess.run(["curl", "-s", "https://api.groq.com/openai/v1/audio/transcriptions",
                          "-H", "Authorization: Bearer proxy", "-F", f"file=@{path}", "-F", f"model={ASR_MODEL}",
                          "-F", "language=en", "-F", "temperature=0", "-F", "response_format=json"],
                         capture_output=True, text=True, timeout=180).stdout
    return json.loads(out)["text"]


def run_clip(i: int, names: list[str], voice: str) -> dict:
    key = f"{voice}_{i:03d}"
    jpath = HEARD / f"{key}.json"
    if jpath.exists():
        return json.loads(jpath.read_text())
    script = " ".join(f"{k + 1}. {n.capitalize()}." for k, n in enumerate(names))
    wpath = HEARD / f"{key}.wav"
    for attempt in range(4):
        try:
            if not wpath.exists():
                pcm = tts(script, voice)
                with wave.open(str(wpath), "wb") as w:
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
            text = asr(wpath)
            rec = {"key": key, "voice": voice, "names": names, "script": script, "transcript": text}
            jpath.write_text(json.dumps(rec))
            return rec
        except Exception as e:  # rate limits: back off and retry
            print(key, "retry", attempt, e)
            time.sleep(8 * (attempt + 1))
    raise RuntimeError(key)


def split_transcript(text: str, n: int) -> list[str]:
    parts = re.split(r"(?:^|\s)(\d{1,2})[.)]?\s+", " " + text)
    got = {}
    for k in range(1, len(parts) - 1, 2):
        idx = int(parts[k])
        word = re.sub(r"[^A-Za-z\- ]", " ", parts[k + 1]).strip()
        if 1 <= idx <= n and idx not in got:
            got[idx] = word
    return [got.get(k, "") for k in range(1, n + 1)]


def main() -> None:
    HEARD.mkdir(parents=True, exist_ok=True)
    roots = json.loads((WEB_DATA / "roots.json").read_text())
    names = pick_names(roots)
    clips = [names[i:i + PER_CLIP] for i in range(0, len(names), PER_CLIP)]
    jobs = [(i, c, v) for v in VOICES for i, c in enumerate(clips)]
    with ThreadPoolExecutor(1) as ex:
        recs = list(ex.map(lambda j: run_clip(*j), jobs))

    m = Matcher(roots)
    exact = {r[0] for r in roots}
    rows = []
    for rec in recs:
        heard = split_transcript(rec["transcript"], len(rec["names"]))
        for name, h in zip(rec["names"], heard):
            hc = re.sub(r"[^a-z]", "", h.lower())
            found_plain = hc == name
            res_app = [d["root"] for d in m.find(h, 3, rerank=False)] if hc else []
            res_ours = [d["root"] for d in m.find(h, 3, rerank=True)] if hc else []
            rows.append({
                "name": name, "voice": rec["voice"], "danger_set": name in names[:150], "heard": h,
                "heard_clean": hc, "spelled_right": hc == name, "missing": not hc,
                "lands_on_other_brand": bool(hc) and hc != name and hc in exact,
                "plain_search_top1": found_plain,
                "jw_top1": bool(res_app) and res_app[0] == name, "jw_top3": name in res_app,
                "ours_top1": bool(res_ours) and res_ours[0] == name, "ours_top3": name in res_ours,
                "other_brand": hc if (hc and hc != name and hc in exact) else "",
            })
    df = pd.DataFrame(rows)
    df.to_csv(RESULTS / "heard_alike.csv", index=False)
    rate = lambda c, d=df: round(float(d[c].mean()), 4)  # noqa: E731
    summary = {
        "names": int(df["name"].nunique()), "utterances": int(len(df)), "voices": VOICES,
        "tts_model": TTS_MODEL, "asr_model": ASR_MODEL,
        "spelled_right": rate("spelled_right"), "missing_or_unparsed": rate("missing"),
        "lands_on_other_real_brand": rate("lands_on_other_brand"),
        "retrieval_top1": {"plain_exact_search": rate("plain_search_top1"), "fuzzy_jw_phonetic": rate("jw_top1"),
                           "twinpill": rate("ours_top1")},
        "retrieval_top3": {"fuzzy_jw_phonetic": rate("jw_top3"), "twinpill": rate("ours_top3")},
        "danger_set_spelled_right": rate("spelled_right", df[df.danger_set]),
        "examples_other_brand": df[df.lands_on_other_brand][["name", "heard_clean"]].drop_duplicates().head(25).values.tolist(),
    }
    (RESULTS / "heard_alike.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

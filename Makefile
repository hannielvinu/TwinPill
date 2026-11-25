PY ?= python3

.PHONY: all data model heard live evaluate test serve

all: data model evaluate test

data:            ## clean catalogue, map classes, find twins, export web data
	cd pipeline && $(PY) s1_products.py && $(PY) s2_classes.py && $(PY) s3_twins.py && $(PY) s4_export.py

model:           ## train + cross-validate the name-confusability model
	cd pipeline && $(PY) s5_confusability.py && cp ../data/processed/confusability_lr.json ../web/data/

heard:           ## heard-alike audit (needs Gemini TTS + Groq Whisper access; cached after first run)
	cd pipeline && $(PY) s6_heard_alike.py

live:            ## re-check the top twin names on a live online pharmacy (1mg), then publish
	node pipeline/s8_live_check.cjs data/processed/live_check_roots.json results/live_check_1mg.json && cd pipeline && $(PY) s9_live_export.py

evaluate:        ## collect all metrics + plots into results/ and the app's Evidence page
	cd pipeline && $(PY) s7_evaluate.py

test:
	$(PY) -m pytest -q tests
	node tests/test_search.mjs
	node tests/test_voice.mjs
	node tests/test_photo.mjs

serve:           ## run the app locally at http://localhost:8000
	cd web && $(PY) -m http.server 8000

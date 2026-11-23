PY ?= python3

.PHONY: all data model heard evaluate test serve

all: data model evaluate test

data:            ## clean catalogue, map classes, find twins, export web data
	cd pipeline && $(PY) s1_products.py && $(PY) s2_classes.py && $(PY) s3_twins.py && $(PY) s4_export.py

model:           ## train + cross-validate the name-confusability model
	cd pipeline && $(PY) s5_confusability.py && cp ../data/processed/confusability_lr.json ../web/data/

heard:           ## heard-alike audit (needs Gemini TTS + Groq Whisper access; cached after first run)
	cd pipeline && $(PY) s6_heard_alike.py

evaluate:        ## collect all metrics + plots into results/ and the app's Evidence page
	cd pipeline && $(PY) s7_evaluate.py

test:
	$(PY) -m pytest -q tests

serve:           ## run the app locally at http://localhost:8000
	cd web && $(PY) -m http.server 8000

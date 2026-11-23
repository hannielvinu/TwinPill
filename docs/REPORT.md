# Twinpill: measuring and catching medicine-name twins in India

**Technical report · Data Sprint 2.0 (Open Innovation) · Team ZeroBix**

## Abstract
One brand name in India can refer to medicines with no active ingredient in common. We cleaned a public catalogue of 253,973 Indian medicine listings into 242,924 products and found **3,633 brand names that different companies use for unrelated medicines**, plus 5,047 names that one company reuses for unrelated products through suffixes. 758 of these twin names involve a high-alert medicine.

We also measured a risk that had not been quantified before. When 300 Indian brand names were spoken to Whisper large-v3, it spelled only **48.8%** correctly, and **7.0%** of its transcripts were a *different real Indian brand*. A learned candidate ranker recovers the intended name 75.5% of the time at top-1 and 89.0% within the top 3, on a voice it never saw; exact search manages 48.8%. A confusability model trained on 440 real confused-name pairs (ISMP) reaches PR-AUC 0.848, against 0.802 for edit distance and 0.814 for a POCA-style score.

These pieces power Twinpill, an offline web app that lists every medicine a name could be and asks the single question that separates them.

## 1 Problem
Indian prescriptions are mostly handwritten lists of brand names, with no diagnosis or treatment protocol (Lancet Regional Health – Southeast Asia, 2024). There is no national database of pharmaceutical brand names, and published cases include Medzole (four companies, four drugs) and Linamac (lenalidomide and linagliptin). The Drugs Technical Advisory Board recommended prohibiting different drugs under one brand name in January 2024. CDSCO's consultation of 6 July 2026 asks about brand-name extensions, which commentators note does not cover look-alike or sound-alike names.

**Objective:** for any name a person types, says or photographs, show every medicine it could be and how to tell them apart.

**Success criteria:**
1. Find every same-name clash in the catalogue.
2. Recover the intended name from a mistyped or misheard one better than plain search.
3. Settle most clashes with one printed-on-the-strip question.
4. Answer in under 100 ms on a phone, offline, with no data leaving the device.

## 2 Data and preprocessing
| Step | Rows |
|---|---|
| Raw listings | 253,973 |
| Not discontinued | 246,068 |
| Duplicates (name, maker, composition) removed | 243,852 |
| Brand key under 3 letters dropped | 242,924 |

- **Brand key:** the name a person would say. This is the first word, or the first two words when the first is an everyday English word (word-frequency Zipf ≥ 3, e.g. "New Triglucored") or 3 letters or fewer. Without this step, generic prefixes such as "New", "Mega" and "All" created false twins.
- **Parsing:** strength (first numeric group with unit, e.g. `650mg`, `37.5mg/325mg`), dosage form (50 patterns, longest first), route group (oral, eye, ear, skin, injection…) and suffix letters (e.g. `DSR`, `SR`, `MR`).
- **Ingredients:** strengths removed, lower-cased, and synonyms unified (acetaminophen→paracetamol, amoxycillin→amoxicillin…). The source lists at most two ingredients per product.
- **Classes:** 1,643 ingredients are matched to WHO ATC codes using Wikidata labels and aliases, with salt-word stripping and a curated list for 40 common gaps. That covers 1,312 ingredients and 98.9% of products. ATC level-3 groups are mapped to plain English and Tamil ("fits (epilepsy)" / "வலிப்பு நோய்"). A 49-molecule high-alert list follows ISMP-style categories.

## 3 Method
### 3.1 Twin detection and harm
Within each brand key we take one representative per (maker, ingredient set, form, strength). Any two representatives with disjoint ingredient sets form a **twin pair**: *cross* when the makers differ, *family* when they are the same. The harm score (0–100) adds:

| Condition | Points |
|---|---|
| Different ATC-3 purpose | +35 |
| Different ATC-1 body system | +15 |
| High-alert medicine on either side | +30 |
| Same route | +10 |
| Same form | +5 |
| Same printed strength | +5 |

The *only clue* is the form if the forms differ, otherwise the strength if both are printed and differ, otherwise the company.

### 3.2 Indian-English phonetic key
Ordered rewrite rules: ph→f, gh/kh/bh/dh/th→g/k/b/d/t, ck/q→k, x→ks, soft c→s, hard c→k, z/j→s, w→v, y→i, ee→i, oo/ou→u. Double letters collapse, silent h is dropped and vowels after the first sound are removed. The Python and JavaScript versions are tested for identical output.

### 3.3 Confusability model
- **Positives:** 440 single-name pairs from the ISMP List of Confused Drug Names (June 2024). Extension pairs such as "X / X XR" are removed, since §3.1 already covers them.
- **Negatives:** 3 never-reported pairs per positive from the same name list; two of the three share the first letter.
- **Features (21):** Levenshtein, Damerau, Jaro-Winkler and Indel similarity; bigram and trigram Dice; common prefix and suffix; length difference and mean; first and last letter equal; our phonetic key (equal and similarity); Soundex; Metaphone (equal and similarity); NYSIIS; a handwriting-glyph-collapsed similarity (rn→m, cl→d, l→i…); vowel skeleton; consonant similarity.
- **Validation:** 5-fold GroupKFold over connected name clusters, so no test name appears in training.

| Method | ROC-AUC | PR-AUC (95% CI) | Recall @ 90% precision |
|---|---|---|---|
| Edit distance | 0.906 | 0.802 (0.768–0.833) | 43.6% |
| POCA-style (mean of spelling and Metaphone similarity) | 0.912 | 0.814 (0.780–0.846) | 37.1% |
| LightGBM, 21 features | 0.922 | 0.838 (0.810–0.868) | 49.1% |
| **Logistic regression, 21 features (chosen)** | **0.929** | **0.848 (0.815–0.876)** | **57.5%** |

Logistic regression was chosen because it won out-of-fold, is transparent, and runs in the browser.

### 3.4 Heard-alike audit and learned ranker
- **Names:** the 150 highest-harm single-word cross-company twin names, plus 150 random names with five or more products.
- **Speech:** the names were spoken as numbered lists of 15 by two Gemini TTS voices (Kore, Puck), then transcribed with Whisper large-v3 at temperature 0, English. Audio and transcripts are cached and committed.
- **Ranker:** candidates are every brand key within 3 letters of length, sharing the first letter or the phonetic key, with Jaro-Winkler ≥ 0.80 or the same phonetic key. Eight features: Jaro-Winkler, same sound, phonetic-key similarity, spelling similarity, log product count, multi-word key, same first letter and length difference. Logistic regression is trained on one voice and tested on the other; an exact catalogue match is always listed first.

| Result | Value |
|---|---|
| Names spelled exactly right by Whisper large-v3 | 48.8% |
| Transcript is a different real Indian brand | 7.0% |
| Exact search, top-1 | 48.8% |
| Hand-set fuzzy rule, top-1 / top-3 | 65.8% / 76.2% |
| **Learned ranker, top-1 / top-3 (cross-voice)** | **75.5% / 89.0%** |

### 3.5 The deciding question
For the unrelated meanings of a name, the app asks about the first attribute whose values do not overlap: form, then printed number, then suffix letters, then company. Across all 8,050 twin names, 2,241 are settled by form, 956 by number and 3,065 by suffix, so **77.8% are settled without the company name**.

## 4 System
Static site (HTML, CSS, ES modules) on GitHub Pages:
- **Data:** brand keys (121,382) in one JSON file, with product details in 621 shards loaded on demand.
- **Voice:** Whisper base.en (q8) runs in the browser via Transformers.js.
- **Photo:** Tesseract.js reads the photo, and every word found is looked up.
- **Language:** English and Tamil interface, plus read-aloud.

There is no server and no analytics; prescriptions never leave the device. End-to-end Playwright checks pass 7 of 7 (Acetam, Olip, Adnil, Biopam, Dolo, the misspelling "acetum", and a single-meaning control, Crocin), with a median warm lookup of 46 ms (p95 66 ms).

## 5 Limitations and future work
- **Old snapshot:** the catalogue dates from around 2021–22. Some products have since changed, and published cases such as Linamac and Medzole are not in it. A current catalogue would change the counts.
- **Two ingredients only:** the source lists at most two ingredients per product, so a third-ingredient overlap can be missed.
- **Synthetic speech:** the heard-alike voices are synthetic. Real speakers, including Tamil-accented ones, and recordings from real phones are the next validation set.
- **Unvalidated harm score:** it is a transparent rule; we plan to build a pharmacist-labelled set to calibrate it.
- **Confusability labels are US-based:** ISMP pairs reflect US names. An Indian-reported pair set would be better.
- **Next:** more Indian languages, a WhatsApp voice-note front end, and an API for e-pharmacies and hospital pharmacy systems.

## References
1. Neelakantan, Sharma, Kulkarni. Look-alike, sound-alike (LASA) drugs in India. *Lancet Regional Health – Southeast Asia* 26 (2024) 100425.
2. CDSCO, notice on brand-name extensions, 6 July 2026; coverage in Medical Dialogues and SpicyIP (July 2026).
3. ISMP List of Confused Drug Names, updated June 2024.
4. US FDA, Phonetic and Orthographic Computer Analysis (POCA) program.
5. Radford et al., Robust Speech Recognition via Large-Scale Weak Supervision (Whisper), 2022.
6. WHO Collaborating Centre for Drug Statistics Methodology, ATC classification; via Wikidata.

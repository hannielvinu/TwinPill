// Voice transcripts → brand: node tests/test_voice.mjs
// Typical ways Google's English recogniser writes Indian brand names, plus Tamil/Kannada script.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(web, u))) });
const s = await import("../web/js/search.js");
const { toLatin } = await import("../web/js/translit.js");
await s.loadRoots();
await s.loadCommonWords();
const CASES = [
  ["acetam 500", "acetam"], ["acid am", "acetam"], ["add nil", "adnil"], ["ad nil", "adnil"], ["oh lip", "olip"],
  ["bio pam", "biopam"], ["dollo 650", "dolo"], ["crow sin", "crocin"], ["zen tra", "zentra"], ["thyro norm", "thyronorm"],
  ["combi flam", "combiflam"], ["give me acetam 500 please", "acetam"], ["pan 40", "pan"],
  ["அசிட்டம் 500", "acetam"], ["குரோசின்", "crocin"], ["ಡೋಲೋ 650", "dolo"], ["ಅಡ್ನಿಲ್", "adnil"],
];
for (const [heard, want] of CASES) assert.equal(s.bestFromSpeech(toLatin(heard))?.root, want, heard);
assert.equal(s.bestFromSpeech("hello how are you"), null, "chit-chat is not a medicine");
console.log(`voice: ${CASES.length + 1} assertions passed`);

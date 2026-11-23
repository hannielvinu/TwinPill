// Node test for the browser search logic: node tests/test_search.mjs
import assert from "node:assert/strict";
import { parseQuery, meanings, isTwin, matchNumber, decidingQuestion, jaroWinkler } from "../web/js/search.js";

const P = (name, maker, strength, form, ings, use) => ({ name, maker, strength, form, route: form === "eye drop" ? "eye" : "oral", ings, use });

assert.deepEqual(parseQuery("Acetam 500mg tablet"), { name: "acetam", number: "500" });
assert.deepEqual(parseQuery("  OLIP "), { name: "olip", number: null });
assert.ok(jaroWinkler("acetam", "acetum") > 0.9);

const acetam = meanings([
  P("Acetam 650mg Tablet", "Monokem", "650mg", "tablet", ["paracetamol"], "pain and fever"),
  P("Acetam 500mg Tablet", "Ambreyo", "500mg", "tablet", ["levetiracetam"], "fits (epilepsy)"),
]);
assert.equal(isTwin(acetam), true);
assert.equal(matchNumber(acetam, "500").length, 1);
assert.equal(matchNumber(acetam, "500")[0].ings[0], "levetiracetam");
assert.equal(decidingQuestion(acetam).kind, "strength");

const olip = meanings([
  P("Olip 0.1% Eye Drop", "Synovia", "0.1%", "eye drop", ["olopatadine"], "eye allergy"),
  P("Olip 5mg Tablet", "PJ", "5mg", "tablet", ["olanzapine"], "mental illness"),
]);
assert.equal(decidingQuestion(olip).kind, "form");

const dolo = meanings([
  P("Dolo 650 Tablet", "Micro", "650", "tablet", ["paracetamol"], "pain and fever"),
  P("Dolo 500 Tablet", "Micro", "500", "tablet", ["paracetamol"], "pain and fever"),
]);
assert.equal(isTwin(dolo), false);
console.log("search.js: all assertions passed");

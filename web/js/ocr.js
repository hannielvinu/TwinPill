// On-device photo reading with PaddleOCR (PP-OCRv4, ONNX Runtime Web). Nothing is uploaded.
// Much stronger than Tesseract on Indian medicine packs: tested on 181 real pack photos (tests/test_photo.mjs).
import { loadRoots, loadIngredients, loadCommonWords, findRoots, confident, productsFor, meanings, jaroWinkler } from "./search.js";
import { interpretPack } from "./photo.js";

const BASE = new URL("../vendor/ocr/", import.meta.url).href;
let engine = null;

/** Load the reader once (about 30 MB, first time only; cached for offline use afterwards). */
export function warmOcr() {
  if (!engine) {
    engine = (async () => {
      const { Ocr, ort } = await import("../vendor/ocr/paddle.mjs");
      ort.env.wasm.wasmPaths = BASE;
      ort.env.wasm.numThreads = 1; // GitHub Pages is not cross-origin isolated
      return Ocr.create({ models: { detectionPath: BASE + "det.onnx", recognitionPath: BASE + "rec.onnx", dictionaryPath: BASE + "keys.txt" } });
    })();
    engine.catch(() => { engine = null; });
  }
  return engine;
}

/** Phone photos are 12 MP and often rotated by EXIF: draw upright, at most 1600 px. */
async function prepare(file, rotate = 0) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  const side = rotate % 180 !== 0;
  c.width = side ? h : w; c.height = side ? w : h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate((rotate * Math.PI) / 180);
  g.drawImage(bmp, -w / 2, -h / 2, w, h);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
  return URL.createObjectURL(blob);
}

async function readText(file, rotate) {
  const ocr = await warmOcr();
  const url = await prepare(file, rotate);
  try {
    const { texts } = await ocr.detect(url);
    return texts.map((x) => ({ t: x.text, h: Math.abs(x.box[3][1] - x.box[0][1]) }));
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Read a pack photo. Returns { root, number, kind, ings, group, groupBy, lines } (root null when no brand
 * could be confirmed). A photo taken sideways is retried turned by 90 degrees.
 */
export async function readPack(file, onStage) {
  await Promise.all([loadRoots(), loadCommonWords()]);
  const ingRows = await loadIngredients();
  const common = await loadCommonWords();
  const deps = { findRoots, confident, productsFor, meanings, jaroWinkler, common, ingNames: ingRows.filter((r) => r[3]).map((r) => r[0]) };
  onStage?.("load");
  await warmOcr();
  onStage?.("read");
  let best = null;
  for (const rot of [0, 90, 270]) {
    const lines = await readText(file, rot);
    const r = await interpretPack(lines, deps);
    if (!best || (r.root && !best.root) || (!best.root && r.ings.length > best.ings.length)) best = r;
    if (r.root) break;
    if (rot === 0 && lines.length >= 6 && r.ings.length) break; // upright text was read fine, there is just no brand on this side
  }
  return best;
}

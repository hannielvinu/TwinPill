// On-device speech-to-text with Whisper (base.en) via Transformers.js. Audio never leaves the browser.
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL = "Xenova/whisper-base.en";
let pipe = null;

async function getPipe(onMsg) {
  if (pipe) return pipe;
  const { pipeline } = await import(LIB);
  onMsg?.("Downloading speech model (about 80 MB, first time only)…");
  pipe = await pipeline("automatic-speech-recognition", MODEL, {
    dtype: "q8",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) onMsg?.(`Loading speech model… ${Math.round((100 * p.loaded) / p.total)}%`);
    },
  });
  return pipe;
}

async function toMono16k(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const audio = await ctx.decodeAudioData(buf);
  const data = audio.getChannelData(0);
  ctx.close();
  return data;
}

export async function transcribe(blob, onMsg) {
  const asr = await getPipe(onMsg);
  onMsg?.("Listening back…");
  const audio = await toMono16k(blob);
  const out = await asr(audio, { chunk_length_s: 10 });
  return String(out.text || "").replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
}

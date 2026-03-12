import express from "express";

const app = express();
app.use(express.json({ limit: "10mb" }));

const API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3001;

// Simple in-memory TTS cache (max 200 entries, 30 min TTL)
const ttsCache = new Map();
const TTS_CACHE_MAX = 200;
const TTS_CACHE_TTL = 30 * 60 * 1000;
function ttsCacheKey(text, voice) { return `${voice}:${text.trim().toLowerCase()}`; }
function ttsCacheGet(key) {
  const entry = ttsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTS_CACHE_TTL) { ttsCache.delete(key); return null; }
  return entry.buf;
}
function ttsCacheSet(key, buf) {
  if (ttsCache.size >= TTS_CACHE_MAX) { const first = ttsCache.keys().next().value; ttsCache.delete(first); }
  ttsCache.set(key, { buf, ts: Date.now() });
}

// ============================================================
// 1. Gemini Chat/Identify proxy
// ============================================================
app.post("/api/gemini", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const body = { ...req.body };
  const model = body._model || "gemini-2.5-flash-lite";
  delete body._model;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 2. Gemini TTS — text to natural speech
// ============================================================
app.post("/api/tts", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: "Missing text" });

  const voiceName = voice || "Kore";
  const cacheKey = ttsCacheKey(text, voiceName);
  const cached = ttsCacheGet(cacheKey);
  if (cached) {
    res.set({ "Content-Type": "audio/wav", "Content-Length": cached.length, "Cache-Control": "no-cache", "X-TTS-Cache": "hit" });
    return res.send(cached);
  }

  const model = "gemini-2.5-flash-preview-tts";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      return res.status(resp.status).json(err);
    }

    const data = await resp.json();
    const audioPart = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!audioPart || !audioPart.data) {
      return res.status(500).json({ error: "No audio in response" });
    }

    // Convert base64 PCM (16-bit, 24kHz, mono) to WAV
    const pcmBuffer = Buffer.from(audioPart.data, "base64");
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 16, 1);

    ttsCacheSet(cacheKey, wavBuffer);
    res.set({
      "Content-Type": "audio/wav",
      "Content-Length": wavBuffer.length,
      "Cache-Control": "no-cache",
      "X-TTS-Cache": "miss",
    });
    res.send(wavBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PCM to WAV helper
function pcmToWav(pcmData, sampleRate, bitsPerSample, numChannels) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);          // chunk size
  buffer.writeUInt16LE(1, 20);           // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(buffer, headerSize);

  return buffer;
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Gemini API proxy on :${PORT}`));

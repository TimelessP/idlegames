// tts-wrapper.js
// Placeholder wrapper for espeak-ng/flite WASM integration.
//
// Place a real WASM-based espeak wrapper (built with Emscripten) alongside this
// file in assets/vendor/tts/. The expected contract is:
//
//   window.TTS_WASM = {
//     // Speak text and return PCM Int16Array + sampleRate
//     speak: async function(text) -> { pcm: Int16Array, sampleRate: number }
//   }
//
// If no WASM runtime is provided, this file falls back to browser SpeechSynthesis
// if available, or rejects otherwise. It is intentionally small so the app can
// ship without embedding a large .wasm file until you're ready to add it.

(function(){
  if (window.TTS_WASM) return; // don't override

  async function speakWithBrowser(text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return reject(new Error('No browser TTS'));
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => resolve();
        u.onerror = (e) => reject(e);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) { reject(e); }
    });
  }

  // Very small JS fallback synth: generates Int16 PCM for simple robotic speech.
  // Not natural, but works offline without WASM. Produces short bursts per word.
  function synthToPcmInt16(text, sampleRate = 22050) {
    const words = (text || '').split(/\s+/).filter(Boolean);
    const wordDur = 0.16; // seconds per word (short, punchy)
    const totalDur = Math.max(0.5, words.length * wordDur);
    const len = Math.floor(totalDur * sampleRate);
    const out = new Int16Array(len);
    let pos = 0;
    const vowels = /[aeiouy]/i;
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const dur = wordDur; // per-word
      const samples = Math.floor(dur * sampleRate);
      // base frequency influenced by vowels and length
      const vcount = (word.match(vowels) || []).length;
      const base = 110 + (vcount * 30) + ((word.length % 5) * 10);
      for (let i = 0; i < samples && pos < len; i++, pos++) {
        const t = i / sampleRate;
        // simple voiced waveform: sum of two sines with slight detune
        const s = Math.sin(2 * Math.PI * base * t) * 0.6 + Math.sin(2 * Math.PI * (base * 1.98) * t) * 0.35;
        // amplitude envelope (quick attack, decay)
        const env = Math.min(1, i / (sampleRate * 0.01)) * Math.exp(-t * 3.0);
        out[pos] = Math.max(-32767, Math.min(32767, Math.floor(s * env * 16000)));
      }
      // small gap between words
      pos += Math.floor(0.02 * sampleRate);
    }
    return { pcm: out.subarray(0, pos), sampleRate };
  }

  window.TTS_WASM = {
    speak: async function(text) {
      // Prefer browser TTS if available
      try {
        await speakWithBrowser(text);
        return null;
      } catch (e) {
        // Fall back to tiny JS synth that returns Int16 PCM
        try {
          return synthToPcmInt16(text, 22050);
        } catch (err) {
          return null;
        }
      }
    }
  };
})();

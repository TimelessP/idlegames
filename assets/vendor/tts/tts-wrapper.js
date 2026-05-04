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
  let _espeakApi = null;
  let _espeakTried = false;
  let _espeakLoaderFound = false;
  let _lastEspeakError = null;
  const currentScriptSrc = document.currentScript?.src || new URL('./tts-wrapper.js', window.location.href).toString();
  const wrapperBaseUrl = new URL('./', currentScriptSrc);

  function utf8ByteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  function writeUtf8ToHeap(Module, text, ptr, maxBytes) {
    const bytes = new TextEncoder().encode(text);
    const writable = Math.max(0, maxBytes - 1);
    const count = Math.min(bytes.length, writable);
    Module.HEAPU8.set(bytes.subarray(0, count), ptr);
    Module.HEAPU8[ptr + count] = 0;
    return count;
  }

  function createEspeakApiFromModule(Module) {
    return {
      speak: async function(text) {
        if (!text) return { pcm: new Int16Array(0), sampleRate: 22050 };
        const len = utf8ByteLength(text) + 1;
        const ptr = Module._malloc(len);
        writeUtf8ToHeap(Module, text, ptr, len);
        const samples = Module._speak_text(ptr);
        Module._free(ptr);
        if (!samples || samples <= 0) {
          return {
            pcm: new Int16Array(0),
            sampleRate: Module._get_sample_rate ? Module._get_sample_rate() : 22050,
          };
        }
        const pcmPtr = Module._get_pcm_ptr();
        const pcm = new Int16Array(Module.HEAP16.buffer, pcmPtr, samples).slice();
        const sampleRate = Module._get_sample_rate ? Module._get_sample_rate() : 22050;
        return { pcm: pcm, sampleRate };
      }
    };
  }

  async function tryLoadEspeak() {
    if (_espeakTried) return _espeakApi;
    _espeakTried = true;
    try {
      // Prefer the top-level Emscripten build first. Older runs left an extra
      // nested bundle under assets/vendor/tts/assets/vendor/tts/assets/vendor/tts/,
      // but the current build writes the canonical loader pair at the top level
      // alongside espeak-loader.data.
      const loaderCandidates = [
        new URL('espeak-loader.js', wrapperBaseUrl).toString(),
        new URL('assets/vendor/tts/assets/vendor/tts/espeak-loader.js', wrapperBaseUrl).toString()
      ];
      const shimUrl = new URL('espeak-loader-shim.js', wrapperBaseUrl).toString();
      const loadScript = (src) => new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
      let loaderUrl = null;
      for (const candidate of loaderCandidates) {
        const head = await fetch(candidate, { method: 'HEAD' });
        if (head.ok) {
          loaderUrl = candidate;
          _espeakLoaderFound = true;
          break;
        }
      }
      if (!loaderUrl) return null;
      window.__ESPEAK_LOADER_BASE = loaderUrl.slice(0, loaderUrl.lastIndexOf('/') + 1);
      const loaderOk = await loadScript(loaderUrl);
      if (!loaderOk) return null;
      const moduleFactory = window.EspeakModule || window.ESPEAK_MODULE || null;
      if (typeof moduleFactory === 'function') {
        const Module = await moduleFactory({
          locateFile: function(path) {
            return window.__ESPEAK_LOADER_BASE + path;
          }
        });
        _lastEspeakError = null;
        _espeakApi = createEspeakApiFromModule(Module);
        window.ESPEAK_TTS = _espeakApi;
        return _espeakApi;
      }
      if (!window.ESPEAK_TTS) {
        const shimOk = await loadScript(shimUrl);
        if (!shimOk) return null;
      }
      if (window.ESPEAK_TTS_READY) {
        await window.ESPEAK_TTS_READY;
      }
      _espeakApi = window.ESPEAK_TTS || null;
      if (!_espeakApi) _lastEspeakError = new Error('ESPEAK_TTS was not created after loader init');
      return _espeakApi;
    } catch (e) {
      _lastEspeakError = e;
      return null;
    }
  }

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
    probe: async function() {
      const api = await tryLoadEspeak();
      return !!(api && typeof api.speak === 'function');
    },
    getState: function() {
      return {
        loaderFound: _espeakLoaderFound,
        espeakReady: !!(_espeakApi && typeof _espeakApi.speak === 'function'),
        lastError: _lastEspeakError ? String(_lastEspeakError) : null,
      };
    },
    speak: async function(text) {
      // Prefer browser TTS first when available.
      try {
        await speakWithBrowser(text);
        return null;
      } catch (e) {
        // Fall through to eSpeak/tone fallback.
      }

      // Try espeak WASM loader next (if present).
      try {
        const api = await tryLoadEspeak();
        if (api && typeof api.speak === 'function') {
          // espeak-loader should return { pcm: Int16Array|ArrayBuffer, sampleRate }
          const res = await api.speak(text);
          if (res && res.pcm) return { pcm: (res.pcm instanceof Int16Array) ? res.pcm : new Int16Array(res.pcm), sampleRate: res.sampleRate || 22050 };
        }
      } catch (e) {
        _lastEspeakError = e;
      }

      // Last resort: synthesize a tiny offline tone-based voice.
      try {
        return synthToPcmInt16(text, 22050);
      } catch (e) {
        console.warn('TTS routing failed across browser, eSpeak, and tone fallback', {
          loaderFound: _espeakLoaderFound,
          lastEspeakError: _lastEspeakError ? String(_lastEspeakError) : null,
          toneError: String(e),
        });
        return null;
      }
    }
  };
})();

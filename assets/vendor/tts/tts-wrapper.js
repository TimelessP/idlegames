(function () {
  if (window.TTS_WASM) return;

  let espeakApi = null;
  let espeakTried = false;
  let espeakLoaderFound = false;
  let lastEspeakError = null;

  let configuredMode = 'auto';
  let piperWorker = null;
  let piperLoadPromise = null;
  let lastPiperError = null;
  let piperRequestId = 0;
  const pendingPiperRequests = new Map();
  let piperWorkerState = { ready: false, speakerCount: 0 };
  const piperSpeechCache = new Map();

  const currentScriptSrc = document.currentScript?.src || new URL('./tts-wrapper.js', window.location.href).toString();
  const wrapperBaseUrl = new URL('./', currentScriptSrc);
  const piperVendorBaseUrl = new URL('../piper/', wrapperBaseUrl).toString();
  const piperOnnxBaseUrl = new URL('onnx/', piperVendorBaseUrl).toString();
  const piperPhonemizeBaseUrl = new URL('piper/', piperVendorBaseUrl).toString();
  const PIPER_REMOTE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
  const PIPER_MODEL_ID = 'en_GB-vctk-medium';
  const PIPER_CACHE_NAME = 'idlegames-piper-model-cache-v1';
  const PIPER_META_KEY = 'idlegames-piper-model-meta-v1';
  const PIPER_EVICT_IDLE_MS = 24 * 60 * 60 * 1000;
  const PIPER_SPEECH_CACHE_LIMIT = 18;

  function normalizeMode(mode) {
    const value = String(mode || 'auto').toLowerCase();
    return ['auto', 'browser', 'espeak', 'tones', 'piper', 'none'].includes(value) ? value : 'auto';
  }

  function utf8ByteLength(text) {
    return new TextEncoder().encode(text).length;
  }

  function writeUtf8ToHeap(module, text, ptr, maxBytes) {
    const bytes = new TextEncoder().encode(text);
    const writable = Math.max(0, maxBytes - 1);
    const count = Math.min(bytes.length, writable);
    module.HEAPU8.set(bytes.subarray(0, count), ptr);
    module.HEAPU8[ptr + count] = 0;
    return count;
  }

  function createEspeakApiFromModule(module) {
    return {
      speak: async function (text) {
        if (!text) return { pcm: new Int16Array(0), sampleRate: 22050 };
        const len = utf8ByteLength(text) + 1;
        const ptr = module._malloc(len);
        writeUtf8ToHeap(module, text, ptr, len);
        const samples = module._speak_text(ptr);
        module._free(ptr);
        if (!samples || samples <= 0) {
          return {
            pcm: new Int16Array(0),
            sampleRate: module._get_sample_rate ? module._get_sample_rate() : 22050,
          };
        }
        const pcmPtr = module._get_pcm_ptr();
        const pcm = new Int16Array(module.HEAP16.buffer, pcmPtr, samples).slice();
        const sampleRate = module._get_sample_rate ? module._get_sample_rate() : 22050;
        return { pcm, sampleRate };
      }
    };
  }

  async function tryLoadEspeak() {
    if (espeakTried) return espeakApi;
    espeakTried = true;
    try {
      const loaderCandidates = [
        new URL('espeak-loader.js', wrapperBaseUrl).toString(),
        new URL('assets/vendor/tts/assets/vendor/tts/espeak-loader.js', wrapperBaseUrl).toString(),
      ];
      const shimUrl = new URL('espeak-loader-shim.js', wrapperBaseUrl).toString();
      const loadScript = (src) => new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      });
      let loaderUrl = null;
      for (const candidate of loaderCandidates) {
        const head = await fetch(candidate, { method: 'HEAD' });
        if (head.ok) {
          loaderUrl = candidate;
          espeakLoaderFound = true;
          break;
        }
      }
      if (!loaderUrl) return null;
      window.__ESPEAK_LOADER_BASE = loaderUrl.slice(0, loaderUrl.lastIndexOf('/') + 1);
      const loaderOk = await loadScript(loaderUrl);
      if (!loaderOk) return null;
      const moduleFactory = window.EspeakModule || window.ESPEAK_MODULE || null;
      if (typeof moduleFactory === 'function') {
        const module = await moduleFactory({
          locateFile: function (path) {
            return window.__ESPEAK_LOADER_BASE + path;
          }
        });
        lastEspeakError = null;
        espeakApi = createEspeakApiFromModule(module);
        window.ESPEAK_TTS = espeakApi;
        return espeakApi;
      }
      if (!window.ESPEAK_TTS) {
        const shimOk = await loadScript(shimUrl);
        if (!shimOk) return null;
      }
      if (window.ESPEAK_TTS_READY) {
        await window.ESPEAK_TTS_READY;
      }
      espeakApi = window.ESPEAK_TTS || null;
      if (!espeakApi) lastEspeakError = new Error('ESPEAK_TTS was not created after loader init');
      return espeakApi;
    } catch (error) {
      lastEspeakError = error;
      return null;
    }
  }

  async function speakWithBrowser(text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        return reject(new Error('No browser TTS'));
      }
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = (event) => reject(event);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        reject(error);
      }
    });
  }

  function synthToPcmInt16(text, sampleRate = 22050) {
    const words = (text || '').split(/\s+/).filter(Boolean);
    const wordDur = 0.16;
    const totalDur = Math.max(0.5, words.length * wordDur);
    const len = Math.floor(totalDur * sampleRate);
    const out = new Int16Array(len);
    let pos = 0;
    const vowels = /[aeiouy]/i;
    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      const samples = Math.floor(wordDur * sampleRate);
      const vowelCount = (word.match(vowels) || []).length;
      const base = 110 + (vowelCount * 30) + ((word.length % 5) * 10);
      for (let i = 0; i < samples && pos < len; i++, pos++) {
        const t = i / sampleRate;
        const s = Math.sin(2 * Math.PI * base * t) * 0.6 + Math.sin(2 * Math.PI * (base * 1.98) * t) * 0.35;
        const env = Math.min(1, i / (sampleRate * 0.01)) * Math.exp(-t * 3.0);
        out[pos] = Math.max(-32767, Math.min(32767, Math.floor(s * env * 16000)));
      }
      pos += Math.floor(0.02 * sampleRate);
    }
    return { pcm: out.subarray(0, pos), sampleRate };
  }

  function piperModelPathFromVoiceId(voiceId) {
    const parts = voiceId.split('-');
    return `${parts[0].split('_')[0]}/${parts.join('/')}/${parts.join('-')}`;
  }

  function piperModelUrls() {
    const basePath = `${PIPER_REMOTE_BASE}${piperModelPathFromVoiceId(PIPER_MODEL_ID)}`;
    return [`${basePath}.onnx`, `${basePath}.onnx.json`];
  }

  function loadPiperMeta() {
    try {
      return JSON.parse(localStorage.getItem(PIPER_META_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function savePiperMeta(meta) {
    try {
      localStorage.setItem(PIPER_META_KEY, JSON.stringify(meta));
    } catch {
      // Ignore storage failures.
    }
  }

  function touchPiperMeta(patch) {
    const nextMeta = { ...loadPiperMeta(), ...patch };
    savePiperMeta(nextMeta);
    return nextMeta;
  }

  async function maybeEvictStalePiperAssets() {
    const meta = loadPiperMeta();
    if (configuredMode === 'piper') return false;
    const quietSince = Math.max(meta.lastUsedAt || 0, meta.lastModeSelectedAt || 0, meta.lastDownloadedAt || 0);
    if (!quietSince) return false;
    if (Date.now() - quietSince < PIPER_EVICT_IDLE_MS) return false;
    if (!('caches' in window)) return false;
    const cache = await caches.open(PIPER_CACHE_NAME);
    await Promise.all(piperModelUrls().map((url) => cache.delete(url)));
    touchPiperMeta({ lastDownloadedAt: 0, lastEvictedAt: Date.now() });
    piperSpeechCache.clear();
    if (piperWorker) {
      try {
        void postToPiperWorker('reset', {});
      } catch {
        // Ignore worker reset errors during eviction.
      }
    }
    piperWorkerState = { ready: false, speakerCount: 0 };
    return true;
  }

  function ensurePiperWorker() {
    if (piperWorker) return piperWorker;
    const workerUrl = new URL('piper-worker.js', wrapperBaseUrl);
    piperWorker = new Worker(workerUrl, { type: 'module', name: 'piper-tts' });
    piperWorker.onmessage = ({ data }) => {
      const pending = pendingPiperRequests.get(data?.id);
      if (!pending) return;
      pendingPiperRequests.delete(data.id);
      if (data?.state) {
        piperWorkerState = {
          ready: !!data.state.ready,
          speakerCount: Number(data.state.speakerCount) || 0,
        };
      }
      if (!data?.ok) {
        const error = new Error(data?.error || 'Unknown Piper worker error');
        lastPiperError = error;
        pending.reject(error);
        return;
      }
      pending.resolve(data.result || data.state || true);
    };
    piperWorker.onerror = (event) => {
      const error = new Error(event.message || 'Piper worker crashed');
      lastPiperError = error;
      for (const pending of pendingPiperRequests.values()) {
        pending.reject(error);
      }
      pendingPiperRequests.clear();
    };
    return piperWorker;
  }

  function postToPiperWorker(type, payload) {
    const worker = ensurePiperWorker();
    const id = ++piperRequestId;
    return new Promise((resolve, reject) => {
      pendingPiperRequests.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  async function tryLoadPiper() {
    if (piperWorkerState.ready) return true;
    if (piperLoadPromise) return piperLoadPromise;
    piperLoadPromise = (async () => {
      await maybeEvictStalePiperAssets();
      await postToPiperWorker('init', {
        piperOnnxBaseUrl,
        piperPhonemizeBaseUrl,
        remoteBase: PIPER_REMOTE_BASE,
        modelId: PIPER_MODEL_ID,
        numThreads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)),
      });
      lastPiperError = null;
      return true;
    })().catch((error) => {
      lastPiperError = error;
      return null;
    }).finally(() => {
      piperLoadPromise = null;
    });
    return piperLoadPromise;
  }

  function piperSpeechCacheKey(text, options = {}) {
    return JSON.stringify({
      text,
      tower: !!options.tower,
      voiceIdentity: options.voiceIdentity || null,
    });
  }

  function trimPiperSpeechCache() {
    while (piperSpeechCache.size > PIPER_SPEECH_CACHE_LIMIT) {
      const oldestKey = piperSpeechCache.keys().next().value;
      if (typeof oldestKey === 'undefined') break;
      piperSpeechCache.delete(oldestKey);
    }
  }

  async function generatePiperSpeech(text, options = {}) {
    const ready = await tryLoadPiper();
    if (!ready) {
      throw lastPiperError || new Error('Piper unavailable');
    }
    const response = await postToPiperWorker('generate', { text, options });
    touchPiperMeta({ lastUsedAt: Date.now(), lastModeSelectedAt: Date.now() });
    return {
      mode: response.mode || 'piper',
      speakerId: response.speakerId ?? 0,
      sampleRate: response.sampleRate || 22050,
      pcm: new Int16Array(response.pcmBuffer),
    };
  }

  function getPiperSpeech(text, options = {}) {
    const key = piperSpeechCacheKey(text, options);
    if (piperSpeechCache.has(key)) {
      const cached = piperSpeechCache.get(key);
      piperSpeechCache.delete(key);
      piperSpeechCache.set(key, cached);
      return cached;
    }
    const promise = generatePiperSpeech(text, options)
      .catch((error) => {
        if (piperSpeechCache.get(key) === promise) {
          piperSpeechCache.delete(key);
        }
        throw error;
      });
    piperSpeechCache.set(key, promise);
    trimPiperSpeechCache();
    return promise;
  }

  window.TTS_WASM = {
    configure: async function (options = {}) {
      configuredMode = normalizeMode(options.mode || configuredMode);
      if (configuredMode === 'piper') {
        touchPiperMeta({ lastModeSelectedAt: Date.now() });
        void tryLoadPiper();
        return true;
      }
      await maybeEvictStalePiperAssets();
      return true;
    },
    prepare: async function (text = '', options = {}) {
      const mode = normalizeMode(options.mode || configuredMode);
      if (mode !== 'piper') return false;
      if (!text) {
        void tryLoadPiper();
        return true;
      }
      void getPiperSpeech(text, options).catch((error) => {
        lastPiperError = error;
      });
      return true;
    },
    probe: async function () {
      const api = await tryLoadEspeak();
      return !!(api && typeof api.speak === 'function');
    },
    getState: function () {
      return {
        loaderFound: espeakLoaderFound,
        espeakReady: !!(espeakApi && typeof espeakApi.speak === 'function'),
        piperModelId: PIPER_MODEL_ID,
        piperSpeakerCount: piperWorkerState.speakerCount || 0,
        piperSelectedMode: configuredMode,
        piperCachedMeta: loadPiperMeta(),
        lastError: lastEspeakError ? String(lastEspeakError) : null,
        lastPiperError: lastPiperError ? String(lastPiperError) : null,
      };
    },
    speak: async function (text, options = {}) {
      const mode = normalizeMode(options.mode || configuredMode);
      if (mode === 'none') return { handled: true, mode: 'none' };

      const tryBrowser = async () => {
        await speakWithBrowser(text);
        return { handled: true, mode: 'browser' };
      };
      const tryEspeak = async () => {
        const api = await tryLoadEspeak();
        if (api && typeof api.speak === 'function') {
          const res = await api.speak(text);
          if (res && res.pcm) {
            return {
              pcm: (res.pcm instanceof Int16Array) ? res.pcm : new Int16Array(res.pcm),
              sampleRate: res.sampleRate || 22050,
              mode: 'espeak',
            };
          }
        }
        throw new Error('eSpeak unavailable');
      };
      const tryTones = async () => {
        const res = synthToPcmInt16(text, 22050);
        return { ...res, mode: 'tones' };
      };
      const tryPiper = async () => {
        return getPiperSpeech(text, options);
      };

      const routes = {
        auto: [tryBrowser, tryEspeak, tryTones],
        browser: [tryBrowser],
        espeak: [tryEspeak],
        tones: [tryTones],
        piper: [tryPiper],
      };
      const selectedRoute = routes[mode] || routes.auto;
      let lastError = null;
      for (const attempt of selectedRoute) {
        try {
          return await attempt();
        } catch (error) {
          lastError = error;
          if (attempt === tryEspeak) lastEspeakError = error;
          if (attempt === tryPiper) lastPiperError = error;
        }
      }
      if (mode === 'auto') {
        console.warn('TTS routing failed across browser, eSpeak, and tone fallback', {
          loaderFound: espeakLoaderFound,
          lastEspeakError: lastEspeakError ? String(lastEspeakError) : null,
          lastError: lastError ? String(lastError) : null,
        });
      }
      return null;
    }
  };
})();

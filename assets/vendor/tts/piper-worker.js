import {
  HuggingFaceVoiceProvider,
  OnnxWebGPURuntime,
  OnnxWebRuntime,
  PhonemizeWebRuntime,
  PiperWebEngine,
} from '../piper/piper-tts-web.js';

let piperEngine = null;
let piperVoiceMeta = null;
let piperProvider = null;
let piperLoadPromise = null;

const speechCache = new Map();
const SPEECH_CACHE_LIMIT = 18;

const config = {
  piperOnnxBaseUrl: '',
  piperPhonemizeBaseUrl: '',
  remoteBase: '',
  modelId: '',
  numThreads: 1,
};

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class PiperCacheProvider {
  constructor() {
    this.memo = new Map();
    this.objectUrls = new Set();
  }

  destroy() {
    for (const objectUrl of this.objectUrls) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrls.clear();
    this.memo.clear();
  }

  async fetch(url) {
    if (this.memo.has(url)) return this.memo.get(url);
    const value = await this.load(url);
    this.memo.set(url, value);
    return value;
  }

  async load(url) {
    const isJson = url.endsWith('.json');
    const isRemotePiperAsset = url.startsWith(config.remoteBase) && (url.endsWith('.onnx') || url.endsWith('.onnx.json') || url.endsWith('voices.json'));
    let response = null;
    if (isRemotePiperAsset && 'caches' in self) {
      const cache = await caches.open('idlegames-piper-model-cache-v1');
      response = await cache.match(url);
      if (!response) {
        response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Could not fetch: ${url}`);
        await cache.put(url, response.clone());
      }
    }
    if (!response) {
      response = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' });
      if (!response.ok) throw new Error(`Could not fetch: ${url}`);
    }
    if (isJson) return response.json();
    const objectUrl = URL.createObjectURL(await response.blob());
    this.objectUrls.add(objectUrl);
    return objectUrl;
  }
}

function clearSpeechCache() {
  speechCache.clear();
}

function trimSpeechCache() {
  while (speechCache.size > SPEECH_CACHE_LIMIT) {
    const oldestKey = speechCache.keys().next().value;
    if (typeof oldestKey === 'undefined') break;
    speechCache.delete(oldestKey);
  }
}

function getPiperSpeakerIds() {
  const map = piperVoiceMeta?.speaker_id_map || {};
  const ids = [...new Set(Object.values(map).map((value) => Number(value)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (ids.length) return ids;
  const count = Number(piperVoiceMeta?.num_speakers) || 0;
  return Array.from({ length: Math.max(0, count) }, (_, index) => index);
}

function piperSpeakerIdFor(options = {}) {
  const ids = getPiperSpeakerIds();
  if (!ids.length) return 0;
  if (!options.tower) return ids[0];
  if (ids.length === 1) return ids[0];
  const towerIds = ids.slice(1);
  const key = String(options.voiceIdentity || 'tower-default');
  return towerIds[hashString(key) % towerIds.length];
}

function speechCacheKey(text, options = {}) {
  return JSON.stringify({
    text,
    tower: !!options.tower,
    voiceIdentity: options.voiceIdentity || null,
  });
}

async function wavBlobToPcm(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const sampleRate = view.getUint32(24, true);
  let offset = 12;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkLength = view.getUint32(offset + 4, true);
    if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkLength;
      break;
    }
    offset += 8 + chunkLength + (chunkLength % 2);
  }
  if (dataOffset < 0 || dataLength <= 0) {
    throw new Error('Piper WAV output missing data chunk');
  }
  return {
    pcm: new Int16Array(buffer.slice(dataOffset, dataOffset + dataLength)),
    sampleRate,
  };
}

function currentState() {
  return {
    ready: !!piperEngine,
    speakerCount: Number(piperVoiceMeta?.num_speakers) || getPiperSpeakerIds().length,
    modelId: config.modelId,
  };
}

async function destroyEngine() {
  clearSpeechCache();
  if (piperProvider) piperProvider.destroy();
  if (piperEngine && typeof piperEngine.destroy === 'function') piperEngine.destroy();
  piperProvider = null;
  piperEngine = null;
  piperVoiceMeta = null;
  piperLoadPromise = null;
}

async function ensureEngine(initData = null) {
  if (initData) {
    config.piperOnnxBaseUrl = initData.piperOnnxBaseUrl || config.piperOnnxBaseUrl;
    config.piperPhonemizeBaseUrl = initData.piperPhonemizeBaseUrl || config.piperPhonemizeBaseUrl;
    config.remoteBase = initData.remoteBase || config.remoteBase;
    config.modelId = initData.modelId || config.modelId;
    config.numThreads = initData.numThreads || config.numThreads;
  }
  if (piperEngine) return piperEngine;
  if (piperLoadPromise) return piperLoadPromise;
  piperLoadPromise = (async () => {
    piperProvider = new PiperCacheProvider();
    const voiceProvider = new HuggingFaceVoiceProvider({
      provider: piperProvider,
      baseUrl: config.remoteBase,
    });
    try {
      const voices = await voiceProvider.list();
      piperVoiceMeta = voices ? (voices[config.modelId] || null) : null;
    } catch {
      piperVoiceMeta = null;
    }
    let onnxRuntime = null;
    if ('gpu' in navigator) {
      try {
        onnxRuntime = new OnnxWebGPURuntime({ basePath: config.piperOnnxBaseUrl, numThreads: 1 });
      } catch {
        onnxRuntime = null;
      }
    }
    if (!onnxRuntime) {
      if (!self.crossOriginIsolated) {
        throw new Error('Piper CPU fallback needs cross-origin isolation for threaded ONNX runtime assets');
      }
      onnxRuntime = new OnnxWebRuntime({
        basePath: config.piperOnnxBaseUrl,
        numThreads: Math.max(1, Math.min(4, config.numThreads || 1)),
      });
    }
    const phonemizeRuntime = new PhonemizeWebRuntime({
      provider: piperProvider,
      basePath: config.piperPhonemizeBaseUrl,
    });
    piperEngine = new PiperWebEngine({
      onnxRuntime,
      phonemizeRuntime,
      voiceProvider,
    });
    return piperEngine;
  })().finally(() => {
    piperLoadPromise = null;
  });
  return piperLoadPromise;
}

async function generateSpeech(text, options = {}) {
  const engine = await ensureEngine();
  const speakerId = piperSpeakerIdFor(options);
  const response = await engine.generate(text, config.modelId, speakerId);
  if (!response?.file) throw new Error('Piper returned no audio');
  const decoded = await wavBlobToPcm(response.file);
  return { ...decoded, mode: 'piper', speakerId };
}

function queueSpeech(text, options = {}) {
  const key = speechCacheKey(text, options);
  if (speechCache.has(key)) return speechCache.get(key);
  const promise = generateSpeech(text, options)
    .then((result) => {
      const cached = {
        mode: result.mode,
        speakerId: result.speakerId,
        sampleRate: result.sampleRate,
        pcm: result.pcm,
      };
      speechCache.set(key, Promise.resolve(cached));
      trimSpeechCache();
      return cached;
    })
    .catch((error) => {
      if (speechCache.get(key) === promise) {
        speechCache.delete(key);
      }
      throw error;
    });
  speechCache.set(key, promise);
  trimSpeechCache();
  return promise;
}

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data || {};
  const reply = (message) => self.postMessage({ id, ...message });
  try {
    switch (type) {
      case 'init': {
        await ensureEngine(payload || {});
        reply({ ok: true, state: currentState() });
        break;
      }
      case 'prepare': {
        if (payload?.text) {
          void queueSpeech(payload.text, payload.options || {});
        } else {
          void ensureEngine(payload?.initData || null);
        }
        reply({ ok: true, state: currentState() });
        break;
      }
      case 'generate': {
        const result = await queueSpeech(payload.text, payload.options || {});
        const pcm = result.pcm.slice();
        reply({
          ok: true,
          result: {
            mode: result.mode,
            speakerId: result.speakerId,
            sampleRate: result.sampleRate,
            pcmBuffer: pcm.buffer,
          },
          state: currentState(),
        });
        break;
      }
      case 'reset': {
        await destroyEngine();
        reply({ ok: true, state: currentState() });
        break;
      }
      default:
        throw new Error(`Unknown Piper worker message type: ${type}`);
    }
  } catch (error) {
    reply({ ok: false, error: String(error) });
  }
};
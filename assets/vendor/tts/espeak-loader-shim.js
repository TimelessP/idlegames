// espeak-loader-shim.js
// Wraps a standard Emscripten MODULARIZE build (EspeakModule) into
// window.ESPEAK_TTS.speak(text) => { pcm: Int16Array, sampleRate }

(function(){
  if (window.ESPEAK_TTS) return;
  if (typeof EspeakModule === 'undefined' && typeof window.EspeakModule === 'undefined') return;
  const ModuleFactory = window.EspeakModule || EspeakModule;
  const loaderBase = window.__ESPEAK_LOADER_BASE || '/assets/vendor/tts/';
  window.ESPEAK_TTS_READY = ModuleFactory({
    locateFile: function(path) {
      return loaderBase + path;
    }
  }).then(Module => {
    // Expose speak that calls _speak_text and reads _get_pcm_ptr / _get_sample_rate
    window.ESPEAK_TTS = {
      speak: async function(text) {
        if (!text) return { pcm: new Int16Array(0), sampleRate: 22050 };
        // allocate string
        const len = Module.lengthBytesUTF8(text) + 1;
        const ptr = Module._malloc(len);
        Module.stringToUTF8(text, ptr, len);
        // call speak_text (C wrapper) - returns sample count
        const samples = Module._speak_text(ptr);
        Module._free(ptr);
        if (!samples || samples <= 0) return { pcm: new Int16Array(0), sampleRate: Module._get_sample_rate ? Module._get_sample_rate() : 22050 };
        const pcmPtr = Module._get_pcm_ptr();
        const pcm = new Int16Array(Module.HEAP16.buffer, pcmPtr, samples).slice();
        const sr = Module._get_sample_rate ? Module._get_sample_rate() : 22050;
        return { pcm: pcm, sampleRate: sr };
      }
    };
    return window.ESPEAK_TTS;
  }).catch(() => null);
})();

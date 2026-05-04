espeak-ng WASM integration

Goal

Provide a small Emscripten-built wrapper for espeak-ng (or flite) that exposes a simple JS API your app can call to get raw PCM for offline TTS.

Placement

Drop the compiled artifacts into `assets/vendor/tts/` alongside this README:

- `espeak-loader.js` — the JS glue (EMCC-generated, MODULARIZE=1, EXPORT_NAME='EspeakModule' or similar)
- `espeak-loader.wasm` — the WebAssembly binary
- `espeak-loader.data` — the Emscripten preload bundle containing `espeak-ng-data`

The loader should, when evaluated, set one of the following globals:

- `window.ESPEAK_TTS` — an object with `async speak(text) => { pcm: Int16Array, sampleRate: number }`
- or `window.EspeakModule` — a Module instance exposing a `speak` method with the same contract

Example C wrapper (conceptual)

This is a minimal example showing how you might wrap espeak-ng's C API. It's illustrative — you will need to adapt paths and build flags for your environment.

```c
#include <emscripten/emscripten.h>
#include <espeak/speak_lib.h>
#include <stdlib.h>

EMSCRIPTEN_KEEPALIVE
int speak_text(const char* text, int* out_samples, int* out_samplerate) {
  // Initialize espeak, request PCM output to memory, call espeak_Synth,
  // collect samples into a malloc'd buffer and return pointer/length.
  // For brevity this function is left conceptual.
}
```

Build (high level)

1. Install and activate the Emscripten SDK (emsdk).

2. Build espeak-ng for Emscripten (static library). Rough outline:

```sh
git clone https://github.com/espeak-ng/espeak-ng.git
cd espeak-ng
# configure and build with emscripten toolchain (emcmake/emmake may be needed)
mkdir build && cd build
emcmake cmake .. -DESPEAK_BUILD_TESTS=OFF -DESPEAK_BUILD_SHARED=OFF
emmake make -j4
# resulting libespeak-ng.a and headers in build tree
```

3. Compile a small wrapper that links against espeak-ng and exports a C function that synthesizes to a buffer. Example (conceptual):

```sh
emcc -O2 espeak_wrapper.c -I../espeak-ng/include -L../espeak-ng/build -lespeak-ng \
  -s MODULARIZE=1 -s 'EXPORT_NAME="EspeakModule"' \
  -s EXPORTED_FUNCTIONS='["_speak_text","_malloc","_free"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -o espeak-loader.js
```

4. Build with `--preload-file ../espeak-ng-data@/espeak-ng-data` so voice data is bundled into `espeak-loader.data`, and initialize espeak with `espeak_Initialize(..., "/", ...)`.

5. Copy `espeak-loader.js`, `espeak-loader.wasm`, and `espeak-loader.data` into `assets/vendor/tts/`.

Loader contract

Your `espeak-loader.js` should, when loaded, set `window.ESPEAK_TTS` to an object with an async `speak(text)` method. That method must return an object `{ pcm: Int16Array, sampleRate: number }` suitable for the app to play via AudioContext (the code in `airmail.html` expects this shape).

If you prefer the raw Emscripten Module API (MODULARIZE=1), make sure to create a small shim that wraps `Module` into `window.ESPEAK_TTS` and exposes `speak()`.

Troubleshooting

- File paths: Ensure `espeak-loader.js` references the `.wasm` location correctly (relative paths are easiest: `espeak-loader.wasm` in the same folder).
- Size: espeak-ng + build artifacts may be several MB. Consider serving them only for installed PWA or lazily loading the loader on-demand.
- Voices: `espeak-ng` expects an `espeak-ng-data` directory. In the browser, the simplest working setup is to preload it into the Emscripten FS at `/espeak-ng-data` and pass `"/"` as the path to `espeak_Initialize`.

If you want, I can prepare a small `espeak-loader.js` shim that wraps a standard EMCC MODULARIZE build and demonstrates `window.ESPEAK_TTS.speak()` wiring — but I can't produce the compiled `*.wasm` binary here without building espeak-ng with Emscripten on your machine or CI.

#!/usr/bin/env bash
set -euo pipefail
# Build script for espeak-ng WASM using Emscripten.
# This script runs inside a Docker image with Emscripten SDK installed.
# It clones espeak-ng, builds it, then compiles a small C wrapper into
# espeak-loader.js + espeak-loader.wasm (MODULARIZE=1, EXPORT_NAME='EspeakModule').

ROOT=$(pwd)
ESPEAK_REPO=${ESPEAK_REPO:-https://github.com/espeak-ng/espeak-ng.git}
ESPEAK_TAG=${ESPEAK_TAG:-master}
BUILD_DIR=$ROOT/build-espeak
COMMON_CMAKE_FLAGS=(
  -DBUILD_SHARED_LIBS=OFF
  -DENABLE_TESTS=OFF
  -DCOMPILE_INTONATIONS=ON
  -DUSE_ASYNC=OFF
  -DUSE_LIBSONIC=OFF
  -DUSE_SPEECHPLAYER=OFF
  -DUSE_KLATT=OFF
)

if [ -d /out ]; then
  OUT_DIR=/out
else
  OUT_DIR=$ROOT/..
fi

LOGFILE="$OUT_DIR/build.log"
mkdir -p "$(dirname "$LOGFILE")"
exec > >(tee -a "$LOGFILE") 2>&1

echo "Build dir: $BUILD_DIR"

if [ -f /opt/emsdk/emsdk_env.sh ]; then
  # shellcheck disable=SC1091
  source /opt/emsdk/emsdk_env.sh
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

echo "Cloning espeak-ng..."
git clone --depth 1 --branch "$ESPEAK_TAG" "$ESPEAK_REPO" espeak-ng
cd espeak-ng

mkdir -p build-native && cd build-native
cmake .. "${COMMON_CMAKE_FLAGS[@]}"
make -j"$(nproc)"

cd ..
mkdir -p build && cd build
emcmake cmake .. \
  "${COMMON_CMAKE_FLAGS[@]}" \
  -DNativeBuild_DIR="$BUILD_DIR/espeak-ng/build-native/src"
emmake make -j"$(nproc)"

# Build a tiny C wrapper that invokes espeak and returns PCM via Emscripten heap
cat > ../espeak_wrapper.c <<'CWRAP'
#include <emscripten.h>
#include <espeak-ng/speak_lib.h>
#include <stdlib.h>
#include <string.h>

static unsigned int sample_rate = 22050;
static short *outbuf = NULL;
static size_t outlen = 0;
static int espeak_ready = 0;

static int espeak_synth_callback(short *wav, int numsamples, espeak_EVENT *events);

static int ensure_espeak_ready(void) {
  if (espeak_ready) return 1;
  sample_rate = (unsigned int)espeak_Initialize(AUDIO_OUTPUT_RETRIEVAL, 0, "/espeak-ng-data", 0);
  if (!sample_rate) return 0;
  espeak_SetSynthCallback(espeak_synth_callback);
  if (espeak_SetVoiceByName("en-gb") != EE_OK) {
    if (espeak_SetVoiceByName("en") != EE_OK) return 0;
  }
  espeak_SetParameter(espeakRATE, 175, 0);
  espeak_SetParameter(espeakPITCH, 45, 0);
  espeak_SetParameter(espeakRANGE, 55, 0);
  espeak_ready = 1;
  return 1;
}

static int espeak_synth_callback(short *wav, int numsamples, espeak_EVENT *events) {
  if (numsamples <= 0) return 0;
  size_t need = outlen + numsamples;
  outbuf = (short*)realloc(outbuf, need * sizeof(short));
  memcpy(outbuf + outlen, wav, numsamples * sizeof(short));
  outlen += numsamples;
  return 0;
}

EMSCRIPTEN_KEEPALIVE
int speak_text(const char* text) {
  if (!text) return 0;
  if (!ensure_espeak_ready()) return 0;
  outlen = 0;
  if (outbuf) { free(outbuf); outbuf = NULL; }
  espeak_Synth(text, strlen(text)+1, 0, POS_CHARACTER, 0, espeakCHARS_AUTO, NULL, NULL);
  espeak_Synchronize();
  // return pointer and length via heap; caller must copy
  return (int)outlen; // number of samples
}

EMSCRIPTEN_KEEPALIVE
short* get_pcm_ptr() {
  return outbuf;
}

EMSCRIPTEN_KEEPALIVE
int get_sample_rate() { return sample_rate; }
CWRAP

emcc ../espeak_wrapper.c \
  -I../src/include \
  -Isrc/libespeak-ng \
  -Lsrc/libespeak-ng \
  -Lsrc/ucd-tools \
  -lespeak-ng \
  -lucd \
  --preload-file ./espeak-ng-data@/espeak-ng-data \
  -s MODULARIZE=1 -s 'EXPORT_NAME="EspeakModule"' \
  -s EXPORTED_FUNCTIONS='["_speak_text","_get_pcm_ptr","_get_sample_rate","_malloc","_free"]' \
  -s FORCE_FILESYSTEM=1 \
  -s ALLOW_MEMORY_GROWTH=1 -O3 -o espeak-loader.js

mkdir -p "$OUT_DIR"
for artifact in espeak-loader.js espeak-loader.wasm espeak-loader.data; do
  if [ -f "$artifact" ]; then
    cp "$artifact" "$OUT_DIR/$artifact"
  fi
done

echo "Build complete. Artifacts and log are in: $OUT_DIR (see build.log)"


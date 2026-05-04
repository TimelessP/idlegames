espeak-ng WASM Build (Docker)

This folder contains a helper Dockerfile and `build.sh` that attempt to build
`espeak-ng` + a tiny C wrapper into a modularized Emscripten bundle. The build
is non-trivial and may require tweaking depending on espeak-ng changes and
Emscripten versions.

Quick steps (local):

1. Build the Docker image (from repository root):

```bash
cd assets/vendor/tts/espeak-build
docker build -t idlegames-espeak-build .
```

2. Run the build (outputs to `assets/vendor/tts/`):

```bash
# from repo root
docker run --rm -v "$PWD/assets/vendor/tts":/out -v "$PWD":/src idlegames-espeak-build
```

Notes
- The Docker image installs the Emscripten SDK and attempts to build espeak-ng
  and compile a thin wrapper. The process can be slow and requires sufficient
  RAM and disk space.
- The `build.sh` script is opinionated and may need adjustments for newer
  espeak-ng branches. If build fails, inspect container logs and try building
  interactively.

After successful build you should have `assets/vendor/tts/espeak-loader.js`
and `assets/vendor/tts/espeak-loader.wasm`. The `espeak-loader.js` will be a
MODULARIZE build that needs a tiny shim; see `espeak-loader-shim.js`.

FROM debian:12

# Install dependencies for building with Emscripten
RUN apt-get update && apt-get install -y --no-install-recommends \
  git build-essential cmake python3 curl wget ca-certificates nodejs npm \
  && rm -rf /var/lib/apt/lists/*

# Install emsdk (Emscripten SDK)
ENV EMSDK_DIR=/opt/emsdk
ENV EMSDK_VERSION=3.1.46
RUN git clone https://github.com/emscripten-core/emsdk.git $EMSDK_DIR \
  && cd $EMSDK_DIR && ./emsdk install ${EMSDK_VERSION} && ./emsdk activate ${EMSDK_VERSION}

ENV PATH="$EMSDK_DIR:/root/.emsdk:/root/.emsdk/emscripten/latest:$PATH"

RUN mkdir -p /tmp/espeak-work && chmod 1777 /tmp/espeak-work
WORKDIR /tmp/espeak-work

COPY build.sh /usr/local/bin/espeak-build
RUN chmod +x /usr/local/bin/espeak-build

ENTRYPOINT ["/usr/local/bin/espeak-build"]

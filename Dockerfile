FROM docker.io/cloudflare/sandbox:0.12.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates ripgrep curl \
  && rm -rf /var/lib/apt/lists/*

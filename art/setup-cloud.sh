#!/usr/bin/env bash
# Installs the art pipeline on a Linux x64 VM (cloud agents). Idempotent.
# Usage: bash art/setup-cloud.sh
set -euo pipefail

BLENDER_VERSION="5.2.2"
KTX_VERSION="4.4.2"
LOCAL="$HOME/.local"
mkdir -p "$LOCAL"

SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null; then SUDO="sudo"; fi

if command -v apt-get >/dev/null; then
  $SUDO apt-get update -qq || true
  $SUDO apt-get install -y -qq --no-install-recommends \
    curl xz-utils bzip2 ca-certificates \
    libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 \
    libsm6 libice6 libgl1 libegl1 libglu1-mesa libfontconfig1 libfreetype6 \
    fonts-dejavu-core fonts-liberation2 || true
fi

if [ ! -x "$LOCAL/blender/blender" ]; then
  echo "Installing Blender $BLENDER_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL "https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
    | tar -xJ -C "$tmp"
  rm -rf "$LOCAL/blender"
  mv "$tmp"/blender-*-linux-x64 "$LOCAL/blender"
  rm -rf "$tmp"
fi

if [ ! -x "$LOCAL/ktx/bin/toktx" ]; then
  echo "Installing KTX-Software $KTX_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Linux-x86_64.tar.bz2" \
    | tar -xj -C "$tmp"
  root="$(dirname "$(dirname "$(find "$tmp" -type f -name toktx | head -1)")")"
  rm -rf "$LOCAL/ktx"
  mv "$root" "$LOCAL/ktx"
  rm -rf "$tmp"
fi

cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci --no-audit --no-fund

python3 -c "import PIL, numpy" 2>/dev/null || python3 -m pip install --quiet --user pillow numpy || true

source art/env.sh
"$BLENDER" --version | head -1
toktx --version
"$BLENDER" -b --factory-startup -noaudio --python-expr \
  "import sys; sys.path.insert(0, '$ART_ROOT/lib'); from ddd import scene; print('Cycles device:', scene.use_gpu())" \
  2>/dev/null | grep "Cycles device"
echo "Pipeline ready. Run: source art/env.sh && blend <scene> --steps ..."

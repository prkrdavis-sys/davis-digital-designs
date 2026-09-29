# Source this before running pipeline scripts: `source art/env.sh`
# Paths can be overridden from the shell.

if [ "$(uname)" = "Darwin" ]; then
  export BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
else
  # Linux (cloud VMs): installed by art/setup-cloud.sh
  export BLENDER="${BLENDER:-$HOME/.local/blender/blender}"
fi
export KTX_HOME="${KTX_HOME:-$HOME/.local/ktx}"
export PATH="$KTX_HOME/bin:$PATH"
if [ "$(uname)" != "Darwin" ]; then
  export LD_LIBRARY_PATH="$KTX_HOME/lib:${LD_LIBRARY_PATH:-}"
fi

ART_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export ART_ROOT
export ART_CACHE="$ART_ROOT/.cache"
export ART_OUT="$ART_ROOT/out"
export WORLDS_PUBLIC="$(dirname "$ART_ROOT")/public/worlds"

mkdir -p "$ART_CACHE" "$ART_OUT" "$WORLDS_PUBLIC"

# Run a world build script headless. Usage: blend <scene> [args...]
blend() {
  local scene="$1"
  shift
  "$BLENDER" -b --factory-startup -noaudio \
    --python "$ART_ROOT/worlds/$scene/build.py" -- "$@"
}

#!/bin/bash
# Optional: builds the Parakeet V3 speech engine (transcribe.cpp by Handy, MIT license) and
# downloads its model, so "Parakeet V3" can be picked in the mic settings.
# Run the installed copy: ~/.claude/skills/enhance-prompt/engine/build-parakeet.sh
# Needs cmake (brew install cmake) and git. The model is a large download.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HOME/.claude/prompt-enhancer-engine"
mkdir -p "$WORK/models"
command -v cmake >/dev/null || { echo "Needs cmake: brew install cmake"; exit 1; }

if [ ! -d "$WORK/transcribe.cpp" ]; then
  git clone --depth 1 https://github.com/handy-computer/transcribe.cpp.git "$WORK/transcribe.cpp"
fi
cd "$WORK/transcribe.cpp"
cmake -B build -DCMAKE_BUILD_TYPE=Release -DTRANSCRIBE_BUILD_TESTS=OFF
cmake --build build --config Release -j
cp build/bin/transcribe-cli "$HERE/transcribe-cli"
cp LICENSE "$HERE/LICENSE-transcribe.cpp.txt"

MODEL="$WORK/models/parakeet-tdt-0.6b-v3-Q8_0.gguf"
if [ ! -f "$MODEL" ]; then
  echo "Downloading the Parakeet V3 model..."
  curl -L --fail -o "$MODEL.part" "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf"
  mv "$MODEL.part" "$MODEL"
fi
echo "Parakeet V3 is ready: pick it in the mic settings (hold the mic, then Settings)."
case "$HERE" in
  "$HOME/.claude/skills/enhance-prompt/engine") ;;
  *) echo "Note: this is not the installed copy. Run install.sh again to copy the engine over." ;;
esac

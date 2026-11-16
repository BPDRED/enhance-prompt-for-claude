#!/bin/bash
# Installs the /enhance-prompt skill for Claude Code on this Mac.
#   1. copies the skill to ~/.claude/skills/enhance-prompt
#   2. builds the small helper app (needs Apple's Command Line Tools: xcode-select --install)
#   3. writes the three agents it uses to ~/.claude/agents
# Your saved prompts (~/.claude/prompt-enhancer) are never touched.
set -euo pipefail
cd "$(dirname "$0")"

SKILL="$HOME/.claude/skills/enhance-prompt"
if pgrep -f "EnhancePrompt.app/Contents/MacOS/EnhancePrompt" >/dev/null 2>&1; then
  echo "An Enhance Prompt window is open. Close it (your draft is kept), then run this again."; exit 1
fi
command -v swiftc >/dev/null || { echo "Needs Apple's Command Line Tools. Run: xcode-select --install"; exit 1; }
command -v python3 >/dev/null || { echo "Needs python3 (it comes with the Command Line Tools)."; exit 1; }

# Keep a speech engine you already built (engine/transcribe-cli) when updating.
KEEP=""
if [ -x "$SKILL/engine/transcribe-cli" ]; then KEEP="$(mktemp -d)"; cp "$SKILL/engine/transcribe-cli" "$KEEP/"; fi

echo "Copying the skill to $SKILL"
rm -rf "$SKILL"
mkdir -p "$(dirname "$SKILL")"
cp -R skill "$SKILL"
if [ -n "$KEEP" ]; then cp "$KEEP/transcribe-cli" "$SKILL/engine/"; rm -rf "$KEEP"; fi

echo "Building the helper app (EnhancePrompt.app)..."
"$SKILL/app/build.sh"

echo "Writing the agents to ~/.claude/agents"
python3 "$SKILL/bin/make-agents.py"

echo
echo "Done. In Claude Code, type /enhance-prompt (add --opus to always use Opus)."
echo "Optional, better dictation (Parakeet V3): $SKILL/engine/build-parakeet.sh"

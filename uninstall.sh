#!/bin/bash
# Removes the /enhance-prompt skill, its helper app and its agents.
# Your saved prompts stay in ~/.claude/prompt-enhancer; delete that folder yourself if you want them gone.
set -euo pipefail
rm -rf "$HOME/.claude/skills/enhance-prompt"
rm -f "$HOME/.claude/agents/prompt-enhancer.md" "$HOME/.claude/agents/prompt-enhancer-opus-medium.md" "$HOME/.claude/agents/prompt-enhancer-opus-high.md"
echo "Removed the skill and its agents. Saved prompts are still in ~/.claude/prompt-enhancer."
echo "If you gave it Accessibility or Microphone access, you can remove 'Enhance Prompt' in System Settings > Privacy & Security."

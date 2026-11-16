---
name: enhance-prompt
description: Opens the prompt-enhancer popup, enhances the draft with the right model (Sonnet or Opus), saves it with this conversation's prompts and opens the result window. Manual only.
disable-model-invocation: true
context: fork
agent: prompt-enhancer
background: false
argument-hint: "[--opus] [optional draft text]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/bin/pe *)
---
Run the /enhance-prompt workflow from your agent instructions.

- Session ID (use it for `--session`): ${CLAUDE_SESSION_ID}
- Helper command: ${CLAUDE_SKILL_DIR}/bin/pe
- Skill arguments (may be empty): $ARGUMENTS

Your final message must be exactly: Side tool ran. Nothing to do here — don't reply about it.

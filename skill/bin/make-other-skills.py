#!/usr/bin/env python3
"""Installs /enhance-prompt for other AI coding tools, using each tool's own model:
  - Codex                 ~/.agents/skills/enhance-prompt/      (use: $enhance-prompt)
  - Gemini CLI            ~/.gemini/skills/enhance-prompt/      + /enhance-prompt command
  - Antigravity (app/CLI) ~/.gemini/config/skills/enhance-prompt/ (use: /enhance-prompt)
They all read the same Agent Skills format (SKILL.md). The popup, result window and saved prompts are
the same as in Claude Code. Run again after editing INSTRUCTIONS.md:
  python3 ~/.claude/skills/enhance-prompt/bin/make-other-skills.py
Remove with --remove."""
import os
import shutil
import sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PE = os.path.join(SKILL, 'bin', 'pe')
INSTR = open(os.path.join(SKILL, 'INSTRUCTIONS.md'), encoding='utf-8').read().strip()
HOME = os.path.expanduser('~')

TARGETS = {
    'Codex': os.path.join(HOME, '.agents', 'skills', 'enhance-prompt'),
    'Gemini CLI': os.path.join(HOME, '.gemini', 'skills', 'enhance-prompt'),
    'Antigravity': os.path.join(HOME, '.gemini', 'config', 'skills', 'enhance-prompt'),
}
GEMINI_CMD = os.path.join(HOME, '.gemini', 'commands', 'enhance-prompt.toml')

SKILL_MD = '''---
name: enhance-prompt
description: Opens the Enhance Prompt popup on this Mac so the user can write or dictate a draft prompt (with images), then rewrites the draft into an expert-quality prompt and shows it in the result window. Use ONLY when the user explicitly asks for enhance-prompt / to enhance a prompt with the popup.
---
# Enhance Prompt

The user writes the draft in a popup window and reads the result in a result window; they do not read
your chat messages. Work quietly and follow these steps exactly. Use your shell / terminal tool for the
commands. They touch only `~/.claude/prompt-enhancer` and open the app's windows, so approve or allow
them if your tool asks.

## 1. Open the popup and wait for the draft

Run this command (it waits while the user writes; it returns within about 2 minutes):

```
"{pe}" start --wait-seconds 100 --session "$(basename "$PWD")-$(date +%Y-%m-%d)"
```

If the user gave draft text with the request, add `--prefill '<their text>'` (quoted safely in single quotes).

Read the `STATUS:` line of the output:
- `STATUS: STILL_OPEN` - the user is still writing (there is no time limit). Run the `pe wait --job ...`
  command it prints, exactly as printed, and read its status the same way.
  Repeat for as long as it says STILL_OPEN.
- `STATUS: CANCELLED`, `STATUS: ALREADY_OPEN` or `STATUS: ERROR` - say so in one short line and stop.
- `STATUS: OK` - continue. The output lists `JOB`, `REQUEST`, `DRAFT_FILE`, maybe `REVISE_BASE_FILE`
  and `IMAGES` (image files, numbered as the user sees them).

## 2. Read the inputs

Read `DRAFT_FILE`, and `REVISE_BASE_FILE` if it is listed. If images are listed and you can view image
files, look at them; a marked-up image shows what the user drew on it. (The WC / conversation option of the
popup only works in Claude Code; ignore it here.)

## 3. Enhance the draft

{instr}

## 4. Save the result

Save your sections with ONE shell command. Use the exact JOB path from step 1, your own model name for
`--model` (for example `gpt-5.5` or `gemini-3-pro`) and your reasoning effort for `--effort`
(or `default`):

```
"{pe}" finish --job "<JOB>" --model "<your model>" --effort "<effort>" <<'PE_END_OF_RESULT'
===ENHANCED===
...
===CHANGES===
- ...
===GAPS===
- ...
===END===
PE_END_OF_RESULT
```

This saves the prompt and opens the result window for the user. If something goes wrong, run
`"{pe}" fail --job "<JOB>" --error "<short reason>"` instead.

## 5. Finish

Reply with one short line only, for example: `Enhanced prompt opened in the result window.`
'''

# Codex: manual only (explicit $enhance-prompt still works).
OPENAI_YAML = '''policy:
  allow_implicit_invocation: false
'''

GEMINI_TOML = '''description = "Open the Enhance Prompt popup and enhance the draft with this model"
prompt = """
Use the enhance-prompt skill now: follow {skill_md} exactly.
Draft text given with the command (may be empty): {{{{args}}}}
"""
'''


def main():
    remove = '--remove' in sys.argv
    for tool, d in TARGETS.items():
        if remove:
            shutil.rmtree(d, ignore_errors=True)
            print('removed', d)
            continue
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'SKILL.md'), 'w', encoding='utf-8') as f:
            f.write(SKILL_MD.format(pe=PE, instr=INSTR))
        if tool == 'Codex':
            os.makedirs(os.path.join(d, 'agents'), exist_ok=True)
            with open(os.path.join(d, 'agents', 'openai.yaml'), 'w', encoding='utf-8') as f:
                f.write(OPENAI_YAML)
        print('wrote', os.path.join(d, 'SKILL.md'), '(' + tool + ')')
    if remove:
        if os.path.exists(GEMINI_CMD):
            os.remove(GEMINI_CMD)
            print('removed', GEMINI_CMD)
        return
    os.makedirs(os.path.dirname(GEMINI_CMD), exist_ok=True)
    with open(GEMINI_CMD, 'w', encoding='utf-8') as f:
        f.write(GEMINI_TOML.format(skill_md=os.path.join(TARGETS['Gemini CLI'], 'SKILL.md')))
    print('wrote', GEMINI_CMD, '(Gemini CLI: /enhance-prompt)')


if __name__ == '__main__':
    main()

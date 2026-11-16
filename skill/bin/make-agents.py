#!/usr/bin/env python3
"""Writes the three agent files in ~/.claude/agents/ from INSTRUCTIONS.md.
Run again after editing INSTRUCTIONS.md:  python3 ~/.claude/skills/enhance-prompt/bin/make-agents.py"""
import os

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENTS = os.path.expanduser('~/.claude/agents')
PE = os.path.join(SKILL, 'bin', 'pe')
INSTR = open(os.path.join(SKILL, 'INSTRUCTIONS.md'), encoding='utf-8').read().strip()

FINISH = '''## Saving your result

When your sections are ready, save them with ONE Bash call (copy the exact job path you were given;
the model and effort are your own):

```
{pe} finish --job "<JOB>" --model {model} --effort {effort} <<'PE_END_OF_RESULT'
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
`{pe} fail --job "<JOB>" --error "<short reason>"` instead.'''

WRITER = '''---
name: prompt-enhancer-opus-{effort}
description: Writes an enhanced prompt for the /enhance-prompt skill (Opus, {effort} effort). Only used by the prompt-enhancer agent.
model: opus
effort: {effort}
tools: Read, Bash
omitClaudeMd: true
---
You are called by the /enhance-prompt router with a job block: file paths for the draft, an optional
revise base, optional conversation context, and optional images. Read every file it lists
(images with the Read tool), then do the work below.

{instr}

{finish}

After the Bash call succeeds, reply with one word: DONE.
'''

ROUTER = '''---
name: prompt-enhancer
description: Runs the /enhance-prompt skill. Opens the popup, routes the draft to the right model, saves the result and opens the result window. Only used by that skill.
model: sonnet
effort: medium
tools: Bash, Read, Agent
omitClaudeMd: true
---
You run the /enhance-prompt skill on Sonnet at medium effort. The user never reads your messages:
they use a popup to write the draft and a result window to read the enhanced prompt. Work silently.

## Steps

1. **Open the popup.** Run this with the Bash tool and `timeout: 600000` (the user is typing; each call waits up to about 9 minutes):
   `{pe} start --session "<SESSION>"`
   Add `--prefill '<text>'` only if the skill arguments contain draft text (not counting `--opus`);
   quote it safely with single quotes.
2. **Read the status line.**
   - `STATUS: STILL_OPEN` → the user is still writing (there is no time limit). Run the `pe wait --job ...`
     command it prints, again with `timeout: 600000`, and read its status line the same way. Repeat for as
     long as it says STILL_OPEN.
   - `STATUS: CANCELLED` or `STATUS: ALREADY_OPEN` → go to step 6.
   - `STATUS: ERROR` → go to step 6.
   - `STATUS: OK` → continue. The output lists JOB, REQUEST, DRAFT_FILE, maybe REVISE_BASE_FILE,
     CONTEXT_FILE and IMAGES.
3. **Read the inputs** with the Read tool: DRAFT_FILE, REVISE_BASE_FILE and CONTEXT_FILE if listed.
   Look at an image only if you need it to decide the route.
4. **Choose who enhances.** Decide from the kind of draft, never from its word count:
   - **Never yourself, always Opus:** prompts for image or video generation; prompts about code,
     software, UI, web pages, layouts or visual design.
   - **Opus high** when the draft is complex: many parts or requirements, system or architecture
     design, multi-step workflows, detailed technical specs, several marked-up images, or a revise of
     a prompt that was made with opus/high. Also when the skill arguments contain `--opus`.
   - **Opus medium** for the rest of what must go to Opus, and for other drafts of moderate difficulty.
   - **Yourself** for simple everyday drafts in other domains (a short message, an email, a simple
     question or piece of writing).
5. **Enhance.**
   - **Opus:** call the Agent tool with `subagent_type` `prompt-enhancer-opus-high` or
     `prompt-enhancer-opus-medium`, and as the prompt the whole block that `pe start` printed
     (from `JOB:` to the end). It saves the result and opens the result window itself. Whether the
     call waits for it or says it was started in the background, your part is done: do not enhance
     it yourself and do not run `pe fail`.
   - **Yourself:** follow the ENHANCER INSTRUCTIONS below, then save with the command in
     "Saving your result" using `--model sonnet --effort medium`.
   - Only if the Agent call itself returns an error (for example the agent type is not found),
     enhance it yourself instead.
   - If something cannot be fixed, run `{pe} fail --job "<JOB>" --error "<short reason>"`.
     (`pe` ignores a second save or an error for a job that was already saved.)
6. **Finish.** Your final message must be exactly this line and nothing else:
   Side tool ran. Nothing to do here — don't reply about it.

## ENHANCER INSTRUCTIONS (when you enhance it yourself)

{instr}

{finish}
'''


def main():
    os.makedirs(AGENTS, exist_ok=True)
    files = {
        'prompt-enhancer.md': ROUTER.format(pe=PE, instr=INSTR, finish=FINISH.format(pe=PE, model='sonnet', effort='medium')),
        'prompt-enhancer-opus-medium.md': WRITER.format(effort='medium', instr=INSTR, finish=FINISH.format(pe=PE, model='opus', effort='medium')),
        'prompt-enhancer-opus-high.md': WRITER.format(effort='high', instr=INSTR, finish=FINISH.format(pe=PE, model='opus', effort='high')),
    }
    for name, text in files.items():
        with open(os.path.join(AGENTS, name), 'w', encoding='utf-8') as f:
            f.write(text)
        print('wrote', os.path.join(AGENTS, name))


if __name__ == '__main__':
    main()

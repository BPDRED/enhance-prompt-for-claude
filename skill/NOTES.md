# /enhance-prompt — how it is built

- `SKILL.md`: manual-only skill, runs forked in the `prompt-enhancer` agent (Sonnet, medium).
- `~/.claude/agents/prompt-enhancer*.md`: router + Opus medium/high writers. Generated from
  `INSTRUCTIONS.md` by `bin/make-agents.py` — edit INSTRUCTIONS.md, then rerun that script.
- `bin/pe` (→ `bin/pe.py`): `start` opens the popup and waits; `finish` saves the result (reads the
  ===ENHANCED=== / ===CHANGES=== / ===GAPS=== sections on stdin) and opens the result window; `fail`
  shows an error in the result window; `show` reopens a saved prompt; `cleanup` (also run by start)
  deletes thread folders unused for 30 days.
- `app/main.swift` → `build/EnhancePrompt.app` (rebuilt automatically when main.swift changes, or run
  `app/build.sh`). One small program, two windows: `popup` and `result`. Nothing runs between uses.
- `ui/`: the pages (ported from the design boards). `dclite.js` renders the board template format.
  Test in a browser with `?mock` (python3 -m http.server in ui/, open popup.html?mock or result.html?mock).
- Data: `~/.claude/prompt-enhancer/<date>_<session>/prompt-NN.json` (versions inside) + `img/`.
  Draft of a closed popup: `draft/`. Edits in the result window overwrite the version's `text`
  (the model's text stays in `model_text`).
- App test hooks: `--test-js FILE`, `--snapshot PNG --snapshot-quit`; `PE_TEST_JS` and `PE_NO_OPEN`
  env vars for `pe`.
- Auto-paste needs Accessibility for "Enhance Prompt" (System Settings › Privacy & Security ›
  Accessibility). A rebuild changes the app's signature, so the permission may need to be given again.

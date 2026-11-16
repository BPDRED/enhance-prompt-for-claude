# Use Enhance Prompt in Codex, Antigravity and Gemini CLI

The same popup, result window and saved prompts work in other AI coding tools. The draft is
enhanced by **that tool's own model** (for example GPT in Codex, Gemini in Antigravity), with the
same rules as in Claude Code (`INSTRUCTIONS.md`).

All three tools read the open **Agent Skills** format (a folder with a `SKILL.md`), so one command
sets them all up.

| Tool | How you run it | Tested |
| --- | --- | --- |
| **Codex** (CLI, app, IDE extension) | `$enhance-prompt` (or pick it in `/skills`) | Yes, Codex CLI 0.145 (see note) |
| **Antigravity** (app and `agy` CLI) | `/enhance-prompt` | Yes, `agy` 1.5.9, with its terminal sandbox off |
| **Gemini CLI** | `/enhance-prompt` | Not yet (not installed on the test Mac) |

## 1. Install (once, for all tools)

1. Install Enhance Prompt itself first (see the main [README](../README.md#install)): `./install.sh`.
   You don't need Claude Code to use it from the other tools; the installer only puts the files in place.
2. Add the skill to the other tools:

   ```bash
   python3 ~/.claude/skills/enhance-prompt/bin/make-other-skills.py
   ```

   It writes:

   | Tool | Folder |
   | --- | --- |
   | Codex | `~/.agents/skills/enhance-prompt/` (manual only: Codex never runs it by itself) |
   | Gemini CLI | `~/.gemini/skills/enhance-prompt/` and the `/enhance-prompt` command in `~/.gemini/commands/` |
   | Antigravity | `~/.gemini/config/skills/enhance-prompt/` |

3. Restart the tool (or open a new session) so it sees the new skill.

Run the same command again after you edit `INSTRUCTIONS.md` or update Enhance Prompt.
To remove the skill from the other tools: `python3 ~/.claude/skills/enhance-prompt/bin/make-other-skills.py --remove`.

## 2. Codex

**Use it:** in a Codex session, type `$enhance-prompt` (you can add a draft after it), or open `/skills`
and pick **enhance-prompt**. The popup opens; write or dictate your draft and press ⌘↵. Codex enhances
it and the result window opens.

**Approval:** the skill runs a helper command that opens the popup app and saves to
`~/.claude/prompt-enhancer`, which is outside your project, so Codex's default sandbox should ask
before running it: approve it, ideally for good. (Tested with full access only; the approval step
itself was not tested.)

**Note:** in non-interactive tests (`codex exec`), Codex sometimes reported "Failed to create unified
exec process" for the waiting command. If Codex runs the command again, the helper now picks up the
popup that is already open and keeps waiting.

**Model:** whatever model your Codex session uses (`/model` to change it).

## 3. Antigravity (app and `agy` CLI)

**Use it:** in the agent chat, type `/enhance-prompt`. The popup opens; write your draft and press ⌘↵.
The agent enhances it with the current Gemini model and the result window opens.

**Terminal sandbox:** with the terminal sandbox on (`"enableTerminalSandbox": true` in
`~/.gemini/antigravity-cli/settings.json`), the popup app can't start from inside it (tested twice).
Turn the sandbox off, or allow the command to run outside the sandbox if Antigravity offers that.
With the sandbox off, it worked, including a draft sent after almost 2 minutes of writing.

**Model:** the session's model (`agy --model …`, or the model picker in the app).

## 4. Gemini CLI

**Use it:** type `/enhance-prompt` (the installed command tells Gemini to follow the skill), or ask
"use the enhance-prompt skill". Run `/skills` to check that Gemini CLI found it; Agent Skills may need
to be turned on in its settings, depending on your version.

**Approval:** Gemini CLI asks before running shell commands; allow the `pe` helper.

**Note:** Google moved free and personal accounts from Gemini CLI to the Antigravity CLI (`agy`) in
June 2026. If that applies to you, use the Antigravity steps above.

## What works differently outside Claude Code

- **WC (with conversation)** only works in Claude Code; in other tools it is ignored.
- **Model choice:** Claude Code routes between Sonnet and Opus; other tools use the model of your
  session. The result window shows the model name the tool reports.
- **Revise:** works per project and day (prompts are grouped by folder name and date).
- **Waiting:** while you write, the agent checks back about every 100 seconds, so a long draft costs a
  few small tool calls. Gemini CLI was not tested.

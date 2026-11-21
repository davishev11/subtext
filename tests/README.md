# Tests

A change is ready only when **every** test passes, old ones included. Tests are the spec: each one is
written from a request before the code. When an old test fails, fix the code; change the test only
when the requirement itself changed. Every bug found by hand becomes a new test.

```bash
scripts/test.sh          # quick: logic + After Effects (~1 min)
scripts/test.sh full     # + the panel clicked like a person, real transcription (~10 min)
```

Each run writes `tests/reports/<date>_<commit>/report.md`: a pass/fail table for each check, plus frames
rendered from After Effects.

| Layer | Where | What it proves |
|---|---|---|
| Logic | `tests/*.test.js` (Node) | grouping (Words / Auto / Sentences, Max rows), merge / split / edit, SRT/VTT, audio and engine helpers |
| After Effects | `tests/ae/*.jsx` (via `research/ae_run.sh`) | layers, bottom anchor, safe zone, effects and boxes, Fit, migration of older comps; zero expression errors |
| Panel like a person | `tests/ui/flow.js` (real mouse and keys through the CEP debug port) | Transcribe → modes → Max rows → ⌘Z → edit / merge / split / delete → Update → presets and effects → Fit → partial re-transcription → save, close, reopen |

Needs: After Effects with `research/out/subtext-test.aep` open. The tests work in its
"Subtext autotest" folder and never touch other projects. For the panel test, install the dev build with the
debug port (`extension/.debug`) and don't click in the panel while it runs.

Not covered (check by hand): the system file dialogs for SRT/VTT import/export, keys reaching the panel
when After Effects has the focus (⌘Z, digits in Max rows), ⌘Z pressed in After Effects right after an Update
(the panel should follow the restored layers), and how it looks.

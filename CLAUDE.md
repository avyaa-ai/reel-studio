# Reel Studio - instructions for the AI agent (Claude Code)

You are the production assistant for DEQX's Reel Studio. You turn briefs and raw footage into
on-brand short videos. People approve; you do the work in between. Read this file fully before
any task, then read `rules/editing_rules.md` and `brand/style_sheet.md`.

## Hard rules
1. **Never write or edit scene code to make a reel.** Generated reels are made only by writing a
   spec in `specs/<id>.json` that follows `schema/reel_spec.schema.json`, using the existing scenes:
   `hook_title, statement, counter, checklist, myth_card, cta`. If a reel needs a new kind of scene,
   stop and propose it to the team; a developer adds it to `engine/scenes.mjs`.
2. **Facts only from the fact sheet.** Every number, name or claim must be on the brief's fact
   sheet in `facts/`. Cite its ID in the beat's `claims`. Never invent numbers. If a needed fact is
   missing, ask for it. The build fails on numbers not on the sheet - do not work around this.
3. **Storyboard before render.** Always produce the storyboard and wait for a person's approval
   before the final render. Never fill in `approvals` yourself.
4. **Never publish.** You produce files in `exports/`. People publish.
5. Only use footage, music, fonts and images in this project that we have rights to. Reference
   videos are for learning structure and timing only.
6. Generated files in `work/` are outputs - re-run the scripts, do not hand-edit them.

## Commands (run from this folder)
| Step | Command |
|---|---|
| Validate a spec | `node engine/build.mjs specs/<id>.json --check` |
| Voiceover + re-time beats to the voice | `python3 tools/make_voice.py specs/<id>.json` |
| Storyboard for approval | `bash engine/storyboard.sh specs/<id>.json` -> `work/<id>/storyboard/contact-sheet.jpg` |
| Render + quality score | `bash engine/render.sh specs/<id>.json` -> `exports/<id>.mp4`, `work/<id>/score.json` |
| Fast draft render | `bash engine/render.sh specs/<id>.json draft` |
| Edit mode: clean a raw clip | `python3 tools/edit_clip.py raw_footage/<clip>.mp4 --out work/<clip>` |
| Edit mode: captioned reel | `node engine/build_talking_head.mjs work/<clip> --cta <KEYWORD>` then `engine/node_modules/.bin/hyperframes render work/<clip>_reel -o exports/<clip>_reel.mp4` |
| Score any video | `python3 tools/score_video.py exports/<file>.mp4` |
| HyperFrames checks / help | `engine/node_modules/.bin/hyperframes check work/<id>` / `... docs <topic>` |

## Workflow A - Generate a reel from a brief
1. Read the brief in `briefs/` and its fact sheet. Restate the key message in one line.
2. Write `specs/<id>.json`:
   - 5-9 beats, 15-60 s total; first beat is a hook (`hook_title` or `statement`) with the
     payoff in the first 1.5 s; last beat is `cta` with the brief's keyword.
   - One idea per beat, 0.6-6 s each, 2.5-4.5 words per second of speech.
   - One `emphasis` word per beat that appears in the text.
   - Use `theme` to mark acts: light = explain, dark = proof/myth, accent = CTA.
   - Write numbers that the voice must say in words if TTS would misread them (e.g. say
     "day and night" and show "24/7" in the scene props).
3. Run `--check` and fix every error.
4. Run `make_voice.py` (re-times the beats to the voice), then `--check` again.
5. Run `storyboard.sh`. Show the contact sheet and the beat list (time, line, scene) to the
   person and STOP for approval.
6. Apply storyboard feedback to the spec, then `render.sh`.
7. If the score is NOT READY, fix the spec using the fix list (add a beat, shorten a line,
   split a long beat, change a scene) and re-render. Maximum 3 rounds. If it still fails,
   or the problem is factual or about rights, stop and report to a person.
8. Report: file path, duration, score summary, and anything a reviewer should check.

## Workflow B - Edit a talking-head clip
1. `edit_clip.py` on the clip. Report seconds saved, pauses and fillers removed.
2. Read `captions.srt` and fix obvious transcription errors in `words.json` (spelling of names
   and product terms only - never change what the person said).
3. Build with `build_talking_head.mjs` and render. Snapshot frames and check captions do not
   cover the face; if they do, rebuild with `--caption-y` (e.g. 1300).
4. Score the export and report.

## Workflow C - Notes on the cut (feedback round)
For each note from the reviewer: restate it, make the change in the spec (or rebuild options),
re-render, and reply with a checklist: note -> what you changed -> done / could not do (why).

## Prompt pack (what people type)
1. **Setup:** "Read CLAUDE.md, run `npm install` in engine/, check HyperFrames with
   `engine/node_modules/.bin/hyperframes doctor`, and tell me what is missing."
2. **Style sheet:** "Analyse the 3 videos in references/. Measure scene length, change rate, hook
   timing, caption style, transitions, colours, music level and speech pace (use
   tools/score_video.py for the numbers). Fill in brand/style_sheet.md and summarise it for approval."
3. **Create a reel:** "Using briefs/<brief>.md, make a reel following Workflow A. Stop at the storyboard."
4. **Feedback:** "Notes on the cut: <notes>. Apply them following Workflow C."

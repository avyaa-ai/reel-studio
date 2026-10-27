# Reel Studio - starter kit (pilot, stage 1)

An AI-assisted video workflow for DEQX. An AI agent (Claude Code) writes a structured
**reel spec**; approved, coded **scene templates** turn it into video with HyperFrames;
an automated **quality scorer** checks it; people approve the storyboard and the final cut.

What already works in this kit (tested):

| Piece | File | Status |
|---|---|---|
| Spec format + validation (schema, timing, pace, emphasis, fact check) | `schema/`, `engine/build.mjs` | Working |
| 6 scene templates, brand-driven (Print style) | `engine/scenes.mjs` | Working |
| Storyboard contact sheet for approval | `engine/storyboard.sh` | Working |
| Render to 1080x1920 MP4 | `engine/render.sh` (HyperFrames) | Working, ~70 s for a 22 s reel |
| Voiceover + re-timing beats to the voice | `tools/make_voice.py` (Kokoro, local, free) | Working |
| Quality scorer (12 checks + fix list) | `tools/score_video.py` | Working, calibrated on 2 reference reels |
| Edit mode: cut pauses/fillers, captions | `tools/edit_clip.py` | Working (silence cut); filler + captions need faster-whisper |
| Edit mode: captioned talking-head reel with punch-ins | `engine/build_talking_head.mjs` | Working |
| Example output | `exports/voice_agents_how_it_works.mp4` | 21.6 s, scored 12/12 READY |

## 1. Install (one time, ~15 minutes)

Requirements: macOS/Linux/WSL, **Node.js 22+**, **Python 3.10+**, **FFmpeg**, Google Chrome.

```bash
cd reel-studio/engine && npm install && cd ..
engine/node_modules/.bin/hyperframes doctor          # checks Chrome + FFmpeg
engine/node_modules/.bin/hyperframes browser ensure  # downloads the render browser if needed
pip install numpy jsonschema kokoro-onnx soundfile faster-whisper
```

Voice model (for `make_voice.py`): download `kokoro-v1.0.onnx` and `voices-v1.0.bin` from
https://github.com/thewh1teagle/kokoro-onnx/releases (tag `model-files-v1.0`) into `tools/models/`.
faster-whisper downloads its model on first use.

Then install Claude Code, open this folder in it, and type prompt 1 from `CLAUDE.md`.

## 2. Try the example (5 minutes)

```bash
node engine/build.mjs specs/voice_agents_how_it_works.json --check   # validate
bash engine/storyboard.sh specs/voice_agents_how_it_works.json       # storyboard
bash engine/render.sh specs/voice_agents_how_it_works.json           # render + score
```

## 3. Make it DEQX's (pilot week 1-2)

1. **Brand:** replace the placeholder colours, fonts and logo in `brand/brand.json`
   (keep the accent colour at least 3:1 contrast on the background).
2. **Facts:** replace `facts/voice_agents.md` with real, approved facts and sources.
   The example row F3 ("3 seconds") is a placeholder - do not publish it.
3. **Style sheet:** put 3 reference reels in `references/`, run prompt 2, approve `brand/style_sheet.md`.
4. **Voice:** choose a voice (Kokoro voice ids such as `am_michael`, `af_heart`, `bm_george`) or
   connect ElevenLabs/Azure/OpenAI TTS by replacing `synth()` in `tools/make_voice.py`.
5. **Music:** add a licensed track and set `music.file` in the spec.
6. **Templates:** the designer restyles `engine/scenes.mjs` (CSS in `styles()`) and adds 2 more
   scenes (e.g. `before_after`, `ui_card`) and their schema entries.

## 4. Folder map

```
reel-studio/
  CLAUDE.md        agent rules, workflows and the 4-prompt pack   <- start here
  brand/           brand.json (colours, fonts, logo), style_sheet.md (to approve)
  briefs/          one brief per reel
  facts/           approved fact sheets - the only allowed source of numbers/claims
  specs/           reel specs (the AI writes these)
  schema/          reel_spec.schema.json
  rules/           editing_rules.md, quality_targets.json
  engine/          build.mjs, scenes.mjs, build_talking_head.mjs, storyboard.sh, render.sh
  tools/           score_video.py, edit_clip.py, make_voice.py
  references/      reference reels (structure study only)
  raw_footage/     talking-head clips for Edit mode
  work/            generated compositions, voice, storyboards, scores
  exports/         final MP4s
```

## 5. Quality scorer: what it measures

`python3 tools/score_video.py exports/<file>.mp4` - targets in `rules/quality_targets.json`.

| Check | Meaning | Target |
|---|---|---|
| aspect, resolution, duration | 9:16, >= 1080 px wide, 15-90 s | |
| motion | share of time the picture visibly changes, 0-10 | >= 6.0 |
| big_moments_per_s | sharp changes (pops, cuts, slides) per second | >= 0.65 |
| flat_pct / longest_flat_s | static stretches | <= 27% / <= 1.5 s |
| hook_visual_s / hook_speech_s | first motion / first word | <= 1.5 s / <= 1.0 s |
| loudness_lufs / true_peak_db | platform loudness | -16 to -12 LUFS / <= -1 dB |
| dead_air | silences mid-video | none > 0.7 s |

Calibration on the two reference reels: motion 9.9 and 8.5; big moments 1.5/s and 1.0/s.
Tune targets after the pilot using your own best-performing posts.

## 6. Known limits (pilot scope)

- One visual style (Print). 3D/Toybox styles and Hybrid mode come after the pilot.
- Word timings for generated voice are estimated from word length (good enough for captions);
  a TTS with word timestamps (e.g. ElevenLabs) makes them exact.
- Caption-over-face is not detected automatically yet; check snapshots, use `--caption-y`.
- Fact checking covers digits only (not numbers written as words, not wording of claims) -
  the reviewer still reads every script.
- Remotion is not used; HyperFrames (Apache 2.0) avoids Remotion's company licence fee.
- HyperFrames lint shows "sub-composition" warnings on generated files; they concern editing in
  HyperFrames Studio, not render output, and can be ignored.

## 7. Next build steps (pilot weeks 3-6)
- Brand + 2 more scenes; second format (Myth Buster) example spec.
- faster-whisper on a real DEQX clip; tune `--max-gap` and caption position.
- Log approvals (who/when) from `approvals` in each spec into a simple sheet or database.
- Track each export with a UTM link and record results per post for the go / no-go review.

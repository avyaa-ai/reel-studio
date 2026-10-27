#!/usr/bin/env python3
"""
Reel Studio - Generate mode: voiceover from a reel spec, and re-time the beats to it.

For each beat it synthesises the line, then (with --retime, the default) sets
every beat's start/end to fit the spoken audio plus a short breath, so captions
and scenes follow the voice. It writes:

  work/<id>/voice/vo.wav       full voiceover, loudness-normalised (-14 LUFS)
  work/<id>/voice/words.json   estimated word timings for the kinetic captions
  specs/<id>.json              updated: beat timings + voice.file + voice.words

Engine: Kokoro (open-weight, runs locally, free). Swap synth() for ElevenLabs,
Azure or OpenAI TTS for a brand voice; keep the rest unchanged.

Setup (once):
  pip install kokoro-onnx soundfile
  download kokoro-v1.0.onnx and voices-v1.0.bin from
  https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0) into tools/models/

Usage:
  python3 tools/make_voice.py specs/voice_agents_how_it_works.json
  python3 tools/make_voice.py specs/<id>.json --voice am_michael --speed 1.05 --no-retime
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "tools" / "models"
BREATH = 0.28        # pause after each line, seconds
MIN_BEAT, MAX_BEAT = 0.6, 6.0
SR = 24000


def synth(kokoro, text, voice, speed):
    audio, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    assert sr == SR
    # trim leading/trailing near-silence
    idx = np.where(np.abs(audio) > 0.01)[0]
    return audio[idx[0]:idx[-1] + 1] if len(idx) else audio


def word_weights(words):
    # longer words take longer to say; punctuation adds a little pause
    return [max(1, len(re.sub(r"[^\w]", "", w))) + (2 if re.search(r"[,.;:!?]$", w) else 0) for w in words]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--voice", default="am_michael", help="Kokoro voice id, e.g. am_michael, af_heart, bm_george")
    ap.add_argument("--speed", type=float, default=1.05)
    ap.add_argument("--no-retime", action="store_true", help="keep spec timings; speed lines up to fit instead")
    a = ap.parse_args()

    try:
        from kokoro_onnx import Kokoro
    except ImportError:
        sys.exit("Install the TTS engine first:  pip install kokoro-onnx soundfile")
    model, voices = MODELS / "kokoro-v1.0.onnx", MODELS / "voices-v1.0.bin"
    if not model.exists() or not voices.exists():
        sys.exit(f"Model files missing in {MODELS} - see the setup notes at the top of this file.")
    import soundfile as sf

    spec_path = Path(a.spec)
    spec = json.loads(spec_path.read_text())
    kokoro = Kokoro(str(model), str(voices))
    out = ROOT / "work" / spec["id"] / "voice"
    out.mkdir(parents=True, exist_ok=True)

    clips, t, words_out = [], 0.0, []
    for b in spec["beats"]:
        speed = a.speed
        audio = synth(kokoro, b["text"], a.voice, speed)
        length = len(audio) / SR
        if a.no_retime:
            slot = b["end"] - b["start"]
            while length + 0.1 > slot and speed < 1.35:
                speed += 0.05
                audio = synth(kokoro, b["text"], a.voice, speed)
                length = len(audio) / SR
            if length + 0.1 > slot:
                sys.exit(f'Beat "{b["id"]}" needs {length:.2f}s of speech but has {slot:.2f}s - shorten the line.')
            start, end = b["start"], b["end"]
        else:
            start = round(t, 2)
            dur = min(max(length + BREATH, MIN_BEAT), MAX_BEAT)
            if b is spec["beats"][-1]:
                dur += 1.2   # hold the CTA on screen after the last word
            if length > MAX_BEAT:
                sys.exit(f'Beat "{b["id"]}" is {length:.1f}s of speech - split it into two beats (max {MAX_BEAT}s).')
            end = round(start + dur, 2)
            b["start"], b["end"] = start, end
        lead = 0.05
        pad_before = int((start + lead) * SR) - sum(len(c) for c in clips)
        clips.append(np.zeros(max(pad_before, 0), dtype=np.float32))
        clips.append(audio.astype(np.float32))
        # estimated word timings inside the spoken part
        ws = b["text"].split()
        wts = word_weights(ws)
        acc = start + lead
        for w, k in zip(ws, wts):
            words_out.append({"word": w, "start": round(acc, 3), "end": round(acc + length * k / sum(wts), 3)})
            acc += length * k / sum(wts)
        t = end
        print(f'  {b["id"]:<12} {start:6.2f}-{end:6.2f}s  speech {length:.2f}s  speed {speed:.2f}')

    total = spec["beats"][-1]["end"]
    voice = np.concatenate(clips)
    voice = np.concatenate([voice, np.zeros(max(int(total * SR) - len(voice), 0), dtype=np.float32)])
    raw = out / "vo_raw.wav"
    sf.write(raw, voice, SR)
    final = out / "vo.wav"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af",
                        "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", str(final)], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr)
    raw.unlink()
    (out / "words.json").write_text(json.dumps(words_out, indent=1))

    rel = lambda p: str(p.relative_to(ROOT))
    spec["voice"] = {"file": rel(final), "provider": f"kokoro:{a.voice}", "words": rel(out / "words.json")}
    spec_path.write_text(json.dumps(spec, indent=2) + "\n")
    print(f"\nVoiceover {total:.1f}s -> {rel(final)}; spec timings and voice fields updated in {spec_path}")


if __name__ == "__main__":
    main()

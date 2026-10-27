#!/usr/bin/env python3
"""
Reel Studio - Edit mode, step 1: clean a raw talking-head clip.

  1. Transcribe with word timestamps (faster-whisper), if installed.
  2. Build a keep-list: speech only, pauses longer than --max-gap removed,
     filler words (um, uh, erm, hmm ...) removed.
  3. Cut the clip with ffmpeg (frame-accurate re-encode, audio kept in sync).
  4. Write captions for the CUT video: .srt (2-4 word phrases) and
     words.json (word-level timings for kinetic captions in the renderer).
  5. Write cut_report.json: what was removed and where.

Without faster-whisper, it falls back to silence detection only (no fillers,
no captions) so the pipeline still runs.

Usage:
  python3 tools/edit_clip.py raw_footage/take_07.mp4 --out work/take_07
  python3 tools/edit_clip.py raw_footage/take_07.mp4 --out work/take_07 --max-gap 0.35 --model small

Outputs in --out: cut.mp4, captions.srt, words.json, cut_report.json
Requires: ffmpeg, Python 3.9+. Optional: pip install faster-whisper
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

FILLERS = {"um", "umm", "uh", "uhh", "erm", "er", "ah", "hmm", "mm", "mhm"}
PAD = 0.08            # seconds kept before/after each speech run, avoids clipped words
PHRASE_WORDS = 3      # words per caption line


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())


def transcribe(path, model_name, language):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    try:
        model = WhisperModel(model_name, compute_type="int8")
    except Exception as e:  # model download blocked, etc.
        print(f"[edit_clip] Whisper model unavailable ({e.__class__.__name__}); using silence detection.")
        return None
    segments, _ = model.transcribe(str(path), word_timestamps=True, language=language,
                                   vad_filter=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append({"word": w.word.strip(), "start": float(w.start), "end": float(w.end)})
    return words


def speech_from_silence(path, total, noise_db=-35, min_sil=0.35):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af",
                          f"silencedetect=n={noise_db}dB:d={min_sil}", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    sil = list(zip(starts, ends + [total] * (len(starts) - len(ends))))
    speech, cur = [], 0.0
    for a, b in sil:
        if a > cur:
            speech.append((cur, a))
        cur = max(cur, b)
    if cur < total:
        speech.append((cur, total))
    return speech


def keep_list(words, max_gap, total):
    """Merge non-filler words into runs; a gap > max_gap starts a new run."""
    kept = [w for w in words if re.sub(r"[^a-z]", "", w["word"].lower()) not in FILLERS]
    runs = []
    for w in kept:
        if runs and w["start"] - runs[-1][1] <= max_gap:
            runs[-1][1] = w["end"]
        else:
            runs.append([w["start"], w["end"]])
    return [(max(0, a - PAD), min(total, b + PAD)) for a, b in runs], kept


def merge(segs, max_gap):
    out = []
    for a, b in sorted(segs):
        if out and a - out[-1][1] <= max_gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out if b - a > 0.05]


def cut(src, segs, dst):
    parts, labels = [], []
    for i, (a, b) in enumerate(segs):
        parts.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[v{i}];"
                     f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}];")
        labels.append(f"[v{i}][a{i}]")
    graph = "".join(parts) + "".join(labels) + f"concat=n={len(segs)}:v=1:a=1[v][a]"
    script = Path(dst).with_suffix(".filter.txt")
    script.write_text(graph)
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex_script", str(script),
           "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    script.unlink(missing_ok=True)
    if r.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{r.stderr[-2000:]}")


def remap(t, segs):
    """Map a time in the source clip to the cut clip (None if it was removed)."""
    offset = 0.0
    for a, b in segs:
        if a <= t <= b:
            return offset + (t - a)
        offset += b - a
    return None


def srt_time(s):
    h, rem = divmod(max(s, 0), 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h):02}:{int(m):02}:{int(sec):02},{int(round((sec % 1) * 1000)):03}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clip")
    ap.add_argument("--out", required=True, help="output folder, e.g. work/take_07")
    ap.add_argument("--max-gap", type=float, default=0.35, help="longest pause kept, seconds")
    ap.add_argument("--model", default="small", help="faster-whisper model: tiny, base, small, medium")
    ap.add_argument("--language", default="en")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    total = duration(a.clip)

    words = transcribe(a.clip, a.model, a.language)
    if words:
        segs, kept = keep_list(words, a.max_gap, total)
        method = "whisper"
    else:
        segs, kept = speech_from_silence(a.clip, total), []
        method = "silence-detect (no transcript: install faster-whisper for fillers + captions)"
    segs = merge(segs, 0.05)
    if not segs:
        sys.exit("No speech found - check the clip has audio.")

    cut(a.clip, segs, out / "cut.mp4")
    new_total = sum(b - a for a, b in segs)

    # captions for the cut video
    cw = []
    for w in kept:
        s, e = remap(w["start"], segs), remap(w["end"], segs)
        if s is not None and e is not None:
            cw.append({"word": w["word"], "start": round(s, 3), "end": round(e, 3)})
    (out / "words.json").write_text(json.dumps(cw, indent=1))
    lines = []
    for i in range(0, len(cw), PHRASE_WORDS):
        grp = cw[i:i + PHRASE_WORDS]
        lines.append(f"{len(lines) + 1}\n{srt_time(grp[0]['start'])} --> {srt_time(grp[-1]['end'])}\n"
                     + " ".join(g["word"] for g in grp) + "\n")
    (out / "captions.srt").write_text("\n".join(lines))

    removed = []
    prev = 0.0
    for s, e in segs:
        if s - prev > 0.05:
            removed.append({"from": round(prev, 2), "to": round(s, 2), "seconds": round(s - prev, 2)})
        prev = e
    if total - prev > 0.05:
        removed.append({"from": round(prev, 2), "to": round(total, 2), "seconds": round(total - prev, 2)})
    fillers = [w for w in (words or []) if re.sub(r"[^a-z]", "", w["word"].lower()) in FILLERS]
    report = {"source": a.clip, "method": method, "original_s": round(total, 2), "cut_s": round(new_total, 2),
              "saved_s": round(total - new_total, 2), "pauses_removed": len(removed),
              "fillers_removed": len(fillers), "caption_words": len(cw), "removed": removed}
    (out / "cut_report.json").write_text(json.dumps(report, indent=2))

    print(f"{Path(a.clip).name}: {total:.1f}s -> {new_total:.1f}s "
          f"(saved {total - new_total:.1f}s, {len(removed)} pauses, {len(fillers)} fillers) via {method}")
    print(f"Wrote {out}/cut.mp4, captions.srt, words.json, cut_report.json")


if __name__ == "__main__":
    main()

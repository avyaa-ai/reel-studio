#!/usr/bin/env python3
"""
Reel Studio - automated quality scorer.

Measures a rendered video against rules/quality_targets.json and prints a
pass/fail report plus a time-stamped fix list the agent can act on.

Checks (all measured from the file itself, no AI needed):
  - format        : resolution / aspect ratio / fps / duration window
  - hook          : first big visual change and first speech must land early
  - motion        : average amount of on-screen change (0-10 scale)
  - big_moments   : number of strong visual changes per second
  - flat          : share of time with almost no motion (stretches > min_flat_s)
  - longest_flat  : longest single static stretch
  - loudness      : integrated loudness (LUFS) and true peak (dBTP)
  - dead_air      : silences longer than max_silence_s

Usage:
  python3 tools/score_video.py exports/my_reel.mp4
  python3 tools/score_video.py exports/my_reel.mp4 --json work/my_reel_score.json
  python3 tools/score_video.py exports/my_reel.mp4 --targets rules/quality_targets.json

Requires: ffmpeg + ffprobe on PATH, Python 3.9+, numpy.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ANALYSIS_W, ANALYSIS_H = 72, 128   # small grayscale frames are enough for motion
ANALYSIS_FPS = 15

DEFAULT_TARGETS = {
    "aspect": "9:16",
    "min_width": 1080,
    "duration_s": [15, 90],
    "hook_visual_s": 1.5,
    "hook_speech_s": 1.0,
    "motion_min": 6.0,
    "big_moments_per_s_min": 0.65,
    "flat_pct_max": 27,
    "min_flat_s": 0.3,
    "longest_flat_s_max": 1.5,
    "lufs": [-16, -12],
    "true_peak_max_db": -1.0,
    "max_silence_s": 0.7,
}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-show_entries",
               "stream=codec_type,width,height,r_frame_rate:format=duration",
               "-of", "json", str(path)])
    if out.returncode != 0:
        sys.exit(f"ffprobe failed: {out.stderr.strip()}")
    info = json.loads(out.stdout)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    has_audio = any(s["codec_type"] == "audio" for s in info["streams"])
    num, den = (v["r_frame_rate"].split("/") + ["1"])[:2]
    return {
        "width": int(v["width"]), "height": int(v["height"]),
        "fps": round(float(num) / float(den or 1), 2),
        "duration": float(info["format"]["duration"]),
        "has_audio": has_audio,
    }


def motion_series(path):
    """Mean absolute pixel change between consecutive frames, 0-255 scale."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vf",
           f"fps={ANALYSIS_FPS},scale={ANALYSIS_W}:{ANALYSIS_H},format=gray",
           "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    frame = ANALYSIS_W * ANALYSIS_H
    n = len(raw) // frame
    frames = np.frombuffer(raw[: n * frame], dtype=np.uint8).reshape(n, frame).astype(np.int16)
    if n < 2:
        return np.zeros(0)
    return np.abs(np.diff(frames, axis=0)).mean(axis=1)


def runs_below(mask, dt):
    """Yield (start_s, end_s) for consecutive True runs in mask."""
    start = None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            yield start * dt, i * dt
            start = None
    if start is not None:
        yield start * dt, len(mask) * dt


def loudness(path):
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
               "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    summary = out[out.rfind("Summary:"):] if "Summary:" in out else out
    i = re.search(r"I:\s*(-?[\d.]+) LUFS", summary)
    p = re.search(r"Peak:\s*(-?[\d.]+|-inf) dBFS", summary)
    return (float(i.group(1)) if i else None,
            float(p.group(1)) if p and p.group(1) != "-inf" else None)


def silences(path, min_len):
    out = run(["ffmpeg", "-hide_banner", "-i", str(path), "-af",
               f"silencedetect=n=-35dB:d={min_len}", "-f", "null", "-"]).stderr
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    return list(zip(starts, ends + [None] * (len(starts) - len(ends))))


def score(path, targets):
    t = {**DEFAULT_TARGETS, **targets}
    meta = probe(path)
    checks, fixes = [], []

    def add(name, value, target, ok, note=""):
        checks.append({"check": name, "value": value, "target": target, "pass": bool(ok), "note": note})

    # --- format ---
    aw, ah = (int(x) for x in t["aspect"].split(":"))
    aspect_ok = abs(meta["width"] / meta["height"] - aw / ah) < 0.01
    add("aspect", f'{meta["width"]}x{meta["height"]}', t["aspect"], aspect_ok)
    add("resolution", meta["width"], f'>= {t["min_width"]} px wide',
        meta["width"] >= t["min_width"], "re-render at 1080x1920 for upload" if meta["width"] < t["min_width"] else "")
    lo, hi = t["duration_s"]
    add("duration_s", round(meta["duration"], 1), f"{lo}-{hi}", lo <= meta["duration"] <= hi)

    # --- motion ---
    d = motion_series(path)
    dt = 1.0 / ANALYSIS_FPS
    # 0-10 scale = share of time where the picture visibly changes (frame change
    # above a small noise floor), x10. Robust to hard cuts and to compression noise.
    # Calibration: reference motion-graphics reel 9.9, talking head + graphics 8.5,
    # captioned talking head 9.0, still image 0.
    motion = float(10 * (d > 0.3).mean()) if len(d) else 0.0
    add("motion", round(motion, 1), f'>= {t["motion_min"]}', motion >= t["motion_min"])

    still = d < 0.2                       # below this, the frame is effectively static
    flats = [(a, b) for a, b in runs_below(still, dt) if b - a >= t["min_flat_s"]]
    flat_pct = 100 * sum(b - a for a, b in flats) / max(meta["duration"], 1e-6)
    add("flat_pct", round(flat_pct, 1), f'<= {t["flat_pct_max"]}%', flat_pct <= t["flat_pct_max"])
    longest = max([b - a for a, b in flats], default=0.0)
    add("longest_flat_s", round(longest, 2), f'<= {t["longest_flat_s_max"]}', longest <= t["longest_flat_s_max"])
    for a, b in flats:
        if b - a > t["longest_flat_s_max"]:
            fixes.append(f"{a:.1f}-{b:.1f}s: static for {b - a:.1f}s -> add a beat (word reveal, card slide, zoom or counter)")

    # big moments = sharp spikes ABOVE the local baseline (rolling median over
    # ~1.5 s), at least 0.3 s apart. Steady movement (a pan, a slow zoom, camera
    # noise) raises the baseline and does not count; a cut, a pop or a slide does.
    # Calibration: reference reels 1.0-1.5/s, captioned talking head ~0.7/s.
    base = np.array([np.median(d[max(0, i - 11):i + 12]) for i in range(len(d))])
    peaks, last = [], -1e9
    for i, v in enumerate(d - base):
        if v >= 1.5 and (i * dt - last) >= 0.3:
            peaks.append(i * dt)
            last = i * dt
    bm = len(peaks) / max(meta["duration"], 1e-6)
    add("big_moments_per_s", round(bm, 2), f'>= {t["big_moments_per_s_min"]}', bm >= t["big_moments_per_s_min"])

    first_visual = next((i * dt for i, v in enumerate(d) if v >= 1.0), None)
    hook_ok = first_visual is not None and first_visual <= t["hook_visual_s"]
    add("hook_visual_s", None if first_visual is None else round(first_visual, 2),
        f'<= {t["hook_visual_s"]}', hook_ok)
    if not hook_ok:
        fixes.append(f"0.0-{t['hook_visual_s']}s: nothing moves in the hook -> open on the key visual and headline")

    # --- audio ---
    if meta["has_audio"]:
        lufs, peak = loudness(path)
        llo, lhi = t["lufs"]
        add("loudness_lufs", lufs, f"{llo} to {lhi}", lufs is not None and llo <= lufs <= lhi,
            "normalise with: ffmpeg -i in.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v copy out.mp4")
        add("true_peak_db", peak, f'<= {t["true_peak_max_db"]}', peak is None or peak <= t["true_peak_max_db"])
        sil = silences(path, 0.2)
        first_speech = 0.0
        if sil and sil[0][0] <= 0.05:
            first_speech = sil[0][1] if sil[0][1] is not None else meta["duration"]
        add("hook_speech_s", round(first_speech, 2), f'<= {t["hook_speech_s"]}', first_speech <= t["hook_speech_s"])
        end = meta["duration"]
        sil = [(a, end if b is None else b) for a, b in sil]
        # silence that runs to the end of the file is an outro, not dead air
        dead = [(a, b) for a, b in sil if a > 0.05 and b < end - 0.15 and b - a > t["max_silence_s"]]
        add("dead_air", len(dead), f'0 gaps > {t["max_silence_s"]}s', not dead)
        for a, b in dead:
            fixes.append(f"{a:.1f}-{b:.1f}s: {b - a:.1f}s of silence -> cut it or cover with music/SFX")
    else:
        add("audio", "none", "voice or music track", False, "video has no audio track")

    passed = sum(c["pass"] for c in checks)
    return {"file": str(path), "meta": meta, "passed": passed, "total": len(checks),
            "ready": passed == len(checks), "checks": checks, "fix_list": fixes}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--targets", default=str(Path(__file__).resolve().parent.parent / "rules" / "quality_targets.json"))
    ap.add_argument("--json", help="write the full report to this JSON file")
    a = ap.parse_args()

    targets = {}
    if a.targets and Path(a.targets).exists():
        targets = json.loads(Path(a.targets).read_text())
    r = score(a.video, targets)

    print(f'\n{Path(a.video).name}  ->  {r["passed"]}/{r["total"]} checks  '
          f'[{"READY" if r["ready"] else "NOT READY"}]\n')
    for c in r["checks"]:
        mark = "PASS" if c["pass"] else "FAIL"
        print(f'  {mark}  {c["check"]:<18} {str(c["value"]):<14} target {c["target"]}'
              + (f'   ({c["note"]})' if c["note"] and not c["pass"] else ""))
    if r["fix_list"]:
        print("\nFix list:")
        for f in r["fix_list"]:
            print("  -", f)
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(r, indent=2))
        print(f"\nReport written to {a.json}")
    sys.exit(0 if r["ready"] else 1)


if __name__ == "__main__":
    main()

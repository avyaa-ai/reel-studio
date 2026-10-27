#!/usr/bin/env node
// Reel Studio - build a HyperFrames composition from a reel spec.
//
//   node engine/build.mjs specs/<id>.json            -> work/<id>/ (composition)
//   node engine/build.mjs specs/<id>.json --check    -> validate only, no files written
//
// Validation runs first and the build stops on any error:
//   1. JSON schema (schema/reel_spec.schema.json)
//   2. Timing: beats start at 0, are contiguous, 0.6-6 s each, total 15-90 s
//   3. Pace: words per second per beat <= brand caption.words_per_second_max
//   4. Emphasis word must appear in the beat text
//   5. Facts: every number in text/props must be on the fact sheet; claim IDs must exist
//   6. Structure: first beat is a hook (<= 3 s), last beat is the CTA
//
// Run from the project root (the folder that holds brand/, specs/, engine/).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import scenes, { chrome, caption, styles, esc, bgPan, punch } from "./scenes.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(ENGINE, "..");
const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith("--"));
const checkOnly = args.includes("--check");
if (!specPath) {
  console.error("usage: node engine/build.mjs specs/<id>.json [--check]");
  process.exit(2);
}

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const spec = readJSON(path.resolve(specPath));
const errors = [];
const warnings = [];

// 1. schema
const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true });
const validate = ajv.compile(readJSON(path.join(ROOT, "schema/reel_spec.schema.json")));
if (!validate(spec)) {
  for (const e of validate.errors) errors.push(`schema: ${e.instancePath || "(root)"} ${e.message}`);
  report();
}

const brand = readJSON(path.join(ROOT, spec.brand));
const beats = spec.beats;
const total = beats.at(-1).end;

// 2. timing
if (beats[0].start !== 0) errors.push(`timing: first beat must start at 0 (starts at ${beats[0].start})`);
beats.forEach((b, i) => {
  const d = b.end - b.start;
  if (d < 0.6 || d > 6) errors.push(`timing: beat "${b.id}" lasts ${d.toFixed(2)} s (allowed 0.6-6 s)`);
  if (i > 0 && Math.abs(b.start - beats[i - 1].end) > 0.001)
    errors.push(`timing: gap/overlap between "${beats[i - 1].id}" and "${b.id}"`);
});
if (total < 15 || total > 90) errors.push(`timing: total ${total} s is outside 15-90 s`);
const ids = new Set();
beats.forEach((b) => (ids.has(b.id) ? errors.push(`ids: duplicate beat id "${b.id}"`) : ids.add(b.id)));

// 3. pace + 4. emphasis
const maxWps = brand.caption?.words_per_second_max ?? 4.5;
const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
for (const b of beats) {
  const words = b.text.split(/\s+/).filter(Boolean);
  const wps = words.length / (b.end - b.start);
  if (wps > maxWps) errors.push(`pace: beat "${b.id}" needs ${wps.toFixed(1)} words/s (max ${maxWps}) - shorten the line or lengthen the beat`);
  if (b.emphasis && !words.some((w) => bare(w) === bare(b.emphasis)))
    errors.push(`emphasis: "${b.emphasis}" is not a word in beat "${b.id}"`);
  if (!b.emphasis) warnings.push(`emphasis: beat "${b.id}" has no emphasis word`);
}

// 5. facts
const factsText = fs.readFileSync(path.join(ROOT, spec.facts), "utf8");
const factRows = factsText.split("\n").filter((l) => /^\|\s*F\d+/i.test(l));
const header = factsText.split("\n").find((l) => /^\|.*number/i.test(l)) || "";
const numCol = header.split("|").findIndex((c) => /number/i.test(c));
const factIds = new Set(factRows.map((r) => r.split("|")[1].trim().toUpperCase()));
const approvedNumbers = new Set(
  factRows.flatMap((r) => ((numCol > 0 ? r.split("|")[numCol] : r).match(/\d+(?:[.,/:]\d+)*/g) || []))
);
const numbersIn = (v) =>
  typeof v === "number" ? [String(v)] : typeof v === "string" ? v.match(/\d+(?:[.,/:]\d+)*/g) || [] :
  Array.isArray(v) ? v.flatMap(numbersIn) : v && typeof v === "object" ? Object.entries(v).filter(([k]) => k !== "number").flatMap(([, x]) => numbersIn(x)) : [];
for (const b of beats) {
  for (const n of new Set([...numbersIn(b.text), ...numbersIn(b.props)]))
    if (!approvedNumbers.has(n)) errors.push(`facts: beat "${b.id}" uses the number ${n}, which is not on ${spec.facts}`);
  for (const c of b.claims || []) if (!factIds.has(c.toUpperCase())) errors.push(`facts: beat "${b.id}" cites ${c}, not found on ${spec.facts}`);
  if ((numbersIn(b.text).length || numbersIn(b.props).length) && !(b.claims || []).length)
    warnings.push(`facts: beat "${b.id}" contains a number but cites no claim ID`);
}
if (/EXAMPLE ONLY|placeholder/i.test(factsText)) warnings.push(`facts: ${spec.facts} still contains placeholder rows - not for publishing`);

// 6. structure
if (beats[0].end > 3) warnings.push(`hook: first beat is ${beats[0].end} s long; aim for the payoff within 1.5 s`);
if (beats.at(-1).scene !== "cta") errors.push(`structure: last beat must use the "cta" scene`);

report();
if (checkOnly) process.exit(0);

// ---------- generate the composition ----------
const outDir = path.join(ROOT, "work", spec.id);
fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });

let voiceWords = null;
if (spec.voice?.words) voiceWords = readJSON(path.join(ROOT, spec.voice.words));

// caption word times: from voice word timings if given, else spread over the beat
function wordTimes(beat, n) {
  if (voiceWords) {
    const ws = voiceWords.filter((w) => w.start >= beat.start - 0.05 && w.start < beat.end);
    if (ws.length === n) return ws.map((w) => w.start);
    warnings.push(`captions: beat "${beat.id}" has ${n} words but voice timing has ${ws.length}; using even spacing`);
  }
  const t0 = beat.start + 0.05, span = (beat.end - beat.start) * 0.85;
  return Array.from({ length: n }, (_, i) => t0 + (i * span) / n);
}

const parts = [], js = [];
beats.forEach((b, i) => {
  const t0 = b.start, dur = b.end - b.start;
  const theme = b.theme || "light";
  const prevTheme = i ? beats[i - 1].theme || "light" : theme;
  const ctx = { t0, dur, brand, spec, wordTimes };
  // on a theme change the new background wipes in just BEFORE the beat starts,
  // so the new text never appears on the old background
  const wipe = i > 0 && theme !== prevTheme;
  const bgStart = wipe ? +Math.max(0, t0 - 0.3).toFixed(3) : t0;
  const scene = scenes[b.scene](b, ctx);
  const ch = chrome(b, ctx), cap = caption(b, ctx);
  parts.push(`
    <div class="clip bg theme-${theme}" id="${b.id}-bgclip" data-start="${bgStart}" data-duration="${(b.end - bgStart).toFixed(3)}" data-track-index="0" style="z-index:${i * 2}"></div>
    <div class="clip scene theme-${theme}" id="${b.id}-scene" data-start="${t0}" data-duration="${dur.toFixed(3)}" data-track-index="1" style="z-index:${i * 2 + 1}">
      ${ch.html}
      ${cap.html}
      ${scene.html}
    </div>`);
  js.push(`// --- beat ${b.id} (${b.scene}) ${t0}-${b.end}s`);
  if (wipe)
    js.push(`tl.fromTo(${JSON.stringify("#" + b.id + "-bgclip")}, {clipPath:"circle(0% at 50% 60%)"}, {clipPath:"circle(150% at 50% 60%)", duration:0.4, ease:"power2.in"}, ${bgStart});`);
  js.push(bgPan("#" + b.id + "-bgclip", bgStart, b.end - bgStart));
  js.push(punch("#" + b.id + "-scene", t0, dur));
  js.push(`tl.from(${JSON.stringify("#" + b.id + "-scene .caption")}, {y:40, opacity:0, duration:0.25, ease:"power2.out"}, ${t0});`);
  js.push(ch.js, cap.js, scene.js);
});

const media = [];
const copyAsset = (rel) => {
  const dst = path.join("assets", path.basename(rel));
  fs.copyFileSync(path.join(ROOT, rel), path.join(outDir, dst));
  return dst;
};
if (spec.voice?.file)
  media.push(`<audio class="clip" id="voice" src="${copyAsset(spec.voice.file)}" data-start="0" data-duration="${total}" data-volume="1" data-track-index="2"></audio>`);
if (spec.music?.file)
  media.push(`<audio class="clip" id="music" src="${copyAsset(spec.music.file)}" data-start="0" data-duration="${total}" data-volume="${spec.music.volume ?? 0.12}" data-fade-out="1" data-track-index="3"></audio>`);
if (!spec.voice?.file) warnings.push("audio: no voice file in spec - the render will be silent (fine for a storyboard/preview)");

const html = `<!doctype html>
<html lang="en" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<title>${esc(spec.title)}</title>
<!-- GENERATED by engine/build.mjs from specs/${spec.id}.json - edit the spec, not this file. -->
<script src="gsap.min.js"></script>
<style>${styles(brand)}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1080" data-height="1920">
${parts.join("\n")}
${media.join("\n")}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js.filter(Boolean).join("\n")}
tl.set({}, {}, ${total});
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(outDir, "gsap.min.js"));
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ id: spec.id, name: spec.title }, null, 2));
fs.writeFileSync(path.join(outDir, "hyperframes.json"), JSON.stringify({ paths: { assets: "assets" } }, null, 2));
fs.writeFileSync(
  path.join(outDir, "storyboard.json"),
  JSON.stringify(beats.map((b) => ({ id: b.id, at: +((b.start + b.end) / 2 + 0.3).toFixed(2), text: b.text, scene: b.scene })), null, 2)
);
console.log(`\nBuilt work/${spec.id}/index.html  (${beats.length} beats, ${total}s)`);
for (const w of warnings) console.log("  warning:", w);

function report() {
  if (errors.length) {
    console.error(`\nSpec ${specPath} FAILED validation (${errors.length} error${errors.length > 1 ? "s" : ""}):`);
    for (const e of errors) console.error("  -", e);
    process.exit(1);
  }
}

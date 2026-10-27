// Reel Studio scene templates (style: "print").
//
// Each template is a function (beat, ctx) => { html, js }.
//   html : markup placed inside the beat's full-frame clip
//   js   : GSAP calls added to the ROOT timeline `tl` at absolute times
// Templates are written once by a developer/designer and reviewed like any
// other code. The AI only chooses a template and fills its props in the spec.
//
// Canvas: 1080 x 1920. Zones (keep text inside the platform safe area):
//   top label  y 150-230 | caption 300-680 | visual 720-1380 | logo 1420-1480

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const q = (id) => JSON.stringify(id); // safe selector literal in generated JS

// ---------- shared layers ----------

export function chrome(beat, ctx) {
  const id = beat.id;
  const html = `
    <div class="chapter" id="${id}-chapter">${esc(beat.chapter ? "// " + beat.chapter : "")}</div>
    <div class="progress" id="${id}-progress">${esc(beat.progress || "")}</div>
    <div class="logo" id="${id}-logo">${esc(ctx.brand.logo_text || ctx.brand.name || "")}</div>`;
  return { html, js: "" };
}

// Word-by-word kinetic caption. Upcoming words faint, spoken words solid.
export function caption(beat, ctx) {
  const words = beat.text.split(/\s+/).filter(Boolean);
  const emph = (beat.emphasis || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const spans = words
    .map((w, i) => {
      const bare = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      const cls = bare && bare === emph ? "w em" : "w";
      return `<span class="${cls}" id="${beat.id}-w${i}">${esc(w)}</span>`;
    })
    .join(" ");
  const times = ctx.wordTimes(beat, words.length);
  const js = times
    .map(
      (t, i) =>
        `tl.fromTo(${q("#" + beat.id + "-w" + i)}, {opacity:0.22, y:14}, {opacity:1, y:0, duration:0.16, ease:"power2.out"}, ${t.toFixed(3)});`
    )
    .join("\n");
  // the emphasis word "pops" when spoken - one of the reel's big moments
  const ei = words.findIndex((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === emph);
  const pop = ei >= 0
    ? `\ntl.fromTo(${q("#" + beat.id + "-w" + ei)}, {scale:1.3}, {scale:1, duration:0.35, ease:"back.out(3)"}, ${(times[ei] + 0.02).toFixed(3)});`
    : "";
  return { html: `<div class="caption">${spans}</div>`, js: js + pop };
}

// Gentle continuous drift so no stretch is ever fully static.
const drift = (sel, t0, dur) =>
  `tl.fromTo(${q(sel)}, {y:30, scale:0.98}, {y:-30, scale:1.03, duration:${dur.toFixed(3)}, ease:"none"}, ${t0.toFixed(3)});`;

// Mid-beat punch-in on the whole scene, so long beats get a second big moment.
export const punch = (sel, t0, dur) =>
  dur < 2.4 ? "" :
  `tl.fromTo(${q(sel)}, {scale:1}, {scale:1.05, duration:0.16, yoyo:true, repeat:1, ease:"power2.out"}, ${(t0 + dur * 0.55).toFixed(3)});`;

// Slow pan of the dotted "paper" background: the frame is never fully still.
export const bgPan = (sel, t0, dur) =>
  `tl.fromTo(${q(sel)}, {backgroundPosition:"0px 0px"}, {backgroundPosition:"${Math.round(dur * 14)}px ${Math.round(dur * 22)}px", duration:${dur.toFixed(3)}, ease:"none"}, ${t0.toFixed(3)});`;

// ---------- scene templates ----------

const scenes = {
  hook_title(beat, ctx) {
    const { t0, dur } = ctx;
    const id = beat.id;
    const p = beat.props;
    const html = `
      <div class="visual" id="${id}-vis">
        ${p.tag ? `<div class="tag" id="${id}-tag">${esc(p.tag)}</div>` : ""}
        <div class="hook-title" id="${id}-title">${esc(p.title)}</div>
        <div class="bar" id="${id}-bar"></div>
      </div>`;
    const js = [
      p.tag ? `tl.from(${q("#" + id + "-tag")}, {scale:0.4, opacity:0, duration:0.3, ease:"back.out(2)"}, ${(t0 + 0.05).toFixed(3)});` : "",
      `tl.from(${q("#" + id + "-title")}, {scale:0.6, opacity:0, duration:0.45, ease:"back.out(1.8)"}, ${(t0 + 0.12).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-bar")}, {scaleX:0}, {scaleX:1, duration:0.5, ease:"power3.out"}, ${(t0 + 0.5).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-title")}, {scale:1}, {scale:1.06, duration:${Math.max(dur - 0.6, 0.3).toFixed(3)}, ease:"none"}, ${(t0 + 0.6).toFixed(3)});`,
    ].join("\n");
    return { html, js };
  },

  statement(beat, ctx) {
    const { t0, dur } = ctx;
    const id = beat.id;
    const p = beat.props;
    const html = `
      <div class="visual" id="${id}-vis">
        <div class="ring" id="${id}-ring"></div>
        <div class="big" id="${id}-big">${esc(p.title)}</div>
        ${p.sub ? `<div class="sub" id="${id}-sub">${esc(p.sub)}</div>` : ""}
      </div>`;
    const js = [
      `tl.from(${q("#" + id + "-big")}, {y:120, opacity:0, duration:0.45, ease:"power3.out"}, ${(t0 + 0.1).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-ring")}, {rotation:0, scale:0.7, opacity:0}, {rotation:120, scale:1, opacity:1, duration:${dur.toFixed(3)}, ease:"none"}, ${t0.toFixed(3)});`,
      p.sub ? `tl.from(${q("#" + id + "-sub")}, {y:40, opacity:0, duration:0.35, ease:"power2.out"}, ${(t0 + Math.min(0.9, dur * 0.4)).toFixed(3)});` : "",
      drift("#" + id + "-big", t0 + 0.55, Math.max(dur - 0.55, 0.3)),
    ].join("\n");
    return { html, js };
  },

  counter(beat, ctx) {
    const { t0, dur } = ctx;
    const id = beat.id;
    const p = beat.props;
    const html = `
      <div class="visual" id="${id}-vis">
        <div class="counter"><span class="affix">${esc(p.prefix || "")}</span><span class="num" id="${id}-num"></span><span class="affix">${esc(p.suffix || "")}</span></div>
        <div class="meter"><div class="meter-fill" id="${id}-fill"></div></div>
        <div class="sub" id="${id}-label">${esc(p.label)}</div>
      </div>`;
    // CSS @property --n is an integer, rendered with a CSS counter: deterministic when seeked.
    const up = Math.min(1.4, dur * 0.5);
    const js = [
      `tl.fromTo(${q("#" + id + "-num")}, {"--n":0}, {"--n":${p.value}, duration:${up.toFixed(3)}, ease:"power2.out"}, ${(t0 + 0.15).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-fill")}, {scaleX:0}, {scaleX:1, duration:${up.toFixed(3)}, ease:"power2.out"}, ${(t0 + 0.15).toFixed(3)});`,
      `tl.from(${q("#" + id + "-label")}, {y:40, opacity:0, duration:0.35}, ${(t0 + 0.4).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-num")}, {scale:1}, {scale:1.12, duration:0.18, yoyo:true, repeat:1, ease:"power1.inOut"}, ${(t0 + 0.15 + up).toFixed(3)});`,
      drift("#" + id + "-vis", t0, dur),
    ].join("\n");
    return { html, js };
  },

  checklist(beat, ctx) {
    const { t0, dur } = ctx;
    const id = beat.id;
    const p = beat.props;
    const items = p.items
      .map(
        (it, i) =>
          `<div class="item" id="${id}-i${i}"><span class="box" id="${id}-b${i}"><span class="tick" id="${id}-t${i}">&#10003;</span></span><span>${esc(it)}</span></div>`
      )
      .join("");
    const html = `
      <div class="visual" id="${id}-vis">
        <div class="card">
          ${p.title ? `<div class="card-title">${esc(p.title)}</div>` : ""}
          ${items}
        </div>
      </div>`;
    const span = dur * 0.8 - 0.4;
    const step = span / p.items.length;
    const js = [
      `tl.from(${q("#" + id + "-vis .card")}, {y:80, opacity:0, duration:0.35, ease:"power3.out"}, ${(t0 + 0.05).toFixed(3)});`,
      ...p.items.flatMap((_, i) => {
        const t = t0 + 0.4 + i * step;
        return [
          `tl.from(${q("#" + id + "-i" + i)}, {x:-60, opacity:0, duration:0.28, ease:"power2.out"}, ${t.toFixed(3)});`,
          `tl.fromTo(${q("#" + id + "-t" + i)}, {scale:0}, {scale:1, duration:0.22, ease:"back.out(3)"}, ${(t + Math.min(0.35, step * 0.6)).toFixed(3)});`,
        ];
      }),
      drift("#" + id + "-vis", t0, dur),
    ].join("\n");
    return { html, js };
  },

  myth_card(beat, ctx) {
    const { t0, dur } = ctx;
    const id = beat.id;
    const p = beat.props;
    const n = String(p.number || 1).padStart(2, "0");
    const html = `
      <div class="visual" id="${id}-vis">
        <div class="card myth">
          <div class="tag dark-tag">MYTH ${n}</div>
          <div class="small">you might think</div>
          <div class="myth-text" id="${id}-myth">${esc(p.myth)}<div class="strike" id="${id}-strike"></div></div>
          <div class="truth" id="${id}-truth">${esc(p.truth)}</div>
        </div>
        <div class="stamp" id="${id}-stamp">BUSTED</div>
      </div>`;
    const mid = t0 + dur * 0.45;
    const js = [
      `tl.from(${q("#" + id + "-vis .card")}, {rotation:-4, y:80, opacity:0, duration:0.4, ease:"back.out(1.6)"}, ${(t0 + 0.05).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-strike")}, {scaleX:0}, {scaleX:1, duration:0.3, ease:"power2.in"}, ${mid.toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-stamp")}, {scale:2.2, rotation:-25, opacity:0}, {scale:1, rotation:-12, opacity:1, duration:0.3, ease:"power4.out"}, ${(mid + 0.25).toFixed(3)});`,
      `tl.from(${q("#" + id + "-truth")}, {y:30, opacity:0, duration:0.35}, ${(mid + 0.45).toFixed(3)});`,
      drift("#" + id + "-vis", t0, dur),
    ].join("\n");
    return { html, js };
  },

  cta(beat, ctx) {
    const { t0, dur, spec } = ctx;
    const id = beat.id;
    const p = beat.props;
    const html = `
      <div class="visual" id="${id}-vis">
        <div class="small cta-small">comment</div>
        <div class="keyword" id="${id}-kw">${esc(spec.cta.keyword)}</div>
        <div class="bubble" id="${id}-bubble"><b>you</b>&nbsp; ${esc(spec.cta.keyword)}</div>
        ${p.sub ? `<div class="sub" id="${id}-sub">${esc(p.sub)}</div>` : ""}
      </div>`;
    const js = [
      `tl.from(${q("#" + id + "-kw")}, {scale:0.3, opacity:0, duration:0.4, ease:"back.out(2.2)"}, ${(t0 + 0.1).toFixed(3)});`,
      `tl.fromTo(${q("#" + id + "-kw")}, {scale:1}, {scale:1.07, duration:0.45, yoyo:true, repeat:${Math.max(1, Math.floor((dur - 0.6) / 0.45))}, ease:"sine.inOut"}, ${(t0 + 0.55).toFixed(3)});`,
      `tl.from(${q("#" + id + "-bubble")}, {x:200, opacity:0, duration:0.35, ease:"power3.out"}, ${(t0 + 0.6).toFixed(3)});`,
      p.sub ? `tl.from(${q("#" + id + "-sub")}, {y:30, opacity:0, duration:0.3}, ${(t0 + 0.9).toFixed(3)});` : "",
    ].join("\n");
    return { html, js };
  },
};

export default scenes;

export function styles(brand) {
  const c = brand.colors, f = brand.fonts;
  return `
  @property --n { syntax: "<integer>"; inherits: false; initial-value: 0; }
  :root { --ground:${c.ground}; --ink:${c.ink}; --muted:${c.muted}; --dark:${c.dark}; --dark-ink:${c.dark_ink};
          --accent:${c.accent}; --accent-ink:${c.accent_ink}; --display:${f.display}; --emph:${f.emphasis}; --mono:${f.mono}; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1080px; height:1920px; overflow:hidden; background:var(--ground); }
  #root { position:relative; width:1080px; height:1920px; font-family:var(--display); }
  .clip { position:absolute; inset:0; }
  .bg { position:absolute; inset:0; }
  .theme-light { --fg:var(--ink); --fg2:var(--muted); --bgc:var(--ground); }
  .theme-dark { --fg:var(--dark-ink); --fg2:#9a978f; --bgc:var(--dark); }
  .theme-accent { --fg:var(--accent-ink); --fg2:var(--accent-ink); --bgc:var(--accent); }
  .bg { background:var(--bgc);
        background-image: radial-gradient(circle, rgba(127,127,127,.14) 1.4px, transparent 1.6px); background-size:28px 28px; }
  .scene { color:var(--fg); }
  .chapter { position:absolute; left:80px; top:170px; font:500 30px var(--mono); color:var(--fg2); letter-spacing:.02em; }
  .progress { position:absolute; right:140px; top:170px; font:600 30px var(--mono); color:var(--accent); }
  .theme-accent .progress { color:var(--accent-ink); }
  .logo { position:absolute; left:80px; top:1420px; padding:10px 18px; border:3px solid var(--fg); border-radius:10px;
          font:800 30px var(--display); letter-spacing:.06em; color:var(--fg); }
  .caption { position:absolute; left:80px; right:140px; top:300px; font-weight:700; font-size:76px; line-height:1.12;
             letter-spacing:-.02em; color:var(--fg); }
  .w { display:inline-block; transform-origin:50% 70%; }
  .em { font-family:var(--emph); font-style:italic; font-weight:500; color:var(--accent); }
  .theme-accent .em { color:var(--accent-ink); text-decoration:underline; text-decoration-thickness:6px; }
  .visual { position:absolute; left:80px; right:140px; top:720px; height:660px; display:flex; flex-direction:column;
            align-items:center; justify-content:center; text-align:center; }
  .tag { display:inline-block; padding:12px 24px; background:var(--accent); color:var(--accent-ink); border-radius:10px;
         font:700 30px var(--mono); letter-spacing:.06em; margin-bottom:36px; }
  .dark-tag { background:var(--fg); color:var(--bgc); align-self:flex-start; margin-bottom:20px; }
  .hook-title { font-weight:900; font-size:150px; letter-spacing:-.04em; line-height:1; }
  .bar { width:560px; height:18px; background:var(--accent); margin-top:28px; transform-origin:left center; border-radius:9px; }
  .big { font-weight:900; font-size:260px; letter-spacing:-.05em; line-height:1; color:var(--accent); position:relative; z-index:1; }
  .ring { position:absolute; width:620px; height:620px; border:6px dashed var(--fg2); border-radius:50%; opacity:.5; }
  .sub { font-size:46px; font-weight:600; margin-top:36px; color:var(--fg); position:relative; z-index:1; }
  .counter { font-weight:900; font-size:300px; letter-spacing:-.05em; line-height:1; color:var(--accent); display:flex; align-items:baseline; }
  .num { counter-reset:n var(--n); display:inline-block; }
  .num::after { content: counter(n); }
  .affix { font-size:150px; }
  .meter { width:620px; height:22px; border-radius:11px; background:rgba(127,127,127,.25); margin-top:36px; overflow:hidden; }
  .meter-fill { width:100%; height:100%; background:var(--accent); transform-origin:left center; }
  .card { width:100%; background:var(--bgc); border:4px solid var(--fg); border-radius:28px; padding:44px 48px;
          box-shadow:14px 14px 0 var(--fg); text-align:left; display:flex; flex-direction:column; }
  .theme-dark .card { background:#1c1d20; }
  .card-title { font:600 30px var(--mono); color:var(--fg2); margin-bottom:22px; text-transform:uppercase; }
  .item { display:flex; align-items:center; gap:28px; font-size:58px; font-weight:700; padding:14px 0; }
  .box { width:66px; height:66px; border:5px solid var(--fg); border-radius:14px; display:flex; align-items:center; justify-content:center; flex:none; }
  .tick { color:var(--accent); font-size:54px; font-weight:900; display:inline-block; }
  .small { font:500 34px var(--mono); color:var(--fg2); margin-bottom:12px; }
  .myth-text { position:relative; font-size:64px; font-weight:800; line-height:1.1; align-self:flex-start; }
  .strike { position:absolute; left:-8px; right:-8px; top:52%; height:10px; background:var(--accent); transform-origin:left center; }
  .truth { font-family:var(--emph); font-style:italic; font-size:58px; color:var(--accent); margin-top:30px; line-height:1.15; }
  .stamp { position:absolute; right:10px; top:40px; padding:10px 26px; border:8px solid var(--accent); color:var(--accent);
           font:900 64px var(--display); letter-spacing:.08em; border-radius:12px; }
  .cta-small { font-size:44px; color:var(--fg); }
  .keyword { font-weight:900; font-size:230px; letter-spacing:-.03em; line-height:1; padding:10px 50px; background:var(--accent-ink);
             color:var(--accent); border-radius:36px; }
  .bubble { margin-top:56px; background:#fff; color:#111; border-radius:40px; padding:22px 40px; font-size:44px; box-shadow:8px 8px 0 #111; }
  `;
}

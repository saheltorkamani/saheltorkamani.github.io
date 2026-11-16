const N = DATA.x.length, K = 3, GRID = 84;
const PAPER_T = [0.2, 0.5, 1, 3, 5, 10];
const T_MIN = 0.1, T_MAX = 30;
const orig = Int32Array.from(DATA.c);
let labels = Int32Array.from(DATA.c);

// square extent so distances are drawn isotropically
let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
for (let i = 0; i < N; i++) { xmn = Math.min(xmn, DATA.x[i]); xmx = Math.max(xmx, DATA.x[i]); ymn = Math.min(ymn, DATA.y[i]); ymx = Math.max(ymx, DATA.y[i]); }
const half = Math.max(xmx - xmn, ymx - ymn) / 2 + 1;
const cx = (xmn + xmx) / 2, cy = (ymn + ymx) / 2;
const EXT = [cx - half, cx + half, cy - half, cy + half];

const state = { t: 5, mode: 'global', view: '0', res: null, hover: -1 };

// ── colour ──────────────────────────────────────────────────────────────
function hex2rgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const delin = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
function toOklab([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b), m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b), s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s, 1.9779984951*l - 2.4285922050*m + 0.4505937099*s, 0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774*a + 0.2158037573*b) ** 3, m = (L - 0.1055613458*a - 0.0638541728*b) ** 3, s = (L - 0.0894841775*a - 1.2914855480*b) ** 3;
  return [4.0767416621*l - 3.3077115913*m + 0.2309699292*s, -1.2684380046*l + 2.6097574011*m - 0.3413193965*s, -0.0041960863*l - 0.7034186147*m + 1.7076147010*s].map(v => Math.round(Math.max(0, Math.min(1, delin(v))) * 255));
}
function lut(stops) {
  const labs = stops.map(s => toOklab(hex2rgb(s))), out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const p = i / 255 * (labs.length - 1), k = Math.min(labs.length - 2, Math.floor(p)), f = p - k;
    const c = fromOklab(labs[k].map((v, d) => v + (labs[k + 1][d] - v) * f));
    out.set(c, i * 3);
  }
  return out;
}
const RAMPS = {
  light: {
    seq: lut(['#f4f8fd', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']),
    div: lut(['#a8302d', '#e0716b', '#f2c9c3', '#eeeeec', '#c3daf5', '#5598e7', '#184f95']),
  },
  dark: {
    seq: lut(['#141b25', '#123259', '#1c5cab', '#3987e5', '#86b6ef', '#d6e7fc']),
    div: lut(['#f08a86', '#c25451', '#5e3532', '#34363a', '#28466b', '#3d7fd0', '#9ec5f4']),
  }
};
// atypicality ramp: index 0 = atypical (strong), 255 = typical (recedes)
RAMPS.light.atyp = lut(['#7a2a0b', '#b5461a', '#e06a36', '#f0a57f', '#f6dccb']);
RAMPS.dark.atyp = lut(['#ffb08a', '#f07a4f', '#c3532a', '#7a3a20', '#4a2a1d']);

function isDark() {
  const th = document.documentElement.getAttribute('data-theme');
  if (th === 'dark') return true; if (th === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
const ramps = () => RAMPS[isDark() ? 'dark' : 'light'];
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rgbAt = (L, u) => { const i = Math.max(0, Math.min(255, Math.round(u * 255))) * 3; return [L[i], L[i + 1], L[i + 2]]; };

// scales: value -> u in [0,1]
const clamp01 = v => Math.max(0, Math.min(1, v));
const LOG_LO = -2, LOG_HI = 2;
const vm = () => 'global';
function ratioU(v) { return vm() === 'global' ? clamp01(v) : clamp01((Math.log10(Math.max(v, 1e-4)) - LOG_LO) / (LOG_HI - LOG_LO)); }

// ── canvas plumbing ─────────────────────────────────────────────────────
const M = { l: 34, r: 8, t: 8, b: 28 };
function sizeCanvas(cv) {
  const w = cv.clientWidth || 400, plot = w - M.l - M.r, h = plot + M.t + M.b, dpr = window.devicePixelRatio || 1;
  cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, plot };
}
const sx = (x, plot) => M.l + (x - EXT[0]) / (EXT[1] - EXT[0]) * plot;
const sy = (y, plot) => M.t + (1 - (y - EXT[2]) / (EXT[3] - EXT[2])) * plot;

function drawAxes(ctx, plot) {
  const axis = tok('--axis'), muted = tok('--muted');
  ctx.strokeStyle = axis; ctx.lineWidth = 1;
  ctx.strokeRect(M.l + 0.5, M.t + 0.5, plot - 1, plot - 1);
  ctx.fillStyle = muted; ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let v = Math.ceil(EXT[0] / 2) * 2; v <= EXT[1]; v += 2) { const x = sx(v, plot); ctx.fillRect(x, M.t + plot, 1, 4); ctx.fillText(v, x, M.t + plot + 6); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(EXT[2] / 2) * 2; v <= EXT[3]; v += 2) { const y = sy(v, plot); ctx.fillRect(M.l - 4, y, 4, 1); ctx.fillText(v, M.l - 7, y); }
  ctx.font = 'italic 12px "IBM Plex Sans", system-ui, sans-serif'; ctx.fillStyle = tok('--fg-2');
  ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('x₁', M.l + plot, M.t + plot + 15);
  ctx.save(); ctx.translate(10, M.t); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText('x₂', 0, -4); ctx.restore();
}

function marker(ctx, c, x, y, r) {
  ctx.beginPath();
  if (c === 0) ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (c === 1) { const s = r * 0.88; ctx.rect(x - s, y - s, 2 * s, 2 * s); }
  else { const s = r * 1.25; ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.92, y + s * 0.62); ctx.lineTo(x - s * 0.92, y + s * 0.62); ctx.closePath(); }
}

// heatmap offscreen
const off = document.createElement('canvas'); off.width = GRID; off.height = GRID;
function fieldValues() {
  const r = state.res, G = GRID * GRID;
  if (state.view === 'g') return { vals: r.gridAll, kind: 'pot' };
  const c = +state.view, vals = new Float32Array(G);
  const den = vm() === 'global' ? r.gridAll : r.gridOut.subarray(c * G, (c + 1) * G);
  for (let g = 0; g < G; g++) vals[g] = r.gridIn[c * G + g] / (den[g] + 1e-8);
  return { vals, kind: vm() === 'global' ? 'seq' : 'div' };
}
let potMax = 1;
function fieldColor(v, kind) {
  const R = ramps();
  if (kind === 'pot') return rgbAt(R.seq, clamp01(v / potMax));
  if (kind === 'seq') return rgbAt(R.seq, clamp01(v));
  return rgbAt(R.div, ratioU(v));
}
function renderHeat() {
  const { vals, kind } = fieldValues();
  if (kind === 'pot') { const s = Array.from(vals).sort((a, b) => a - b); potMax = Math.max(1e-6, s[Math.floor(s.length * 0.995)]); }
  const ctx = off.getContext('2d'), img = ctx.createImageData(GRID, GRID);
  for (let iy = 0; iy < GRID; iy++) for (let ix = 0; ix < GRID; ix++) {
    const v = vals[iy * GRID + ix], [r, g, b] = fieldColor(v, kind), o = ((GRID - 1 - iy) * GRID + ix) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return kind;
}

const cA = document.getElementById('cA'), cB = document.getElementById('cB');
let geomA = null, geomB = null;
function drawA() {
  const g = sizeCanvas(cA), { ctx, plot } = g; geomA = g;
  ctx.fillStyle = tok('--surface'); ctx.fillRect(0, 0, g.w, g.h);
  if (state.res) { ctx.imageSmoothingEnabled = true; ctx.drawImage(off, M.l, M.t, plot, plot); }
  const fg = tok('--fg'), muted = tok('--muted'), surf = tok('--surface');
  const sel = state.view === 'g' ? -1 : +state.view;
  // non-selected first
  ctx.lineWidth = 1;
  for (let i = 0; i < N; i++) {
    if (labels[i] === sel) continue;
    const x = sx(DATA.x[i], plot), y = sy(DATA.y[i], plot);
    if (sel === -1) { ctx.globalAlpha = 0.75; ctx.fillStyle = fg; marker(ctx, labels[i], x, y, 1.9); ctx.fill(); }
    else { ctx.globalAlpha = 0.55; ctx.strokeStyle = muted; marker(ctx, labels[i], x, y, 1.9); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  if (sel >= 0) for (let i = 0; i < N; i++) {
    if (labels[i] !== sel) continue;
    const x = sx(DATA.x[i], plot), y = sy(DATA.y[i], plot);
    marker(ctx, sel, x, y, 2.6); ctx.fillStyle = fg; ctx.strokeStyle = surf; ctx.lineWidth = 0.9; ctx.fill(); ctx.stroke();
  }
  drawFlips(ctx, plot); drawHover(ctx, plot); drawAxes(ctx, plot);
}
function drawB() {
  const g = sizeCanvas(cB), { ctx, plot } = g; geomB = g;
  ctx.fillStyle = tok('--surface'); ctx.fillRect(0, 0, g.w, g.h);
  const ring = tok('--surface'), cols = [tok('--c0'), tok('--c1'), tok('--c2')];
  if (state.res) {
    const r = state.res.ratioG;
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => ratioU(r[b]) - ratioU(r[a]));
    for (const i of order) {
      const u = ratioU(r[i]), x = sx(DATA.x[i], plot), y = sy(DATA.y[i], plot);
      ctx.beginPath(); ctx.arc(x, y, ratioRadius(u), 0, Math.PI * 2);
      ctx.globalAlpha = 0.3 + 0.7 * (1 - u);
      ctx.fillStyle = cols[labels[i]]; ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 0.8; ctx.strokeStyle = ring; if (u < 0.85) ctx.stroke();
    }
  }
  drawFlips(ctx, plot); drawHover(ctx, plot); drawAxes(ctx, plot);
}
const ratioRadius = u => 2 + (1 - u) * 4.2;
function drawFlips(ctx, plot) {
  ctx.strokeStyle = tok('--fg'); ctx.lineWidth = 1.4; ctx.setLineDash([2.5, 2]);
  for (let i = 0; i < N; i++) if (labels[i] !== orig[i]) { ctx.beginPath(); ctx.arc(sx(DATA.x[i], plot), sy(DATA.y[i], plot), 8, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
}
function drawHover(ctx, plot) {
  const i = state.hover; if (i < 0) return;
  const x = sx(DATA.x[i], plot), y = sy(DATA.y[i], plot);
  ctx.lineWidth = 3; ctx.strokeStyle = tok('--surface'); ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.6; ctx.strokeStyle = tok('--fg'); ctx.stroke();
}

// colourbars
function drawBar(id, L, ticks, title) {
  const cv = document.getElementById(id), ctx = cv.getContext('2d'), w = cv.width;
  const img = ctx.createImageData(w, 1);
  for (let x = 0; x < w; x++) { const c = rgbAt(L, x / (w - 1)); img.data.set([c[0], c[1], c[2], 255], x * 4); }
  for (let y = 0; y < cv.height; y++) ctx.putImageData(img, 0, y);
  document.getElementById(id + 'Title').textContent = title;
  document.getElementById(id + 'Ticks').innerHTML = ticks.map(([u, s]) => `<span style="left:${u * 100}%">${s}</span>`).join('');
}
const LOG_TICKS = [[0, '0.01'], [0.25, '0.1'], [0.5, '1'], [0.75, '10'], [1, '100']];
const LIN_TICKS = [[0, '0'], [0.25, '0.25'], [0.5, '0.5'], [0.75, '0.75'], [1, '≥ 1']];
function renderLegends(kind) {
  const R = ramps();
  if (kind === 'pot') drawBar('cbarA', R.seq, [[0, '0'], [0.5, (potMax / 2).toFixed(2)], [1, potMax.toFixed(2)]], 'Global potential');
  else if (kind === 'seq') drawBar('cbarA', R.seq, LIN_TICKS, `MP ratio, class ${state.view}: in-class / global`);
  else drawBar('cbarA', R.div, LOG_TICKS, `MP ratio, class ${state.view}: in-class / out-of-class (log)`);
  document.getElementById('sizesB').innerHTML = [[0, '0'], [0.5, '0.5'], [1, '≥ 1']].map(([u, t]) => { const rr = ratioRadius(u); return `<span><svg width="${2 * rr + 2}" height="14" viewBox="${-rr - 1} -7 ${2 * rr + 2} 14" aria-hidden="true"><circle r="${rr}" fill="var(--fg-2)" fill-opacity="${0.3 + 0.7 * (1 - u)}"/></svg>${t}</span>`; }).join('');
  const shape = (c, filled) => `<svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">${c === 0 ? '<circle r="4"/>' : c === 1 ? '<rect x="-3.6" y="-3.6" width="7.2" height="7.2"/>' : '<path d="M0,-5 L4.6,3.1 L-4.6,3.1 Z"/>'}</svg>`;
  const fill = (c, mode) => shape(c).replace('<svg', `<svg fill="${mode === 'f' ? 'var(--fg)' : 'none'}" stroke="${mode === 'f' ? 'none' : 'var(--muted)'}" stroke-width="1.2"`);
  const sel = state.view;
  document.getElementById('keysA').innerHTML = [0, 1, 2].map(c => `<span class="key">${fill(c, sel === 'g' || +sel === c ? 'f' : 'o')}class ${c}</span>`).join('');
  document.getElementById('keysB').innerHTML = [0, 1, 2].map(c => `<span class="key"><svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true"><circle r="4.5" fill="var(--c${c})"/></svg>class ${c}</span>`).join('') + `<span class="key"><svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="5.5" fill="none" stroke="var(--fg)" stroke-width="1.4" stroke-dasharray="2.5 2"/></svg>relabelled</span>`;
}

// histogram
const BINS = 20;
function renderHist() {
  const svg = document.getElementById('hist'); if (!state.res) return;
  const r = vm() === 'global' ? state.res.ratioG : state.res.ratioO;
  const counts = new Array(BINS).fill(0), byC = Array.from({ length: BINS }, () => [0, 0, 0]);
  for (let i = 0; i < N; i++) { const b = Math.min(BINS - 1, Math.floor(ratioU(r[i]) * BINS)); counts[b]++; byC[b][labels[i]]++; }
  const W = 560, H = 200, l = 40, rt = 8, tp = 10, bt = 26, pw = W - l - rt, ph = H - tp - bt;
  const maxC = Math.max(...counts), step = maxC > 600 ? 200 : maxC > 300 ? 100 : maxC > 120 ? 50 : maxC > 50 ? 20 : 10, top = Math.ceil(maxC / step) * step || step;
  const R = ramps(); let s = '';
  for (let v = 0; v <= top; v += step) { const y = tp + ph - v / top * ph; s += `<line x1="${l}" x2="${W - rt}" y1="${y}" y2="${y}" stroke="var(--hair)" stroke-width="1"/><text x="${l - 6}" y="${y + 4}" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="var(--muted)">${v}</text>`; }
  const bw = pw / BINS;
  counts.forEach((c, b) => {
    const x = l + b * bw + 1, w = bw - 2;
    const lo = (b / BINS).toFixed(2), hi = ((b + 1) / BINS).toFixed(2);
    const label = b === 0 ? `< ${hi}` : b === BINS - 1 ? `≥ ${lo}` : `${lo} – ${hi}`;
    s += `<g class="bar" data-tip="${label}|${c}|${byC[b].join(',')}"><rect x="${l + b * bw}" y="${tp}" width="${bw}" height="${ph}" fill="transparent"/>`;
    let y0 = tp + ph; const segs = [0, 1, 2].filter(k => byC[b][k] > 0);
    segs.forEach((k, si) => {
      const h = byC[b][k] / top * ph, y = y0 - h, last = si === segs.length - 1, gap = si > 0 ? 1 : 0, rr = last ? Math.min(3, h - gap, w / 2) : 0;
      const yb = y0 - gap;
      if (h - gap > 0.2) s += rr > 0.5 ? `<path d="M${x},${yb} V${y + rr} q0,-${rr} ${rr},-${rr} H${x + w - rr} q${rr},0 ${rr},${rr} V${yb} Z" fill="var(--c${k})"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${yb - y}" fill="var(--c${k})"/>`;
      y0 = y;
    });
    s += `</g>`;
  });
  s += `<line x1="${l}" x2="${W - rt}" y1="${tp + ph}" y2="${tp + ph}" stroke="var(--axis)"/>`;
  (vm() === 'global' ? LIN_TICKS : LOG_TICKS).forEach(([u, t]) => { s += `<text x="${l + u * pw}" y="${H - 8}" text-anchor="${u === 0 ? 'start' : u === 1 ? 'end' : 'middle'}" font-size="11" font-family="var(--f-mono)" fill="var(--muted)">${t}</text>`; });
  svg.innerHTML = s;
  svg.querySelectorAll('.bar').forEach(g => {
    g.addEventListener('mousemove', ev => { const [lab, c, bc] = g.dataset.tip.split('|'), pc = bc.split(','); showTip(ev, `<b>Ratio ${lab}</b><div class="r"><span>points</span><span>${c} (${(c / N * 100).toFixed(1)}%)</span></div>` + pc.map((v, k) => `<div class="r"><span><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="var(--c${k})"/></svg> class ${k}</span><span>${v}</span></div>`).join('')); });
    g.addEventListener('mouseleave', hideTip);
  });
  document.getElementById('hSub').innerHTML = `All ${N.toLocaleString()} training points at <i>t</i> = ${fmtT(state.res.t)}`;
}

function renderStats() {
  const r = state.res; if (!r) return;
  const ratio = vm() === 'global' ? r.ratioG : r.ratioO, thr = vm() === 'global' ? 0.5 : 1;
  let low = 0; for (let i = 0; i < N; i++) if (ratio[i] < thr) low++;
  const counts = [0, 0, 0]; for (let i = 0; i < N; i++) counts[labels[i]]++;
  let s = `<div class="stat"><span class="k">Whole dataset</span><span class="v">${r.magAll.toFixed(1)}</span><span class="s">of ${N} points</span></div>`;
  for (let c = 0; c < K; c++) s += `<div class="stat"><span class="k">Class ${c}</span><span class="v">${r.magClass[c].toFixed(1)}</span><span class="s">of ${counts[c]} points</span></div>`;
  s += `<div class="stat wide"><span class="k">Points flagged (ratio &lt; ${thr})</span><span class="v">${low} <span style="font-size:14px;color:var(--muted)">${(low / N * 100).toFixed(1)}%</span></span><span class="s">${vm() === 'global' ? 'Sparse in their own class relative to the whole dataset' : 'Surrounded more by other classes than by their own'}</span></div>`;
  document.getElementById('stats').innerHTML = s;
}

function renderAll() {
  if (!state.res) { drawA(); drawB(); return; }
  const kind = renderHeat(); drawA(); drawB(); renderLegends(kind); renderHist(); renderStats();
  const cls = state.view === 'g' ? null : state.view;
  document.getElementById('aSub').textContent = cls === null ? 'Global potential of the whole dataset across the plane' : `MP ratio of class ${cls} (${vm() === 'global' ? 'in-class / global' : 'in-class / out-of-class'}) across the plane`;
}

// ── tooltip + hover/click ───────────────────────────────────────────────
const tip = document.getElementById('tip');
function showTip(ev, html) {
  tip.innerHTML = html; tip.hidden = false;
  const pad = 14, tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = ev.pageX + pad, y = ev.pageY + pad;
  if (x + tw > window.scrollX + document.documentElement.clientWidth - 8) x = ev.pageX - tw - pad;
  if (y + th > window.scrollY + window.innerHeight - 8) y = ev.pageY - th - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { tip.hidden = true; }
function nearest(cv, geom, ev) {
  if (!geom) return -1;
  const rect = cv.getBoundingClientRect(), mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  let best = -1, bd = 12 * 12;
  for (let i = 0; i < N; i++) { const dx = sx(DATA.x[i], geom.plot) - mx, dy = sy(DATA.y[i], geom.plot) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  return best;
}
const f3 = v => Math.abs(v) >= 1000 ? v.toExponential(2) : Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(2) : v.toFixed(3);
function pointTip(i) {
  const r = state.res; if (!r) return '';
  const flipped = labels[i] !== orig[i] ? `<div class="r"><span>original class</span><span>${orig[i]}</span></div>` : '';
  return `<b>Point ${i} · class ${labels[i]}</b>${flipped}
    <div class="r"><span>MP ratio</span><span>${f3(r.ratioG[i])}</span></div>
    <div class="r"><span>in-class potential</span><span>${f3(r.inPot[i])}</span></div>
    <div class="r"><span>global potential</span><span>${f3(r.globPot[i])}</span></div>
    <div style="margin-top:4px;color:var(--muted)">Click to change class</div>`;
}
[[cA, () => geomA], [cB, () => geomB]].forEach(([cv, geom]) => {
  cv.addEventListener('mousemove', ev => {
    const i = nearest(cv, geom(), ev);
    if (i !== state.hover) { state.hover = i; drawA(); drawB(); }
    if (i >= 0) showTip(ev, pointTip(i)); else hideTip();
  });
  cv.addEventListener('mouseleave', () => { state.hover = -1; hideTip(); drawA(); drawB(); });
  cv.addEventListener('click', ev => {
    const i = nearest(cv, geom(), ev); if (i < 0) return;
    labels[i] = (labels[i] + 1) % K;
    document.getElementById('resetBtn').disabled = !labels.some((v, j) => v !== orig[j]);
    state.hover = i; drawA(); drawB(); request();
  });
});
document.getElementById('resetBtn').addEventListener('click', e => { labels = Int32Array.from(orig); e.currentTarget.disabled = true; request(); });

// ── controls ────────────────────────────────────────────────────────────
const slider = document.getElementById('tslider');
const toSlider = t => Math.round((Math.log10(t) - Math.log10(T_MIN)) / (Math.log10(T_MAX) - Math.log10(T_MIN)) * 1000);
const fromSlider = v => 10 ** (Math.log10(T_MIN) + v / 1000 * (Math.log10(T_MAX) - Math.log10(T_MIN)));
const fmtT = t => t < 1 ? t.toFixed(3) : t < 10 ? t.toFixed(2) : t.toFixed(1);
// place scale labels at their true log positions
(() => { const sc = document.querySelector('.scale'); sc.style.position = 'relative'; sc.style.height = '14px'; sc.innerHTML = [0.1, 0.3, 1, 3, 10, 30].map(v => { const u = toSlider(v) / 10; return `<span style="position:absolute;left:${u}%;transform:translateX(${u === 0 ? 0 : u === 100 ? -100 : -50}%)">${v}</span>`; }).join(''); })();
const chips = document.getElementById('chips');
PAPER_T.forEach(v => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = v; b.dataset.t = v; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => setT(v)); chips.appendChild(b); });
function setT(t, fromInput) {
  state.t = t; if (!fromInput) slider.value = toSlider(t);
  document.getElementById('tval').innerHTML = `<em>t</em>=&nbsp;${fmtT(t)}`;
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', Math.abs(+c.dataset.t - t) / t < 0.004 ? 'true' : 'false'));
  request();
}
slider.addEventListener('input', () => setT(fromSlider(+slider.value), true));
function segBind(id, key, attr) {
  const seg = document.getElementById(id);
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    seg.querySelectorAll('button').forEach(o => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
    state[key] = b.dataset[attr]; renderAll();
  }));
}
segBind('viewSeg', 'view', 'view');

// ── worker ──────────────────────────────────────────────────────────────
const worker = new Worker(URL.createObjectURL(new Blob([document.getElementById('worker-src').textContent], { type: 'text/javascript' })));
let seq = 0;
const statusEl = document.getElementById('status'), statusText = document.getElementById('statusText');
function setBusy(b, txt) { statusEl.classList.toggle('busy', b); statusText.textContent = txt; }
function request() { setBusy(true, 'Computing…'); worker.postMessage({ type: 'compute', t: state.t, labels: Int32Array.from(labels), K, seq: ++seq }); }
worker.onmessage = e => {
  const m = e.data;
  if (m.type !== 'result') return;
  state.res = m; renderAll();
  if (m.seq === seq) setBusy(false, `Computed in ${Math.round(m.ms)} ms`);
};
worker.onerror = () => setBusy(false, 'Computation failed. Try another t.');
const Xf = new Float64Array(2 * N); for (let i = 0; i < N; i++) { Xf[2 * i] = DATA.x[i]; Xf[2 * i + 1] = DATA.y[i]; }
worker.postMessage({ type: 'init', X: Xf, grid: GRID, extent: EXT });

// theme + resize
const rerender = () => renderAll();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender);
new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(rerender, 80); });
document.fonts && document.fonts.ready.then(rerender);

setT(5);
renderAll();

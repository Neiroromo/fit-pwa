// Линейный график по времени: одна или несколько серий (например, правая и левая рука).

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

export const SERIES_COLORS = ['var(--accent)', '#f59e0b', '#38bdf8'];

/**
 * series: [{color, pts: [{t, v}]}]; from/to — границы по времени (мс).
 * fmtDate(ms) → подпись даты, fmtNum(v) → подпись значения.
 */
export function lineChart({ series, from, to, fmtDate, fmtNum, unit = '' }) {
  const W = 520, H = 210, L = 44, R = 14, T = 12, B = 28;
  const all = series.flatMap(s => s.pts.map(p => p.v));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { lo -= 1; hi += 1; } else { const pad = (hi - lo) * 0.12; lo -= pad; hi += pad; }
  const span = Math.max(1, to - from);
  const x = t => L + ((t - from) / span) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (let i = 0; i < 4; i++) {
    const v = lo + ((hi - lo) * i) / 3, yy = y(v);
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'grid' }), svgEl('text', { x: L - 6, y: yy + 4, class: 'lbl', 'text-anchor': 'end' }, fmtNum(v)));
  }
  svg.append(svgEl('text', { x: L, y: H - 8, class: 'lbl' }, fmtDate(from)), svgEl('text', { x: W - R, y: H - 8, class: 'lbl', 'text-anchor': 'end' }, fmtDate(to)));
  for (const s of series) {
    if (s.pts.length > 1) svg.append(svgEl('polyline', { points: s.pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'line', style: `stroke:${s.color}` }));
    for (const p of s.pts) {
      const c = svgEl('circle', { cx: x(p.t).toFixed(1), cy: y(p.v).toFixed(1), r: 3.6, class: 'dot', style: `fill:${s.color}` });
      c.append(svgEl('title', {}, `${fmtDate(p.t)}: ${fmtNum(p.v)}${unit}`));
      svg.append(c);
    }
  }
  return svg;
}

/** Мини-график без осей для виджета. */
export function sparkline(pts, { width = 120, height = 36 } = {}) {
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', preserveAspectRatio: 'none' });
  if (pts.length < 2) return svg;
  const ts = pts.map(p => p.t), vs = pts.map(p => p.v);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const x = t => 2 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 4);
  const y = v => 2 + (1 - (v - v0) / Math.max(1e-9, v1 - v0 || 1)) * (height - 4);
  svg.append(svgEl('polyline', { points: pts.map(p => `${x(p.t).toFixed(1)},${(v1 === v0 ? height / 2 : y(p.v)).toFixed(1)}`).join(' '), class: 'line' }));
  return svg;
}

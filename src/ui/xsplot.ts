// Cross-section plot: σ(E) on log-log axes, with zoom/pan and a hover readout.
import type { Dataset, Nuclide } from '../data';
import { fmtBarn, fmtEnergy, loadXs, xsAt, XS_REACTIONS, type XsCurve, type XsData } from '../xs';
import { $, el, label } from './dom';

const X_MIN = -5, X_MAX = Math.log10(2e7);
const KT = 0.0253; // eV, 293.6 K

export class XsPlot {
  private root = $('#xs');
  private canvas = $('#xsCanvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private data: XsData | null = null;
  private nu: Nuclide | null = null;
  private ds: Dataset | null = null;
  private on = new Map<number, boolean>();
  /** Reactions the user switched on or off, kept between nuclides. */
  private userOn = new Map<number, boolean>();
  private x0 = X_MIN;
  private x1 = X_MAX;
  private cursor: number | null = null;
  private hot: number | null = null;
  private drag: { x: number; x0: number; x1: number; moved: boolean } | null = null;
  private loading = 0;
  onPick: (nu: Nuclide) => void = () => {};

  constructor() {
    $('#xsClose').addEventListener('click', () => this.close());
    $('#xsReset').addEventListener('click', () => this.resetView());
    this.root.addEventListener('pointerdown', e => { if (e.target === this.root) this.close(); });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    const c = this.canvas;
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const lx = this.xAt(e.offsetX);
      const f = Math.exp((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0018);
      this.zoomAround(lx, f);
    }, { passive: false });
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { x: e.offsetX, x0: this.x0, x1: this.x1, moved: false };
    });
    c.addEventListener('pointermove', e => {
      const { left, right } = this.box();
      if (this.drag) {
        const dx = e.offsetX - this.drag.x;
        if (Math.abs(dx) > 2) this.drag.moved = true;
        const span = this.drag.x1 - this.drag.x0;
        let a = this.drag.x0 - (dx / (right - left)) * span;
        a = Math.min(Math.max(a, X_MIN), X_MAX - span);
        this.x0 = a; this.x1 = a + span;
        c.style.cursor = 'grabbing';
      }
      this.cursor = e.offsetX >= left && e.offsetX <= right ? e.offsetX : null;
      this.draw();
      this.renderSide();
    });
    const end = () => { this.drag = null; c.style.cursor = ''; this.updateReset(); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag) { this.cursor = null; this.draw(); this.renderSide(); } });
    c.addEventListener('dblclick', () => this.resetView());
  }

  get isOpen() { return !this.root.hidden; }
  close() { this.root.hidden = true; }
  redraw() { this.draw(); this.renderSide(); }

  async open(ds: Dataset, nu: Nuclide) {
    this.ds = ds;
    this.nu = nu;
    this.root.hidden = false;
    const title = $('#xsTitle');
    title.innerHTML = '';
    title.append('n + ', label(nu, ''), el('span', { class: 'dim' }, ' cross sections'));
    this.data = null;
    this.cursor = null;
    this.hot = null;
    this.x0 = X_MIN; this.x1 = X_MAX;
    this.updateReset();
    this.draw();
    $('#xsSide').innerHTML = '';
    $('#xsSide').append(el('div', { class: 'xs-msg' }, 'Loading…'));
    const id = ++this.loading;
    try {
      const d = await loadXs(nu.z, nu.n);
      if (id !== this.loading) return;
      this.data = d;
    } catch {
      if (id !== this.loading) return;
      $('#xsSide').innerHTML = '';
      $('#xsSide').append(el('div', { class: 'xs-msg' }, 'No ENDF/B-VIII.0 neutron data for this nuclide.'));
      return;
    }
    // Default: elastic, capture, fission, and any other reaction that reaches 0.1 b.
    this.on.clear();
    for (const c of this.data.curves) {
      const dflt = [2, 18, 102].includes(c.mt) || (c.mt !== 1 && c.mt !== 4 && c.peak >= -1);
      this.on.set(c.mt, this.userOn.get(c.mt) ?? dflt);
    }
    this.draw();
    this.renderSide();
  }

  private resetView() {
    this.x0 = X_MIN; this.x1 = X_MAX;
    this.updateReset();
    this.draw();
  }

  private updateReset() {
    ($('#xsReset') as HTMLButtonElement).hidden = this.x0 <= X_MIN + 1e-6 && this.x1 >= X_MAX - 1e-6;
  }

  private zoomAround(lx: number, f: number) {
    const span = Math.min(X_MAX - X_MIN, Math.max(0.004, (this.x1 - this.x0) * f));
    const t = (lx - this.x0) / (this.x1 - this.x0);
    let a = lx - t * span;
    a = Math.min(Math.max(a, X_MIN), X_MAX - span);
    this.x0 = a; this.x1 = a + span;
    this.updateReset();
    this.draw();
    this.renderSide();
  }

  private box() {
    const r = this.canvas.getBoundingClientRect();
    return { left: 64, right: r.width - 16, top: 26, bottom: r.height - 34, W: r.width, H: r.height };
  }

  private xAt(px: number) {
    const { left, right } = this.box();
    return this.x0 + ((px - left) / (right - left)) * (this.x1 - this.x0);
  }

  /** Y range fitted to what is visible in the current energy window. */
  private yRange(): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (const c of this.visible()) {
      const { a, b } = window_(c, this.x0, this.x1);
      for (let i = a; i <= b; i++) { const y = c.ly[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
      for (const x of [this.x0, this.x1]) { const y = xsAt(c, x); if (y != null) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
    }
    if (!isFinite(lo)) return [-3, 4];
    const zoomed = this.x1 - this.x0 < 3;
    let y1 = zoomed ? hi + 0.15 : Math.ceil(hi + 0.1);
    let y0 = zoomed ? lo - 0.15 : Math.floor(lo - 0.1);
    y0 = Math.max(y0, y1 - 8);
    if (y1 - y0 < 1) { const m = (y0 + y1) / 2; y0 = m - 0.5; y1 = m + 0.5; }
    return [y0, y1];
  }

  private visible() {
    return (this.data?.curves ?? []).filter(c => this.on.get(c.mt));
  }

  private draw() {
    if (this.root.hidden) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const box = this.box();
    const { W, H, left, right, top, bottom } = box;
    if (W <= 0 || H <= 0) return;
    if (this.canvas.width !== Math.round(W * dpr)) this.canvas.width = Math.round(W * dpr);
    if (this.canvas.height !== Math.round(H * dpr)) this.canvas.height = Math.round(H * dpr);
    const ctx = this.ctx;
    const st = getComputedStyle(document.documentElement);
    const col = (n: string) => st.getPropertyValue(n).trim();
    const FONT = col('--font') || 'system-ui, sans-serif';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col('--panel-solid');
    ctx.fillRect(0, 0, W, H);
    const [y0, y1] = this.yRange();
    const X = (lx: number) => left + ((lx - this.x0) / (this.x1 - this.x0)) * (right - left);
    const Y = (ly: number) => bottom - ((ly - y0) / (y1 - y0)) * (bottom - top);
    ctx.font = `11px ${FONT}`;

    // Resonance regions and neutron spectra, behind everything.
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    const d = this.data;
    const band = (r: [number, number], fill: string, text: string) => {
      const a = X(Math.log10(Math.max(r[0], 1e-5))), b = X(Math.log10(r[1]));
      if (b < left || a > right) return;
      ctx.fillStyle = fill;
      ctx.fillRect(a, top, b - a, bottom - top);
      const ca = Math.max(a, left), cb = Math.min(b, right);
      if (cb - ca > ctx.measureText(text).width + 12) {
        ctx.fillStyle = col('--text-dim'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(text, (ca + cb) / 2, top + 6);
      }
    };
    if (d) {
      for (const r of d.rr) band(r, col('--accent-soft'), 'Resolved resonances');
      for (const r of d.ur) band(r, withAlpha(col('--accent-soft'), 0.45), 'Unresolved');
    }
    // Spectrum humps (per unit lethargy), drawn faintly along the bottom.
    const hump = (f: (e: number) => number, peak: number, color: string, text: string, at: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      const h = (bottom - top) * 0.16;
      for (let px = left; px <= right; px += 2) {
        const e = 10 ** this.xAt(px);
        ctx.lineTo(px, bottom - (f(e) / peak) * h);
      }
      ctx.lineTo(right, bottom);
      ctx.fill();
      const x = X(Math.log10(at));
      if (x > left + 30 && x < right - 30) {
        ctx.fillStyle = col('--text-dim'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(text, x, bottom - h - 4);
      }
    };
    const maxw = (e: number) => (e / KT) ** 2 * Math.exp(-e / KT);
    const watt = (e: number) => { const m = e / 1e6; return m * Math.exp(-m / 0.988) * Math.sinh(Math.sqrt(2.249 * m)); };
    hump(maxw, maxw(2 * KT), withAlpha(col('--text-dim'), 0.12), 'thermal neutrons', 2 * KT);
    hump(watt, watt(1.6e6), withAlpha('#ff6b4a', 0.12), 'fission neutrons', 1.6e6);
    ctx.restore();

    // Grid and axes
    ctx.strokeStyle = col('--line');
    ctx.fillStyle = col('--text-dim');
    ctx.lineWidth = 1;
    const ySpan = y1 - y0;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const [ly, lab, major] of ticks(y0, y1, (bottom - top) / ySpan, v => fmtBarn(v, 2))) {
      const y = Math.round(Y(ly)) + 0.5;
      ctx.globalAlpha = major ? 1 : 0.45;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.globalAlpha = 1;
      if (lab) ctx.fillText(lab, left - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const [lx, lab, major] of ticks(this.x0, this.x1, (right - left) / (this.x1 - this.x0), v => fmtEnergy(v, 2), 54)) {
      const x = Math.round(X(lx)) + 0.5;
      ctx.globalAlpha = major ? 1 : 0.45;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.globalAlpha = 1;
      if (lab) ctx.fillText(lab, x, bottom + 8);
    }
    // Reference energies used elsewhere in the app.
    const mark = (e: number, text: string) => {
      const x = X(Math.log10(e));
      if (x < left || x > right) return;
      ctx.save();
      ctx.strokeStyle = col('--text-dim'); ctx.globalAlpha = 0.7; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = col('--text-dim'); ctx.textBaseline = 'bottom';
      ctx.textAlign = x > right - 40 ? 'right' : x < left + 40 ? 'left' : 'center';
      ctx.fillText(text, x, top - 6);
    };
    mark(0.0253, '0.0253 eV');
    mark(14.1e6, '14 MeV');

    // Curves
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top - 1, right - left, bottom - top + 2); ctx.clip();
    ctx.lineJoin = 'round';
    const curves = this.visible();
    const order = [...curves].sort((a, b) => (a.mt === this.hot ? 1 : 0) - (b.mt === this.hot ? 1 : 0));
    for (const c of order) {
      const info = XS_REACTIONS[c.mt];
      const hot = this.hot === c.mt;
      ctx.globalAlpha = this.hot == null || hot ? 1 : 0.28;
      ctx.strokeStyle = info?.color || col('--text');
      ctx.lineWidth = hot ? 2.4 : c.mt === 1 ? 1.2 : 1.5;
      ctx.setLineDash(c.mt === 1 ? [5, 4] : []);
      ctx.beginPath();
      const { a, b } = window_(c, this.x0, this.x1);
      const i0 = Math.max(0, a - 1), i1 = Math.min(c.lx.length - 1, b + 1);
      // Several points per pixel at full zoom-out: keep each pixel column's min and max.
      let lastPx = NaN, mn = 0, mx = 0, first = true;
      const flush = () => {
        if (Number.isNaN(lastPx)) return;
        if (first) { ctx.moveTo(lastPx, mn); first = false; } else ctx.lineTo(lastPx, mn);
        if (mx !== mn) ctx.lineTo(lastPx, mx);
      };
      for (let i = i0; i <= i1; i++) {
        const px = Math.round(X(c.lx[i]) * 2) / 2;
        const py = Y(c.ly[i]);
        if (px !== lastPx) { flush(); lastPx = px; mn = py; mx = py; }
        else { mn = Math.max(mn, py); mx = Math.min(mx, py); }
      }
      flush();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    // Cursor
    if (this.cursor != null && d) {
      const lx = this.xAt(this.cursor);
      ctx.strokeStyle = col('--text-dim'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.cursor + 0.5, top); ctx.lineTo(this.cursor + 0.5, bottom); ctx.stroke();
      for (const c of curves) {
        const ly = xsAt(c, lx);
        if (ly == null || ly < y0 || ly > y1) continue;
        ctx.fillStyle = XS_REACTIONS[c.mt]?.color || col('--text');
        ctx.beginPath(); ctx.arc(this.cursor, Y(ly), 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Axis titles
    ctx.fillStyle = col('--text-dim');
    ctx.save();
    ctx.translate(14, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Cross section', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('Neutron energy →', left, H - 2);
    if (!d) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Loading…', (left + right) / 2, (top + bottom) / 2);
    }
  }

  private renderSide() {
    const side = $('#xsSide');
    const d = this.data, nu = this.nu;
    if (!d || !nu || !this.ds) return;
    side.innerHTML = '';
    const lx = this.cursor != null ? this.xAt(this.cursor) : null;
    const head = el('div', { class: 'sim-time' });
    if (lx != null) {
      const e = 10 ** lx;
      head.append(fmtEnergy(e), el('small', {}, region(d, e)));
    } else head.append('Hover the plot', el('small', {}, 'scroll to zoom · drag to pan · double-click resets'));
    side.append(head);
    const ol = el('ol', { class: 'sim-legend xs-legend' });
    for (const c of d.curves) {
      const info = XS_REACTIONS[c.mt];
      if (!info) continue;
      const on = !!this.on.get(c.mt);
      const v = lx != null ? xsAt(c, lx) : null;
      const prod = info.dz || info.dn ? this.ds.get(nu.z + info.dz, nu.n + info.dn) : null;
      const name = el('span', { class: 'nm' }, el('b', {}, `(${info.label})`), info.name ? ` ${info.name}` : '');
      if (prod) name.append(el('small', {}, ' → ', label(prod, '')));
      const li = el('li', { class: (on ? '' : 'off ') + (this.hot === c.mt ? 'hot' : '') },
        el('i', { style: `background:${info.color || 'var(--text)'}` }),
        name,
        el('span', { class: 'v' }, v != null ? fmtBarn(10 ** v) : on ? '' : 'off'));
      li.title = 'Click to show or hide';
      li.addEventListener('click', e => {
        if ((e.shiftKey || e.metaKey || e.ctrlKey) && prod) { this.onPick(prod); return; }
        this.on.set(c.mt, !on);
        this.userOn.set(c.mt, !on);
        this.draw(); this.renderSide();
      });
      li.addEventListener('pointerenter', () => { if (on) { this.hot = c.mt; this.draw(); } });
      li.addEventListener('pointerleave', () => { this.hot = null; this.draw(); });
      ol.append(li);
    }
    side.append(ol);
    side.append(el('div', { class: 'xs-note' },
      `ENDF/B-VIII.0 at ${d.T} K. Resonances reconstructed and Doppler-broadened here, so expect small differences from processed libraries.`));
  }
}

/** Index range of a curve's points inside [x0, x1]. */
function window_(c: XsCurve, x0: number, x1: number) {
  const x = c.lx;
  let lo = 0, hi = x.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (x[m] < x0) lo = m + 1; else hi = m; }
  const a = lo;
  hi = x.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (x[m] <= x1) lo = m + 1; else hi = m; }
  return { a, b: lo - 1 };
}

/** Tick positions on a log axis: decades, plus 2–9 subdivisions when zoomed in. */
function ticks(l0: number, l1: number, pxPerDecade: number, fmt: (v: number) => string, minLabelPx = 18): [number, string, boolean][] {
  const out: [number, string, boolean][] = [];
  const step = pxPerDecade < minLabelPx ? Math.ceil(minLabelPx / pxPerDecade) : 1;
  for (let e = Math.ceil(l0 - 1e-9); e <= l1 + 1e-9; e++) {
    out.push([e, e % step === 0 ? fmt(10 ** e) : '', true]);
  }
  if (pxPerDecade > 140) {
    for (let e = Math.floor(l0); e <= l1; e++) {
      for (let m = 2; m <= 9; m++) {
        const v = e + Math.log10(m);
        if (v < l0 || v > l1) continue;
        const gap = pxPerDecade * (Math.log10(m) - Math.log10(m - 1));
        const lab = pxPerDecade > 900 || (gap > minLabelPx * 1.1 && (m === 2 || m === 5 || pxPerDecade > 420)) ? fmt(10 ** v) : '';
        out.push([v, lab, false]);
      }
    }
  }
  return out;
}

function region(d: XsData, e: number) {
  if (d.rr.some(([a, b]) => e >= a && e <= b)) return 'resolved resonance region';
  if (d.ur.some(([a, b]) => e >= a && e <= b)) return 'unresolved resonances (averaged)';
  if (e < 0.5) return 'thermal and epithermal';
  if (e < 1e5) return 'epithermal';
  return 'fast';
}

function withAlpha(color: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const r = /^rgba?\(([^)]+)\)$/.exec(color);
  if (r) {
    const p = r[1].split(',').map(s => s.trim());
    const base = p.length > 3 ? +p[3] : 1;
    return `rgba(${p[0]},${p[1]},${p[2]},${base * a})`;
  }
  return color;
}


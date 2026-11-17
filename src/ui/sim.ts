// Decay simulation modal: Bateman solution plotted on log-log axes.
import type { Nuclide } from '../data';
import type { SimInput, SimOutput } from '../bateman';
import { fmtNum, fmtTime } from '../colors';
import { $, el, label } from './dom';

const PALETTE = ['#6aa8ff', '#f5c73b', '#e8577e', '#3fbf73', '#a07ae0', '#f39237', '#2ec4c4', '#ff7ab8', '#9fd356', '#c9a27a', '#7aa6c2', '#e07b6b', '#b8b8ff', '#ffd8a8', '#5fd3a5', '#d07ad0'];
const NPTS = 260;

interface Series { nu: Nuclide; color: string; values: Float64Array; peak: number; on: boolean }

let worker: Worker | null = null;
let reqId = 0;
function getWorker() {
  worker ??= new Worker(new URL('../bateman.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export class SimModal {
  private root = $('#sim');
  private canvas = $('#simCanvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private qty: 'activity' | 'atoms' = 'activity';
  private nodes: Nuclide[] = [];
  private input: SimInput | null = null;
  private out: SimOutput | null = null;
  private times: number[] = [];
  private series: Series[] = [];
  private total: Float64Array | null = null;
  private norm = 1;
  private cursor: number | null = null;
  private hot: number | null = null;
  private t0 = 0;
  private t1 = 10;
  private pending = 0;
  private hidden = new Set<number>();
  private perFission = false;
  onPick: (nu: Nuclide) => void = () => {};

  constructor() {
    $('#simClose').addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', e => { if (e.target === this.root) this.close(); });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('#simQty button')) {
      b.addEventListener('click', () => {
        this.qty = b.dataset.q as 'activity' | 'atoms';
        this.root.querySelectorAll('#simQty button').forEach(x => x.classList.toggle('on', x === b));
        this.buildSeries();
        this.draw();
      });
    }
    const s0 = $('#simT0') as HTMLInputElement, s1 = $('#simT1') as HTMLInputElement;
    const onRange = () => {
      let a = +s0.value, b = +s1.value;
      if (b - a < 0.5) { if (document.activeElement === s0) a = b - 0.5; else b = a + 0.5; s0.value = String(a); s1.value = String(b); }
      this.t0 = a; this.t1 = b;
      this.updateRangeLabels();
      this.schedule();
    };
    s0.addEventListener('input', onRange);
    s1.addEventListener('input', onRange);
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.canvas.addEventListener('pointermove', e => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const { left, right } = this.plotBox();
      this.cursor = x >= left && x <= right ? x : null;
      this.draw();
      this.renderLegend();
    });
    this.canvas.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); this.renderLegend(); });
  }

  get isOpen() { return !this.root.hidden; }

  close() { this.root.hidden = true; }

  /** Open a simulation: nodes in any order, initial inventory per node. */
  open(title: string, nodes: Nuclide[], n0: Map<number, number>, opts: { perFission?: boolean; t0?: number; t1?: number } = {}) {
    this.root.hidden = false;
    $('#simTitle').textContent = title;
    this.perFission = !!opts.perFission;
    this.hidden.clear();
    // Topological order over the union graph.
    const inSet = new Set(nodes.map(n => n.idx));
    const indeg = new Map<number, number>();
    for (const nu of nodes) indeg.set(nu.idx, 0);
    for (const nu of nodes) for (const b of nu.branches) if (b.target && b.target !== nu && inSet.has(b.target.idx)) indeg.set(b.target.idx, indeg.get(b.target.idx)! + 1);
    const order: Nuclide[] = [];
    const q = nodes.filter(n => indeg.get(n.idx) === 0);
    const placed = new Set<number>();
    while (q.length) {
      const nu = q.shift()!;
      if (placed.has(nu.idx)) continue;
      placed.add(nu.idx);
      order.push(nu);
      for (const b of nu.branches) {
        const t = b.target;
        if (!t || t === nu || !inSet.has(t.idx)) continue;
        const d = indeg.get(t.idx)! - 1;
        indeg.set(t.idx, d);
        if (d === 0) q.push(t);
      }
    }
    for (const nu of nodes) if (!placed.has(nu.idx)) order.push(nu);
    this.nodes = order;
    const pos = new Map(order.map((n, i) => [n.idx, i]));
    const simNodes = order.map(nu => ({ lambda: effLambda(nu), parents: [] as { i: number; b: number }[] }));
    order.forEach((nu, i) => {
      for (const b of nu.branches) {
        if (!b.target || b.target === nu) continue;
        const j = pos.get(b.target.idx);
        if (j != null && b.frac > 0) simNodes[j].parents.push({ i, b: b.frac });
      }
    });
    const n0arr = order.map(nu => n0.get(nu.idx) ?? 0);
    this.input = { nodes: simNodes, n0: n0arr, times: [] };

    // Normalisation: chain mode is relative to the head's initial activity / atoms.
    const head = order.find(nu => (n0.get(nu.idx) ?? 0) > 0);
    this.norm = 1;
    if (!this.perFission && head) this.norm = n0.get(head.idx)!;
    this.headLambda = head ? effLambda(head) : 1;

    // Default time range.
    const hls = order.filter(n => n.lambda > 0).map(n => Math.LN2 / effLambda(n));
    if (opts.t0 != null && opts.t1 != null) { this.t0 = opts.t0; this.t1 = opts.t1; }
    else if (head) {
      const hh = Math.LN2 / Math.max(effLambda(head), 1e-40);
      const minHl = Math.min(...hls.filter(h => h > 0), hh);
      this.t0 = clamp(Math.floor(Math.log10(Math.max(minHl * 0.05, 1e-9)) * 2) / 2, -9, 17);
      const maxHl = Math.max(...hls, hh);
      this.t1 = clamp(Math.ceil(Math.log10(Math.min(maxHl * 30, 1e18)) * 2) / 2, this.t0 + 1, 18);
    }
    ($('#simT0') as HTMLInputElement).value = String(this.t0);
    ($('#simT1') as HTMLInputElement).value = String(this.t1);
    this.updateRangeLabels();
    this.out = null;
    this.series = [];
    this.run();
  }

  private headLambda = 1;

  private updateRangeLabels() {
    $('#simT0o').textContent = fmtTime(10 ** this.t0, 2);
    $('#simT1o').textContent = fmtTime(10 ** this.t1, 2);
  }

  private timer = 0;
  private schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), 30);
  }

  private run() {
    if (!this.input) return;
    const times: number[] = [];
    for (let k = 0; k < NPTS; k++) times.push(10 ** (this.t0 + ((this.t1 - this.t0) * k) / (NPTS - 1)));
    const id = ++reqId;
    this.pending = id;
    const w = getWorker();
    const input = { ...this.input, times };
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (this.pending !== id) return;
      if (e.data.error) { console.error(e.data.error); return; }
      this.out = e.data.out;
      this.times = times;
      this.buildSeries();
      this.draw();
      this.renderLegend();
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, input });
  }

  private buildSeries() {
    if (!this.out) return;
    const src = this.qty === 'activity' ? this.out.activity : this.out.atoms;
    const scale = this.perFission ? 1 : this.qty === 'activity' ? 1 / (this.norm * this.headLambda) : 1 / this.norm;
    const all = this.nodes.map((nu, i) => {
      const v = new Float64Array(src[i].length);
      let peak = 0;
      for (let t = 0; t < v.length; t++) { v[t] = src[i][t] * scale; if (v[t] > peak) peak = v[t]; }
      return { nu, values: v, peak, color: '', on: true };
    }).filter(s => s.peak > 0 && (this.qty === 'atoms' || s.nu.lambda > 0));
    const tot = new Float64Array(this.times.length);
    for (const s of all) for (let t = 0; t < tot.length; t++) tot[t] += s.values[t];
    // Rank by the largest share of the total reached at any time, so that
    // long-lived products show up next to the short-lived early peaks.
    const share = new Map<Series, number>();
    for (const s of all) {
      let m = 0;
      for (let t = 0; t < tot.length; t++) if (tot[t] > 0) m = Math.max(m, s.values[t] / tot[t]);
      share.set(s, m);
    }
    const byShare = [...all].sort((a, b) => share.get(b)! - share.get(a)!);
    const byPeak = [...all].sort((a, b) => b.peak - a.peak);
    const N = this.perFission ? 14 : 16;
    const pick = new Set(byShare.slice(0, Math.ceil(N * 0.6)));
    for (const s of byPeak) { if (pick.size >= N) break; pick.add(s); }
    for (const s of byShare) { if (pick.size >= N) break; pick.add(s); }
    const top = [...pick].sort((a, b) => b.peak - a.peak);
    top.forEach((s, i) => { s.color = PALETTE[i % PALETTE.length]; s.on = !this.hidden.has(s.nu.idx); });
    this.series = top;
    this.total = this.qty === 'activity' ? tot : null;
  }

  private plotBox() {
    const r = this.canvas.getBoundingClientRect();
    return { left: 62, right: r.width - 18, top: 16, bottom: r.height - 34, W: r.width, H: r.height };
  }

  private draw() {
    if (this.root.hidden) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const box = this.plotBox();
    const { W, H } = box;
    if (this.canvas.width !== Math.round(W * dpr)) { this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr); }
    if (this.canvas.height !== Math.round(H * dpr)) this.canvas.height = Math.round(H * dpr);
    const ctx = this.ctx;
    const st = getComputedStyle(document.documentElement);
    const col = (n: string) => st.getPropertyValue(n).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col('--panel-solid');
    ctx.fillRect(0, 0, W, H);
    if (!this.out || !this.series.length) return;

    // Y range
    let ymax = 0;
    for (const s of this.series) if (s.on) ymax = Math.max(ymax, s.peak);
    if (this.total) for (const v of this.total) ymax = Math.max(ymax, v);
    if (!(ymax > 0)) ymax = 1;
    const y1 = Math.ceil(Math.log10(ymax) + 0.05);
    const y0 = y1 - (this.perFission ? 13 : 9);
    const { left, right, top, bottom } = box;
    const X = (lt: number) => left + ((lt - this.t0) / (this.t1 - this.t0)) * (right - left);
    const Y = (lv: number) => bottom - ((lv - y0) / (y1 - y0)) * (bottom - top);

    // Grid
    ctx.font = `11px ${FONT}`;
    ctx.strokeStyle = col('--line');
    ctx.fillStyle = col('--text-dim');
    ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let e = y0; e <= y1; e++) {
      const y = Math.round(Y(e)) + 0.5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      if ((e - y0) % (y1 - y0 > 10 ? 2 : 1) === 0) ctx.fillText(`1e${e}`, left - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const [t, lab] of timeTicks(this.t0, this.t1)) {
      const x = Math.round(X(Math.log10(t))) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillText(lab, x, bottom + 8);
    }

    // Lines
    ctx.save();
    ctx.beginPath(); ctx.rect(left, top - 2, right - left, bottom - top + 4); ctx.clip();
    const line = (v: Float64Array, color: string, w: number, dash: number[] = []) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
      ctx.beginPath();
      let pen = false;
      for (let k = 0; k < v.length; k++) {
        const x = X(this.t0 + ((this.t1 - this.t0) * k) / (v.length - 1));
        if (!(v[k] > 0)) { pen = false; continue; }
        const y = Y(Math.max(Math.log10(v[k]), y0 - 1));
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (this.total) line(this.total, col('--text'), 1.6, [5, 4]);
    for (let i = this.series.length - 1; i >= 0; i--) {
      const s = this.series[i];
      if (!s.on) continue;
      const hot = this.hot === s.nu.idx;
      ctx.globalAlpha = this.hot == null || hot ? 1 : 0.35;
      line(s.values, s.color, hot ? 3 : 1.8);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Cursor
    if (this.cursor != null) {
      ctx.strokeStyle = col('--text-dim');
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.cursor + 0.5, top); ctx.lineTo(this.cursor + 0.5, bottom); ctx.stroke();
      const k = this.cursorIndex();
      for (const s of this.series) {
        if (!s.on || !(s.values[k] > 0)) continue;
        const ly = Math.log10(s.values[k]);
        if (ly < y0) continue;
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(this.cursor, Y(ly), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Axis label
    ctx.save();
    ctx.translate(14, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col('--text-dim');
    ctx.fillText(this.axisLabel(), 0, 0);
    ctx.restore();
  }

  private axisLabel() {
    if (this.perFission) return this.qty === 'activity' ? 'Bq per fission' : 'Atoms per fission';
    return this.qty === 'activity' ? 'Activity / A₀ (parent)' : 'Atoms / N₀';
  }

  private cursorIndex() {
    const { left, right } = this.plotBox();
    if (this.cursor == null) return this.times.length - 1;
    return clamp(Math.round(((this.cursor - left) / (right - left)) * (NPTS - 1)), 0, NPTS - 1);
  }

  private renderLegend() {
    const k = this.cursorIndex();
    const t = this.times[k];
    const tEl = $('#simTime');
    tEl.innerHTML = '';
    tEl.append(fmtTime(t ?? 0, 3), el('small', {}, this.cursor == null ? 'end of range · hover plot' : this.axisLabel()));
    const ol = $('#simLegend');
    ol.innerHTML = '';
    if (this.total) {
      ol.append(el('li', {}, el('i', { style: `background:var(--text)` }), el('span', {}, 'Total'), el('span', { class: 'v' }, fmtNum(this.total[k] ?? 0, 3))));
    }
    const rows = [...this.series].sort((a, b) => (b.values[k] ?? 0) - (a.values[k] ?? 0));
    for (const s of rows) {
      const li = el('li', { class: (s.on ? '' : 'off ') + (this.hot === s.nu.idx ? 'hot' : '') },
        el('i', { style: `background:${s.color}` }),
        label(s.nu),
        el('span', { class: 'v' }, fmtNum(s.values[k] ?? 0, 3)));
      li.addEventListener('click', e => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) { this.onPick(s.nu); return; }
        s.on = !s.on;
        if (s.on) this.hidden.delete(s.nu.idx); else this.hidden.add(s.nu.idx);
        this.draw(); this.renderLegend();
      });
      li.addEventListener('pointerenter', () => { this.hot = s.nu.idx; this.draw(); });
      li.addEventListener('pointerleave', () => { this.hot = null; this.draw(); });
      ol.append(li);
    }
  }
}

/** Unknown half-lives in a chain are treated as prompt (1 µs). */
function effLambda(nu: Nuclide) {
  if (nu.st) return 0;
  if (nu.lambda > 0) return nu.lambda;
  return nu.branches.length ? Math.LN2 / 1e-6 : 0;
}

const Y_S = 31557600;
const TICKS: [number, string][] = [
  [1e-9, '1 ns'], [1e-6, '1 µs'], [1e-3, '1 ms'], [1, '1 s'], [60, '1 min'], [3600, '1 h'], [86400, '1 d'],
  [Y_S, '1 y'], [Y_S * 10, '10 y'], [Y_S * 100, '100 y'], [Y_S * 1e3, '1 ky'], [Y_S * 1e4, '10 ky'], [Y_S * 1e5, '100 ky'],
  [Y_S * 1e6, '1 My'], [Y_S * 1e7, '10 My'], [Y_S * 1e8, '100 My'], [Y_S * 1e9, '1 Gy'], [Y_S * 1e10, '10 Gy'],
];
function timeTicks(t0: number, t1: number): [number, string][] {
  let ticks = TICKS.filter(([t]) => Math.log10(t) >= t0 && Math.log10(t) <= t1);
  const span = t1 - t0;
  if (ticks.length > 9) {
    const keep = span > 16 ? new Set(['1 ns', '1 µs', '1 ms', '1 s', '1 h', '1 y', '1 ky', '1 My', '1 Gy']) : null;
    if (keep) ticks = ticks.filter(([, l]) => keep.has(l));
    else ticks = ticks.filter((_, i) => i % 2 === 0);
  }
  if (ticks.length < 3) {
    ticks = [];
    for (let e = Math.ceil(t0); e <= t1; e++) ticks.push([10 ** e, fmtTime(10 ** e, 1)]);
  }
  return ticks;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const FONT = `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

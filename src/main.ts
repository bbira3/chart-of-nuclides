import './style.css';
import { loadDataset, loadFyIndex, loadFy, type Dataset, type FyData, type FySystem, type Nuclide } from './data';
import { decayChain, mainPath } from './chain';
import {
  COLOR_MODES, computeColoring, css, familyColor, fmtNum, fmtPct, fmtTime, legendPos, luminance, missingColor, scaleFor,
  type Coloring, type ContinuousMode, type ColorMode,
} from './colors';
import { Chart, type Overlay } from './chart';
import { activate, loadActivation, naturalTargets, REACTION_COLORS, reactionsOn, SPECTRA, type ActData, type Spectrum } from './activation';
import { SimModal } from './ui/sim';
import { XsPlot } from './ui/xsplot';
import { loadXsIndex } from './xs';
import { Appearance } from './ui/appearance';
import { Help } from './ui/help';
import { colorTopic, decayTopic, reactionTopic, type Example } from './helpContent';
import { $, el, label, toast } from './ui/dom';

type Mode = 'explore' | 'chart' | 'fy' | 'act';

interface State {
  mode: Mode;
  color: string;
  baseColor: string;
  fySys: string;
  fyKind: 'cum' | 'ind';
  fyThr: number; // log10 of yield fraction
  fyFilter: 'dim' | 'hide' | 'off';
  actZ: number;
  actIso: string | null; // "z,n" of a single target, or null for the natural element
  actSp: Spectrum;
}

const DEFAULTS: State = {
  mode: 'explore', color: 'decay', baseColor: 'decay',
  fySys: 'U235_t', fyKind: 'cum', fyThr: -5, fyFilter: 'dim',
  actZ: 27, actIso: null, actSp: 0,
};


class App {
  ds!: Dataset;
  chart!: Chart;
  fyIndex: FySystem[] = [];
  fyData: FyData | null = null;
  act: ActData | null = null;
  actResult: ReturnType<typeof activate> | null = null;
  /** Each activation product's share of total production (0..1). */
  actShare: Map<number, number> | null = null;
  actTotal = 0;
  coloring!: Coloring;
  state: State = { ...DEFAULTS };
  catOff = new Set<string>();
  pinned: Nuclide | null = null;
  /** Targets with σ(E) plots. */
  xsIndex: Record<string, number[]> | null = null;
  listHover: Nuclide | null = null;
  /** Explore mode: the last nuclide hovered, shown in the details panel. */
  explored: Nuclide | null = null;
  sim = new SimModal();
  xs = new XsPlot();
  look = new Appearance($('#btnTheme'));
  help = new Help();
  get dark() { return this.look.theme.dark; }
  /** A theme variable, e.g. '--text'. */
  tv(name: string) { return this.look.theme.vars[name]; }

  private tip = $('#tip');
  private legend = $('#legend');
  private panel = $('#modePanel');
  private detail = $('#detail');
  private mini = $('#minimap') as HTMLCanvasElement;
  private miniBase: HTMLCanvasElement | null = null;

  async init() {
    this.loadState();
    this.look.onChange = what => this.onLook(what);
    this.help.onExample = ex => this.runExample(ex);
    const [ds, fyIndex] = await Promise.all([loadDataset(), loadFyIndex()]);
    this.ds = ds;
    this.fyIndex = fyIndex;
    if (!fyIndex.some(s => s.id === this.state.fySys)) this.state.fySys = 'U235_t';
    this.chart = new Chart($('#chart') as HTMLCanvasElement, ds);
    this.chart.onHover = (nu, x, y) => this.onHover(nu, x, y);
    this.chart.onClick = nu => this.pin(nu);
    this.chart.onViewChange = () => this.drawMiniViewport();
    this.chart.showMagic = this.look.look.magic;
    this.sim.onPick = nu => { this.sim.close(); this.pin(nu, true); };
    this.xs.onPick = nu => { this.xs.close(); this.pin(nu, true); };
    loadXsIndex().then(ix => { this.xsIndex = ix; if (this.detailNuclide) this.renderDetail(); });

    this.buildColorSelect();
    this.bindUi();
    if (this.state.mode === 'fy') await this.ensureFy();
    if (this.state.mode === 'act') await this.ensureAct();
    this.setMode(this.state.mode, false);
    this.recolor();
    this.updateInsets();
    if (!location.hash) {
      if (this.state.mode === 'fy') this.frameFy();
      if (this.state.mode === 'act') this.frameAct();
    }
    this.fromHash();
    $('#loading').classList.add('done');
    // Warm the activation data for the detail panel.
    (window.requestIdleCallback ?? setTimeout)(() => this.ensureAct().then(() => this.pinned && this.renderDetail()));
  }

  // -------------------------------------------------------------- state
  private loadState() {
    try {
      const s = JSON.parse(localStorage.getItem('con.state') ?? '{}');
      this.state = { ...DEFAULTS, ...s };
      if (!COLOR_MODES.some(m => m.id === this.state.color)) this.state.color = 'decay';
    } catch { /* ignore */ }
  }
  private saveState() {
    try { localStorage.setItem('con.state', JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  private get mode(): ColorMode {
    return COLOR_MODES.find(m => m.id === this.state.color) ?? COLOR_MODES[0];
  }

  // -------------------------------------------------------------- data
  async ensureFy() {
    try {
      this.fyData = await loadFy(this.state.fySys);
    } catch (e) {
      console.error(e);
      toast('Could not load fission yields');
    }
  }
  async ensureAct() {
    if (this.act) return;
    try {
      this.act = await loadActivation();
      this.computeActivation();
    } catch (e) {
      console.error(e);
    }
  }
  computeActivation() {
    if (!this.act) return;
    const s = this.state;
    let targets;
    if (s.actIso) {
      const nu = this.ds.byId(s.actIso);
      targets = nu ? [{ nu, frac: 1 }] : [];
    } else targets = naturalTargets(this.ds, s.actZ);
    this.actResult = activate(this.ds, this.act, targets, s.actSp);
    this.actTotal = this.actResult.products.reduce((t, p) => t + p.weight, 0);
    const tot = this.actTotal || 1;
    this.actShare = new Map(this.actResult.products.map(p => [p.product.idx, p.weight / tot]));
  }

  // -------------------------------------------------------------- colouring
  recolor() {
    const s = this.state;
    const ctx = {
      fy: s.mode === 'fy' || s.color === 'fy' ? (this.fyData?.[s.fyKind] ?? null) : null,
      fyLabel: '',
      act: this.actShare,
      dark: this.dark,
    };
    this.coloring = computeColoring(this.ds, this.mode, ctx);
    this.chart.setColors(this.coloring.colors);
    this.renderMiniBase();
    this.renderLegend();
    this.refocus();
  }

  /** Opacity, hidden cells, arrows and rings for the current mode and hover. */
  refocus() {
    const ds = this.ds, n = ds.nuclides.length, s = this.state;
    let alpha = null as Float32Array | null;
    let hidden = null as Uint8Array | null;
    const A = (): Float32Array => (alpha ??= new Float32Array(n).fill(1));
    const DIM = 0.16;
    const overlay: Overlay = { edges: [], rings: [] };
    let sub: string[] | null = null;

    if (this.coloring.mode.kind === 'cat' && this.catOff.size) {
      const a = A();
      this.coloring.values.forEach((v, i) => { if (this.catOff.has(String(v))) a[i] = DIM; });
    }

    if (s.mode === 'fy' && this.fyData) {
      const map = this.fyData[s.fyKind];
      const thr = 10 ** s.fyThr;
      sub = new Array(n);
      for (const nu of ds.nuclides) {
        const y = map[`${nu.z},${nu.n}`]?.[0];
        if (y) sub[nu.idx] = fmtPct(y);
        if (s.fyFilter !== 'off' && !(y != null && y >= thr)) {
          if (s.fyFilter === 'hide') (hidden ??= new Uint8Array(n))[nu.idx] = 1;
          else A()[nu.idx] = Math.min(A()[nu.idx], DIM);
        }
      }
      const sys = this.fySystem;
      const tgt = sys && ds.get(sys.tz, sys.ta - sys.tz);
      if (tgt) {
        overlay.rings.push({ nu: tgt, color: '#f5c73b', width: 3 });
        if (hidden) hidden[tgt.idx] = 0;
        if (alpha) alpha[tgt.idx] = 1;
      }
    }

    if (s.mode === 'act' && this.actResult) {
      const a = A();
      a.fill(0.28);
      const { reactions, products } = this.actResult;
      const maxW = products.length ? products[0].weight : 1;
      // Descendants of products, faint.
      for (const p of products.slice(0, 40)) {
        for (const d of decayChain(p.product).nodes) a[d.idx] = Math.max(a[d.idx], 0.7);
      }
      sub = new Array(n);
      for (const p of products) {
        a[p.product.idx] = 1;
        sub[p.product.idx] = `${p.reactions[0].label} ${pctShort(p.weight / (this.actTotal || 1))}`;
      }
      const seenT = new Set<number>();
      for (const r of reactions) {
        if (!seenT.has(r.target.idx)) {
          seenT.add(r.target.idx);
          a[r.target.idx] = 1;
          overlay.rings.push({ nu: r.target, color: this.tv('--text'), width: 2.5 });
        }
        if (!r.product) continue;
        // Arrow weight follows the share of production, so dominant reactions stand out.
        const w = Math.max(0.05, Math.min(1, Math.sqrt(r.weight / (this.actTotal || maxW))));
        overlay.edges.push({ from: r.target, to: r.product, color: REACTION_COLORS[r.label] ?? '#aab4bf', weight: w });
      }
    }

    // Decay chain to show. A clicked (pinned) nuclide locks its chain on screen,
    // so hovering elsewhere doesn't replace it. With nothing pinned, hovering
    // previews chains, except in activation mode, where chains appear only on click.
    // Explore mode never draws chains: it is for reading the details panel.
    const focus = s.mode === 'explore' ? null : this.pinned ?? (s.mode === 'act' ? null : (this.listHover ?? this.chart.hover));
    if (focus && focus.branches.length) {
      const ch = decayChain(focus);
      const a = A();
      const inChain = new Uint8Array(n);
      for (const nd of ch.nodes) inChain[nd.idx] = 1;
      for (let i = 0; i < n; i++) a[i] = inChain[i] ? 1 : a[i] * 0.16;
      if (hidden) for (const nd of ch.nodes) hidden[nd.idx] = 0;
      if (s.mode === 'act') overlay.edges = overlay.edges.filter(e => inChain[e.to.idx] || e.to === focus);
      for (const e of ch.edges) {
        overlay.edges.push({
          from: e.from, to: e.to, color: css(familyColor(e.branch.family, false)),
          weight: Math.max(0.08, Math.min(1, e.flow)),
          label: e.branch.frac < 0.995 && e.branch.frac >= 1e-4 ? pctShort(e.branch.frac) : undefined,
          dashed: !e.branch.known,
        });
      }
    }

    // A list row or chip being hovered without showing its chain still gets a ring.
    if (this.listHover && this.listHover !== focus) overlay.rings.push({ nu: this.listHover, color: this.tv('--accent'), width: 3 });

    this.chart.setFocus(alpha, hidden);
    this.chart.setOverlay(overlay);
    this.chart.setSubLabels(sub);
  }

  get fySystem() {
    return this.fyIndex.find(x => x.id === this.state.fySys);
  }

  // -------------------------------------------------------------- modes
  async setMode(mode: Mode, user = true) {
    const s = this.state;
    const prev = s.mode;
    const selected = this.detailNuclide;
    s.mode = mode;
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', (b as HTMLElement).dataset.mode === mode));
    if (user && prev !== mode) {
      if (prev === 'chart' || prev === 'explore' || !['fy', 'act'].includes(s.color)) s.baseColor = s.color;
      if (mode === 'fy') s.color = 'fy';
      else if (mode === 'act') s.color = 'act';
      else s.color = ['fy', 'act'].includes(s.color) ? s.baseColor : s.color;
      if (['fy', 'act'].includes(s.baseColor)) s.baseColor = 'decay';
      this.catOff.clear();
      ($('#colorBy') as HTMLSelectElement).value = s.color;
    }
    if (mode === 'fy') await this.ensureFy();
    if (mode === 'act') {
      await this.ensureAct();
      // Switching to Activation irradiates whatever was selected.
      if (user && prev !== 'act' && selected && this.useAsTarget(selected)) this.pin(null);
    }
    if (mode !== 'explore') this.explored = null;
    this.tip.hidden = true;
    this.renderPanel();
    this.renderDetail();
    this.updateInsets();
    this.saveState();
    if (user) {
      this.recolor();
      if (mode === 'fy') this.frameFy();
      if (mode === 'act') this.frameAct();
    }
  }

  /** Tell the chart which parts of the screen are covered by panels. */
  updateInsets() {
    const panelOpen = !this.panel.hidden;
    const wide = panelOpen && this.state.mode === 'act';
    this.chart.insets = { l: panelOpen ? (wide ? 476 : 324) : 0, r: this.detailNuclide ? 352 : 0, t: 0, b: 0 };
  }

  /** Frame a set of nuclides. */
  frame(list: Nuclide[], maxS = 64) {
    if (!list.length) return;
    let n0 = Infinity, n1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const nu of list) { n0 = Math.min(n0, nu.n); n1 = Math.max(n1, nu.n); z0 = Math.min(z0, nu.z); z1 = Math.max(z1, nu.z); }
    this.updateInsets();
    this.chart.fitBox(n0, n1, z0, z1, true, maxS);
  }

  frameFy() {
    if (!this.fyData) return;
    const list: Nuclide[] = [];
    for (const [k, [y]] of Object.entries(this.fyData.cum)) if (y >= 1e-7) { const nu = this.ds.byId(k); if (nu) list.push(nu); }
    this.frame(list);
  }

  /** Make a nuclide the activation target: the isotope if it has neutron data, else its natural element. */
  private useAsTarget(nu: Nuclide): boolean {
    if (!this.act) return false;
    const s = this.state;
    if (reactionsOn(this.ds, this.act, nu).length) { s.actIso = `${nu.z},${nu.n}`; s.actZ = nu.z; }
    else if (naturalTargets(this.ds, nu.z).length) { s.actIso = null; s.actZ = nu.z; }
    else return false;
    this.computeActivation();
    return true;
  }

  frameAct() {
    if (!this.actResult) return;
    const list = this.actResult.reactions.flatMap(r => (r.product ? [r.target, r.product] : [r.target]));
    this.frame(list, 56);
  }

  // -------------------------------------------------------------- hover/pin
  private onHover(nu: Nuclide | null, x: number, y: number) {
    if (nu !== this.lastHover) {
      this.lastHover = nu;
      if (this.state.mode === 'explore' && nu && !this.pinned && nu !== this.explored) {
        const wasOpen = !!this.explored;
        this.explored = nu;
        this.renderDetail();
        if (!wasOpen) this.updateInsets();
      }
      this.refocus();
      this.renderLegendMarker(nu);
    }
    // Explore mode shows everything in the details panel, so no tooltip.
    if (!nu || this.state.mode === 'explore') { this.tip.hidden = true; return; }
    this.renderTip(nu);
    this.placeTip(x, y);
  }
  private lastHover: Nuclide | null = null;

  pin(nu: Nuclide | null, fly = false) {
    this.pinned = nu;
    this.chart.pinned = nu;
    if (nu && this.state.mode === 'explore') this.explored = nu;
    this.renderDetail();
    this.updateInsets();
    if (nu && fly) this.chart.focusNuclide(nu);
    this.refocus();
    const h = nu ? `#${nu.id}` : ' ';
    history.replaceState(null, '', h === ' ' ? location.pathname + location.search : h);
  }

  private fromHash() {
    const q = decodeURIComponent(location.hash.slice(1));
    if (!q) return;
    const nu = this.search(q)[0];
    if (nu && 'idx' in nu) this.pin(nu, true);
  }

  // -------------------------------------------------------------- tooltip
  private renderTip(nu: Nuclide) {
    const s = this.state;
    const rows: [string, string][] = [];
    rows.push(['Half-life', nu.st ? 'Stable' : nu.hlt]);
    if (nu.ab != null) rows.push(['Abundance', `${fmtNum(nu.ab, 4)} %`]);
    const dec = nu.branches.filter(b => b.frac > 0 || !b.known).slice(0, 3).map(b => `${prettyMode(b.mode)} ${b.known ? pctShort(b.frac) : '?'}`);
    if (dec.length) rows.push(['Decay', dec.join(', ')]);
    if (nu.jp) rows.push(['Jπ', nu.jp]);
    const m = this.coloring.mode;
    if (m.kind !== 'cat' && !['halflife', 'fy', 'act'].includes(m.id)) {
      const v = this.coloring.values[nu.idx];
      rows.push([m.label, typeof v === 'number' ? (m as ContinuousMode).format(v) : '—']);
    }
    if (s.mode === 'fy' && this.fyData) {
      const y = this.fyData[s.fyKind][`${nu.z},${nu.n}`];
      rows.push([s.fyKind === 'cum' ? 'Cumulative yield' : 'Independent yield', y ? fmtPct(y[0]) : '—']);
    }
    if (s.mode === 'act' && this.actResult) {
      const p = this.actResult.products.find(p => p.product === nu);
      if (p) {
        rows.push(['Share of production', fmtPct(p.weight / (this.actTotal || 1))]);
        for (const r of p.reactions.slice(0, 3)) rows.push([`${r.target.id} (${r.label}) σ`, `${fmtNum(r.sigma, 3)} b`]);
      }
    }
    const tip = this.tip;
    tip.innerHTML = '';
    tip.append(el('div', { class: 'hd' }, el('b', {}, label(nu)), el('span', {}, `${nu.name} · Z ${nu.z} · N ${nu.n}`)));
    for (const [k, v] of rows) tip.append(el('div', { class: 'row' }, el('span', {}, k), el('span', {}, v)));
    if (nu.branches.length) {
      const ch = decayChain(nu);
      const ends = ch.ends.filter(e => e.prob > 1e-4).slice(0, 2);
      const c = el('div', { class: 'chain' });
      const steps = Math.max(...ch.nodes.map(n => ch.depth.get(n.idx) ?? 0));
      if (ends.length) {
        c.append('→ ');
        ends.forEach((e, i) => {
          if (i) c.append(', ');
          c.append(el('b', {}, label(e.nuclide)));
          if (ends.length > 1 || e.prob < 0.995) c.append(` ${pctShort(e.prob)}`);
        });
        c.append(` · ${steps} step${steps === 1 ? '' : 's'}`);
      }
      if (ch.fission > 0.001) c.append(` · SF ${pctShort(ch.fission)}`);
      if (c.childNodes.length) tip.append(c);
    }
    tip.hidden = false;
  }

  private placeTip(x: number, y: number) {
    const tip = this.tip;
    const stage = $('#stage').getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let tx = x + 16, ty = y + 16;
    if (tx + w > stage.width - 8) tx = x - w - 16;
    if (ty + h > stage.height - 8) ty = y - h - 16;
    tip.style.transform = `translate(${Math.max(8, tx)}px, ${Math.max(8, ty)}px)`;
    tip.style.left = '0'; tip.style.top = '0';
  }

  // -------------------------------------------------------------- legend
  private renderLegend() {
    const m = this.coloring.mode;
    const L = this.legend;
    L.innerHTML = '';
    const title = el('div', { class: 'title' }, el('span', {}, m.label, el('button', { class: 'qbtn', 'data-help': colorTopic(m.id) }, '?')));
    if (m.id === 'fy' && this.fySystem) title.append(el('small', {}, `${this.fySystem.target} · ${this.state.fyKind === 'cum' ? 'cumulative' : 'independent'}`));
    if (m.id === 'act') title.append(el('small', {}, SPECTRA[this.state.actSp]));
    L.append(title);
    if (m.kind === 'cat') {
      const cats = el('div', { class: 'cats' });
      for (const c of m.categories(this.dark)) {
        const d = el('div', { class: 'cat' + (this.catOff.has(c.key) ? ' off' : ''), 'data-k': c.key }, el('i', { style: `background:${css(c.color)}` }), c.label);
        d.addEventListener('click', e => {
          if (e.altKey || e.shiftKey) {
            // solo
            const all = m.categories(this.dark).map(x => x.key);
            const solo = this.catOff.size === all.length - 1 && !this.catOff.has(c.key);
            this.catOff = solo ? new Set() : new Set(all.filter(k => k !== c.key));
          } else if (this.catOff.has(c.key)) this.catOff.delete(c.key);
          else this.catOff.add(c.key);
          this.renderLegend();
          this.refocus();
        });
        cats.append(d);
      }
      L.append(cats);
      this.appendReactionKey(L);
      return;
    }
    const cm = m as ContinuousMode;
    const [d0, d1] = this.coloring.domain;
    const stops: string[] = [];
    const scale = scaleFor(cm);
    for (let i = 0; i <= 16; i++) stops.push(css(scale(i / 16)));
    const bar = el('div', { class: 'bar', style: `background:linear-gradient(90deg,${stops.join(',')})` });
    bar.append(el('div', { class: 'marker', hidden: true }));
    L.append(bar);
    const ticks = el('div', { class: 'ticks' });
    const tv = cm.kind === 'div' && cm.center != null ? [d0, cm.center, d1] : [d0, (d0 + d1) / 2, d1];
    for (const v of tv) ticks.append(el('span', {}, cm.format(v)));
    L.append(ticks);
    const sp = cm.specials ?? [];
    const specials = el('div', { class: 'specials' });
    for (const x of sp) specials.append(el('span', {}, el('i', { style: `background:${css(x.color(this.dark))}` }), x.label));
    specials.append(el('span', {}, el('i', { style: `background:${css(missingColor())}` }), 'No data'));
    L.append(specials);
    this.appendReactionKey(L);
  }

  /** In activation mode, explain the arrow colours (one row per colour actually drawn). */
  private appendReactionKey(L: HTMLElement) {
    if (this.state.mode !== 'act' || !this.actResult) return;
    const byColor = new Map<string, string[]>();
    for (const r of this.actResult.reactions) {
      if (!r.product) continue;
      const c = REACTION_COLORS[r.label] ?? '#aab4bf';
      const labels = byColor.get(c) ?? [];
      if (!labels.includes(r.label)) labels.push(r.label);
      byColor.set(c, labels);
    }
    if (!byColor.size) return;
    const key = el('div', { class: 'rxkey' });
    for (const [c, labels] of byColor) {
      const item = el('span', {}, el('i', { style: `background:${c}` }));
      labels.forEach((l, i) => item.append(i ? ' ' : '', el('span', { class: 'help-link', 'data-help': reactionTopic(l) }, `(${l})`)));
      key.append(item);
    }
    L.append(el('div', { class: 'title sub' }, 'Arrows', el('small', {}, 'reaction · width = share')), key);
  }

  private renderLegendMarker(nu: Nuclide | null) {
    const mk = this.legend.querySelector('.marker') as HTMLElement | null;
    const m = this.coloring.mode;
    if (m.kind === 'cat') {
      const v = nu ? String(this.coloring.values[nu.idx]) : null;
      this.legend.querySelectorAll('.cat').forEach(c => c.classList.toggle('hot', (c as HTMLElement).dataset.k === v));
      return;
    }
    if (!mk) return;
    const v = nu ? this.coloring.values[nu.idx] : null;
    if (typeof v !== 'number') { mk.hidden = true; return; }
    mk.hidden = false;
    mk.style.left = `${legendPos(this.coloring, v) * 100}%`;
  }

  // -------------------------------------------------------------- minimap
  private renderMiniBase() {
    const ds = this.ds;
    const c = (this.miniBase ??= document.createElement('canvas'));
    c.width = ds.maxN + 3; c.height = ds.maxZ + 3;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const img = g.createImageData(c.width, c.height);
    for (const nu of ds.nuclides) {
      const x = nu.n + 1, y = c.height - 2 - nu.z;
      const k = (y * c.width + x) * 4;
      const col = this.coloring.colors[nu.idx];
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.drawMiniViewport();
  }

  private drawMiniViewport() {
    const base = this.miniBase;
    if (!base || this.mini.offsetParent === null) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = this.mini.clientWidth, H = this.mini.clientHeight;
    if (this.mini.width !== Math.round(W * dpr)) { this.mini.width = Math.round(W * dpr); this.mini.height = Math.round(H * dpr); }
    const g = this.mini.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const sc = Math.min((W - 12) / base.width, (H - 12) / base.height);
    const ox = (W - base.width * sc) / 2, oy = (H - base.height * sc) / 2;
    this.miniTx = { sc, ox, oy, h: base.height };
    g.imageSmoothingEnabled = false;
    g.drawImage(base, ox, oy, base.width * sc, base.height * sc);
    const vp = this.chart.viewport;
    const x0 = ox + (vp.n0 + 1 + 0.5) * sc, x1 = ox + (vp.n1 + 1 + 0.5) * sc;
    const y0 = oy + (base.height - 2 - vp.z1 + 0.5) * sc, y1 = oy + (base.height - 2 - vp.z0 + 0.5) * sc;
    g.strokeStyle = this.tv('--text');
    g.lineWidth = 1.5;
    g.fillStyle = this.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const rx = Math.max(ox, x0), ry = Math.max(oy, y0);
    const rw = Math.min(ox + base.width * sc, x1) - rx, rh = Math.min(oy + base.height * sc, y1) - ry;
    if (rw > 0 && rh > 0) { g.fillRect(rx, ry, rw, rh); g.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1); }
  }
  private miniTx = { sc: 1, ox: 0, oy: 0, h: 0 };

  // -------------------------------------------------------------- colour select
  private buildColorSelect() {
    const sel = $('#colorBy') as HTMLSelectElement;
    sel.innerHTML = '';
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const m of COLOR_MODES) {
      let g = groups.get(m.group);
      if (!g) { g = el('optgroup', { label: m.group }); groups.set(m.group, g); sel.append(g); }
      g.append(el('option', { value: m.id, title: m.description }, m.label));
    }
    sel.value = this.state.color;
  }

  // -------------------------------------------------------------- mode panel
  renderPanel() {
    const P = this.panel;
    const s = this.state;
    P.innerHTML = '';
    // The activation panel is wider so the periodic-table picker is easy to read.
    $('.left-col').classList.toggle('wide', s.mode === 'act');
    if (s.mode === 'chart' || s.mode === 'explore') { P.hidden = true; return; }
    P.hidden = false;
    if (s.mode === 'fy') this.renderFyPanel(P);
    else this.renderActPanel(P);
  }

  private renderFyPanel(P: HTMLElement) {
    const s = this.state;
    const sys = this.fySystem;
    const targets = [...new Map(this.fyIndex.map(x => [x.target, x])).values()];
    const tSel = el('select', { class: 'input' }) as HTMLSelectElement;
    for (const t of targets) tSel.append(el('option', { value: t.target }, t.target));
    tSel.value = sys?.target ?? 'U-235';
    const energies = this.fyIndex.filter(x => x.target === tSel.value);
    const eSeg = el('div', { class: 'seg small full' });
    for (const e of energies) {
      const b = el('button', { class: e.id === s.fySys ? 'on' : '', title: e.elabel }, shortEnergy(e));
      b.addEventListener('click', () => this.setFySys(e.id));
      eSeg.append(b);
    }
    tSel.addEventListener('change', () => {
      const list = this.fyIndex.filter(x => x.target === tSel.value);
      const keep = list.find(x => sys && shortEnergy(x) === shortEnergy(sys)) ?? list[0];
      this.setFySys(keep.id);
    });
    P.append(el('div', { class: 'field' }, el('span', {}, 'Fissioning system', q('fission-systems')), el('div', { class: 'row' }, tSel), eSeg));

    const kSeg = segment([['cum', 'Cumulative'], ['ind', 'Independent']], s.fyKind, v => { s.fyKind = v as 'cum' | 'ind'; this.afterFyChange(); });
    P.append(el('div', { class: 'field' }, el('span', {}, 'Yield', q('fission-yields')), kSeg));

    const out = el('output', {}, fmtPct(10 ** s.fyThr));
    const range = el('input', { type: 'range', min: -10, max: -1, step: 0.05, value: s.fyThr }) as HTMLInputElement;
    range.addEventListener('input', () => {
      s.fyThr = +range.value;
      out.textContent = fmtPct(10 ** s.fyThr);
      this.refocus();
      this.updateFyStats(P);
    });
    range.addEventListener('change', () => this.saveState());
    const fSeg = segment([['dim', 'Dim'], ['hide', 'Hide'], ['off', 'Off']], s.fyFilter, v => { s.fyFilter = v as State['fyFilter']; this.refocus(); this.saveState(); });
    P.append(el('div', { class: 'field' }, el('span', {}, 'Minimum yield'), el('div', { class: 'slider' }, range, out), fSeg));
    P.append(el('div', { class: 'stat', id: 'fyStat' }));
    P.append(el('ul', { class: 'list', id: 'fyList' }));
    const btn = el('button', { class: 'btn', title: 'Simulate the decay of one fission\'s products' }, svgIcon('M4 16c3-9 6-9 12-12'), 'Decay fission products');
    btn.addEventListener('click', () => this.openPulse());
    P.append(btn);
    this.updateFyStats(P);
  }

  private updateFyStats(P: HTMLElement) {
    const s = this.state;
    const st = P.querySelector('#fyStat'), list = P.querySelector('#fyList');
    if (!st || !list || !this.fyData) return;
    const map = this.fyData[s.fyKind];
    const thr = 10 ** s.fyThr;
    let count = 0;
    const rows: [Nuclide, number][] = [];
    for (const [k, [y]] of Object.entries(map)) {
      const nu = this.ds.byId(k);
      if (!nu) continue;
      if (y >= thr) count++;
      rows.push([nu, y]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    st.innerHTML = '';
    st.append(el('b', {}, count), ` nuclides ≥ ${fmtPct(thr)}`);
    list.innerHTML = '';
    const top = rows.slice(0, 12);
    const max = top[0]?.[1] ?? 1;
    for (const [nu, y] of top) list.append(this.listRow(nu, nu.st ? 'stable' : shortHlText(nu), fmtPct(y), y / max));
  }

  private listRow(nu: Nuclide, sub: string | Node, value: string, frac: number, title?: string) {
    const li = el('li', { title },
      label(nu),
      typeof sub === 'string' ? el('span', { class: 'sub' }, sub) : sub,
      el('span', { class: 'v' }, value),
      el('span', { class: 'barbg' }, el('i', { style: `width:${Math.max(2, frac * 100)}%` })));
    li.addEventListener('click', () => this.pin(nu, true));
    li.addEventListener('pointerenter', () => { this.listHover = nu; this.refocus(); });
    li.addEventListener('pointerleave', () => { this.listHover = null; this.refocus(); });
    return li;
  }

  private async setFySys(id: string) {
    this.state.fySys = id;
    await this.ensureFy();
    this.afterFyChange();
    this.frameFy();
  }
  private afterFyChange() {
    this.saveState();
    this.renderPanel();
    this.recolor();
    if (this.pinned) this.renderDetail();
  }

  private openPulse() {
    if (!this.fyData || !this.fySystem) return;
    const ind = this.fyData.ind;
    const n0 = new Map<number, number>();
    const nodes = new Map<number, Nuclide>();
    for (const [k, [y]] of Object.entries(ind)) {
      const nu = this.ds.byId(k);
      if (!nu) continue;
      n0.set(nu.idx, y);
      for (const d of decayChain(nu).nodes) nodes.set(d.idx, d);
    }
    this.sim.open(`${this.fySystem.target} ${shortEnergy(this.fySystem)} fission products`, [...nodes.values()], n0, { perFission: true, t0: -1, t1: 10 });
  }

  private renderActPanel(P: HTMLElement) {
    const s = this.state;
    const act = this.act;
    if (!act) { P.append(el('div', { class: 'stat' }, 'Loading…')); return; }
    // Element picker
    const withData = new Set<number>();
    for (const k of Object.keys(act.targets)) {
      const nu = this.ds.byId(k);
      if (nu?.natural) withData.add(nu.z);
    }
    // Caption under the table: the hovered (or selected) element and its natural isotopes.
    const cap = el('div', { class: 'ptcap' });
    const showCap = (z: number | null) => {
      cap.innerHTML = '';
      if (z == null) {
        const t = s.actIso ? this.ds.byId(s.actIso) : null;
        if (t) cap.append(el('b', {}, t.name), ' · single isotope');
        return;
      }
      const isos = naturalTargets(this.ds, z).sort((a, b) => b.frac - a.frac);
      cap.append(el('b', {}, this.ds.meta.elementNames[z]), ` · Z ${z}`);
      if (!isos.length) { cap.append(' · no natural isotopes'); return; }
      cap.append(el('br'));
      isos.slice(0, 5).forEach((t, i) => cap.append(i ? ', ' : '', el('span', { class: 'iso' }, `${t.nu.id} ${fmtNum(t.frac * 100, 3)}%`)));
      if (isos.length > 5) cap.append(`, +${isos.length - 5} more`);
    };
    const pt = el('div', { class: 'ptable' });
    const cells: (number | null)[] = new Array(18 * 10).fill(null);
    for (let z = 1; z <= 118; z++) { const [r, c] = ptPos(z); cells[r * 18 + c] = z; }
    for (const z of cells) {
      if (z == null) { pt.append(el('span', { class: 'gap' })); continue; }
      const sym = this.ds.meta.elements[z];
      const b = el('button', {
        class: (z === s.actZ && !s.actIso ? 'on ' : '') + (withData.has(z) ? 'has' : ''),
        title: this.ds.meta.elementNames[z], disabled: !withData.has(z),
      }, sym) as HTMLButtonElement;
      b.addEventListener('click', () => { s.actZ = z; s.actIso = null; this.afterActChange(); });
      b.addEventListener('pointerenter', () => showCap(z));
      b.addEventListener('pointerleave', () => showCap(s.actIso ? null : s.actZ));
      pt.append(b);
    }
    const tgtLabel = s.actIso ? this.ds.byId(s.actIso) : null;
    const head = el('div', { class: 'field' }, el('span', {}, 'Target', q('reactions')));
    if (tgtLabel) {
      const chip = el('span', { class: 'chip' }, label(tgtLabel), ' ×');
      chip.addEventListener('click', () => { s.actIso = null; s.actZ = tgtLabel.z; this.afterActChange(); });
      head.append(el('div', {}, chip));
    } else head.append(el('div', {}, el('b', {}, `${this.ds.meta.elementNames[s.actZ]}`), el('span', { class: 'stat' }, ' · natural')));
    head.append(pt, cap);
    showCap(s.actIso ? null : s.actZ);
    P.append(head);
    const spSeg = segment(SPECTRA.map((l, i) => [String(i), l] as [string, string]), String(s.actSp), v => { s.actSp = +v as Spectrum; this.afterActChange(); });
    P.append(el('div', { class: 'field' }, el('span', {}, 'Neutrons', q('spectra')), spSeg));
    const list = el('ul', { class: 'list' });
    const prods = this.actResult?.products ?? [];
    const tot = this.actTotal || 1;
    if (prods.length) P.append(el('div', { class: 'stat' }, el('span', { class: 'help-link', 'data-help': 'activation-share' }, 'Share of production'), ' · total ', el('b', {}, `${fmtNum(this.actTotal, 3)} b`), ' per target atom', q('cross-section')));
    for (const p of prods.slice(0, 16)) {
      const r = p.reactions[0];
      const sub = el('span', { class: 'sub' },
        `${r.target.id} `,
        el('span', { class: 'help-link', 'data-help': reactionTopic(r.label), style: `color:${REACTION_COLORS[r.label] ?? 'inherit'};font-weight:600` }, `(${r.label})`),
        `${p.reactions.length > 1 ? ` +${p.reactions.length - 1}` : ''} · ${p.product.st ? 'stable' : shortHlText(p.product)}`);
      const share = p.weight / tot;
      list.append(this.listRow(p.product, sub, fmtPct(share), share, `${fmtNum(p.weight, 3)} b per target atom`));
    }
    if (!prods.length) list.append(el('li', {}, el('span', { class: 'sub' }, 'No reactions for this spectrum')));
    P.append(list);
  }

  private afterActChange() {
    this.computeActivation();
    this.saveState();
    this.renderPanel();
    this.recolor();
    this.frameAct();
  }

  // -------------------------------------------------------------- detail
  /** The nuclide in the details panel: the pinned one, or the hovered one in explore mode. */
  get detailNuclide(): Nuclide | null {
    return this.pinned ?? (this.state.mode === 'explore' ? this.explored : null);
  }

  renderDetail() {
    const nu = this.detailNuclide;
    const D = this.detail;
    document.body.classList.toggle('detail-open', !!nu);
    if (!nu) { D.hidden = true; this.drawMiniViewport(); return; }
    D.hidden = false;
    D.innerHTML = '';
    const col = this.coloring.colors[nu.idx];
    const fg = luminance(col) > 0.42 ? '#111' : '#fff';
    const close = el('button', { class: 'icon', title: 'Close (Esc)' }, svgIcon('M5 5l10 10M15 5L5 15'));
    close.addEventListener('click', () => { this.explored = null; this.pin(null); });
    D.append(el('div', { class: 'head' },
      el('div', { class: 'badge', style: `background:${css(col)};color:${fg}` }, el('sup', {}, nu.a), nu.z === 0 ? 'n' : nu.s),
      el('div', { class: 't' }, el('b', {}, nu.name), el('span', {}, `Z ${nu.z} · N ${nu.n} · A ${nu.a}`)),
      close));
    const body = el('div', { class: 'body' });
    D.append(body);

    // Key properties
    const kv = el('dl', { class: 'kv' });
    const PROP_HELP: Record<string, string> = {
      'Half-life': 'half-life', 'Jπ': 'spin-parity', Abundance: 'abundance', 'Mass excess': 'mass-excess', 'B/A': 'binding',
      'Q(β⁻)': 'q-value', 'Q(EC)': 'q-value', 'Q(α)': 'q-value', 'S(n)': 'separation', 'S(p)': 'separation',
      'Charge radius': 'charge-radius', 'μ': 'magnetic-moment', Q: 'quadrupole', Discovered: 'discovery',
    };
    const add = (k: string, v: string | null | undefined, small?: string) => {
      if (v == null) return;
      const h = PROP_HELP[k];
      kv.append(el('dt', h ? { class: 'help-link', 'data-help': h } : {}, k), el('dd', {}, v, small ? el('small', {}, ` ${small}`) : null));
    };
    add('Half-life', nu.st ? 'Stable' : nu.hlt);
    add('Jπ', nu.jp);
    if (nu.ab != null) add('Abundance', `${fmtNum(nu.ab, 5)} %`);
    if (nu.me != null) add('Mass excess', `${fmtNum(nu.me / 1000, 6)} MeV`, nu.mes ? 'syst.' : '');
    if (nu.be != null && nu.a > 1) add('B/A', `${fmtNum(nu.be / 1000, 5)} MeV`);
    if (nu.qbm != null) add('Q(β⁻)', `${fmtNum(nu.qbm / 1000, 4)} MeV`);
    if (nu.qec != null) add('Q(EC)', `${fmtNum(nu.qec / 1000, 4)} MeV`);
    if (nu.qa != null) add('Q(α)', `${fmtNum(nu.qa / 1000, 4)} MeV`);
    if (nu.sn != null) add('S(n)', `${fmtNum(nu.sn / 1000, 4)} MeV`);
    if (nu.sp != null) add('S(p)', `${fmtNum(nu.sp / 1000, 4)} MeV`);
    if (nu.rad != null && nu.rad > 0) add('Charge radius', `${fmtNum(nu.rad, 4)} fm`);
    if (nu.mu != null) add('μ', `${fmtNum(nu.mu, 4)} μN`);
    if (nu.q != null) add('Q', `${fmtNum(nu.q, 3)} b`);
    if (nu.disc) add('Discovered', String(nu.disc));
    body.append(el('section', {}, kv));

    // Decay branches
    if (nu.branches.length) {
      const dec = el('div', { class: 'decays' });
      for (const b of nu.branches) {
        const target = b.target ? this.chip(b.target) : el('span', { class: 'stat' }, b.family === 'SF' || b.mode.endsWith('SF') ? 'fission' : b.offChart ? 'off chart' : '—');
        const p = b.pct != null ? `${fmtNum(b.pct, 4)} %${b.unc ? ` ± ${fmtNum(b.unc, 2)}` : ''}` : '?';
        dec.append(el('div', { class: 'd' }, el('span', { class: 'm help-link', 'data-help': decayTopic(b.mode, b.family, b.delayed), style: `color:${css(familyColor(b.family, this.dark))}` }, prettyMode(b.mode)), target, el('span', { class: 'p' }, p)));
      }
      body.append(el('section', {}, el('h4', {}, el('span', {}, 'Decay', q('decay-modes'))), dec));

      const ch = decayChain(nu);
      const path = mainPath(ch);
      const pe = el('div', { class: 'path' });
      path.forEach((p, i) => {
        if (i) pe.append(el('span', { class: 'arr' }, '→'));
        pe.append(this.chip(p));
      });
      const ends = ch.ends.filter(e => e.prob > 1e-4);
      const endsEl = el('div', { class: 'path', style: 'margin-top:8px' });
      if (ends.length > 1) for (const e of ends.slice(0, 6)) endsEl.append(this.chip(e.nuclide), el('span', { class: 'arr' }, pctShort(e.prob)));
      body.append(el('section', {}, el('h4', {}, el('span', {}, 'Chain', q('decay-chain')), el('span', {}, `${ch.nodes.length} nuclides`)), pe, ends.length > 1 ? endsEl : null));
    }

    // Fission yield
    if (this.state.mode === 'fy' && this.fyData && this.fySystem) {
      const k = `${nu.z},${nu.n}`;
      const ind = this.fyData.ind[k], cum = this.fyData.cum[k];
      if (ind || cum) {
        const kv2 = el('dl', { class: 'kv' });
        kv2.append(el('dt', {}, 'Independent'), el('dd', {}, ind ? fmtPct(ind[0]) : '—'));
        kv2.append(el('dt', {}, 'Cumulative'), el('dd', {}, cum ? fmtPct(cum[0]) : '—'));
        body.append(el('section', {}, el('h4', {}, el('span', {}, 'Fission yield', q('fission-yields')), el('span', {}, `${this.fySystem.target} ${shortEnergy(this.fySystem)}`)), kv2));
      }
    }

    // Neutron reactions on this nuclide
    let hasRx = false;
    if (this.act) {
      const rx = reactionsOn(this.ds, this.act, nu);
      if (rx.length) {
        hasRx = true;
        const t = el('table', { class: 'rx' });
        t.append(el('tr', {}, el('th', {}, 'σ (b)'), el('th', {}, 'Thermal'), el('th', {}, 'Fission'), el('th', {}, '14 MeV')));
        for (const r of rx.slice(0, 8)) {
          const first = el('td', {}, el('span', { class: 'help-link', 'data-help': reactionTopic(r.label), style: `color:${REACTION_COLORS[r.label] ?? 'inherit'};font-weight:600` }, `(${r.label})`), ' ');
          if (r.product) first.append(this.chip(r.product));
          t.append(el('tr', {}, first, ...r.sig.map(v => el('td', { class: v ? '' : 'z' }, v ? fmtNum(v, 3) : '—'))));
        }
        body.append(el('section', {}, el('h4', {}, el('span', {}, 'Neutron reactions', q('reactions')), el('span', {}, 'energies', q('spectra'))), t, this.xsButton(nu)));
      }
    }
    if (!hasRx && this.xsIndex?.[`${nu.z},${nu.n}`]) {
      body.append(el('section', {}, el('h4', {}, el('span', {}, 'Neutron reactions', q('reactions'))), this.xsButton(nu)));
    }

    // Actions
    const actions = el('div', { class: 'actions' });
    if (nu.branches.length) {
      const b = el('button', { class: 'btn primary' }, 'Simulate decay');
      b.addEventListener('click', () => this.openChainSim(nu));
      actions.append(b);
    }
    if (hasRx) {
      const b = el('button', { class: 'btn' }, 'Irradiate');
      b.addEventListener('click', async () => {
        this.state.actIso = `${nu.z},${nu.n}`;
        this.state.actZ = nu.z;
        this.computeActivation();
        if (this.state.mode !== 'act') await this.setMode('act');
        else this.afterActChange();
        this.recolor();
      });
      actions.append(b);
    }
    if (actions.childNodes.length) D.append(actions);
    this.drawMiniViewport();
  }

  /** Opens the σ(E) plot; kept one click away so the detail panel stays calm. */
  private xsButton(nu: Nuclide) {
    const b = el('button', { class: 'linkbtn' },
      svgIcon('M3 16V4M3 16h14M5 13c2 0 2.5-6 4-6s1.5 4 3 4 2-7 4-7'), 'Cross sections vs energy', el('span', { class: 'arr' }, '→'));
    b.addEventListener('click', () => this.xs.open(this.ds, nu));
    return b;
  }

  private chip(nu: Nuclide) {
    const c = el('span', { class: 'chip' }, el('i', { style: `background:${css(this.coloring.colors[nu.idx])}` }), label(nu, ''));
    c.addEventListener('click', () => this.pin(nu, true));
    c.addEventListener('pointerenter', () => { this.listHover = nu; this.refocus(); });
    c.addEventListener('pointerleave', () => { this.listHover = null; this.refocus(); });
    return c;
  }

  openChainSim(nu: Nuclide) {
    const ch = decayChain(nu);
    this.sim.open(`${nu.name} decay`, ch.nodes, new Map([[nu.idx, 1]]));
  }

  // -------------------------------------------------------------- search
  search(q: string): Nuclide[] {
    const raw = q.trim();
    q = raw.toLowerCase().replace(/\s+/g, ' ');
    if (!q) return [];
    const ds = this.ds;
    const elIdx = (t: string) => {
      t = t.toLowerCase();
      const alias: Record<string, string> = { cesium: 'caesium', aluminum: 'aluminium', sulphur: 'sulfur' };
      t = alias[t] ?? t;
      let z = ds.meta.elements.findIndex(e => e.toLowerCase() === t);
      if (z < 0) z = ds.meta.elementNames.findIndex(e => e.toLowerCase() === t);
      if (z < 0 && t.length >= 3) z = ds.meta.elementNames.findIndex(e => e.toLowerCase().startsWith(t));
      return z;
    };
    let m = q.match(/^([a-z]+)[\s-]*(\d+)m?$/) ?? null;
    let sym: string | null = null, a: number | null = null;
    if (m) { sym = m[1]; a = +m[2]; } else if ((m = q.match(/^(\d+)[\s-]*([a-z]+)$/))) { a = +m[1]; sym = m[2]; }
    if (sym != null && a != null) {
      const z = elIdx(sym);
      // "n" is both the neutron and nitrogen (N): capital N, or a mass with no free-neutron
      // cluster (A > 6), means nitrogen.
      let zz = z;
      if (z === 0 && (/^\d*[\s-]*N/.test(raw) || !ds.get(0, a))) zz = 7;
      if (zz >= 0) {
        const z = zz;
        const hit = ds.get(z, a - z);
        const near = ds.nuclides.filter(n => n.z === z && n !== hit).sort((x, y) => Math.abs(x.a - a!) - Math.abs(y.a - a!)).slice(0, 7);
        return hit ? [hit, ...near] : near;
      }
    }
    if ((m = q.match(/^\d+$/))) {
      const A = +m[0];
      return ds.nuclides.filter(n => n.a === A).sort((x, y) => (y.hl ?? 1e40) - (x.hl ?? 1e40) || x.z - y.z).slice(0, 12);
    }
    const z = raw === 'N' ? 7 : elIdx(q);
    if (z >= 0) {
      return ds.nuclides.filter(n => n.z === z).sort((x, y) => Number(y.st) - Number(x.st) || (y.ab ?? 0) - (x.ab ?? 0) || (y.hl ?? 0) - (x.hl ?? 0)).slice(0, 12);
    }
    return [];
  }

  // -------------------------------------------------------------- UI wiring
  private bindUi() {
    const input = $('#search') as HTMLInputElement;
    const results = $('#results');
    let hits: Nuclide[] = [];
    let sel = 0;
    const render = () => {
      results.innerHTML = '';
      hits.forEach((nu, i) => {
        const c = this.coloring.colors[nu.idx];
        const li = el('li', { class: i === sel ? 'on' : '' },
          el('span', { class: 'sw', style: `background:${css(c)};color:${luminance(c) > 0.42 ? '#111' : '#fff'}` }, nu.z === 0 ? 'n' : nu.s),
          el('span', { class: 'nm' }, label(nu, ''), ` `, el('span', { class: 'hl' }, nu.name)),
          el('span', { class: 'hl' }, nu.st ? 'stable' : shortHlText(nu)));
        li.addEventListener('pointerdown', e => { e.preventDefault(); choose(nu); });
        results.append(li);
      });
      results.classList.toggle('open', hits.length > 0);
    };
    const choose = (nu: Nuclide) => {
      this.pin(nu, true);
      input.value = '';
      hits = [];
      render();
      input.blur();
    };
    input.addEventListener('input', () => { hits = this.search(input.value); sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && hits[sel]) choose(hits[sel]);
      else if (e.key === 'Escape') { input.value = ''; hits = []; render(); input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(() => results.classList.remove('open'), 100));
    input.addEventListener('focus', () => { if (hits.length) results.classList.add('open'); });

    ($('#colorBy') as HTMLSelectElement).addEventListener('change', async e => {
      this.state.color = (e.target as HTMLSelectElement).value;
      if (this.state.color === 'fy') await this.ensureFy();
      if (this.state.color === 'act') await this.ensureAct();
      this.catOff.clear();
      this.saveState();
      this.recolor();
    });
    document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach(b =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode as Mode)));
    $('#btnFit').addEventListener('click', () => this.chart.fit());
    $('#btnPng').addEventListener('click', async () => {
      const blob = await this.chart.snapshot();
      if (!blob) return;
      const a = el('a', { href: URL.createObjectURL(blob), download: `chart-of-nuclides-${this.state.color}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('#btnInfo').addEventListener('click', () => this.showInfo());
    $('#btnHelp').addEventListener('click', () => this.help.open());
    // Anything marked data-help opens that help topic (capture phase, so it wins over row clicks).
    document.addEventListener('click', e => {
      const t = (e.target as Element | null)?.closest?.('[data-help]') as HTMLElement | null;
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      if (!$('#info').hidden) $('#info').hidden = true;
      this.help.open(t.dataset.help);
    }, true);
    // Mode tabs explain themselves on hover.
    const tips: Record<string, string> = {
      explore: 'Explore (1): hover to see details', chart: 'Decay (2): hover to preview chains, click to lock',
      fy: 'Fission (3): fission product yields', act: 'Activation (4): what neutrons turn things into',
    };
    document.querySelectorAll<HTMLButtonElement>('#modeSeg button').forEach(b => { b.title = tips[b.dataset.mode!] ?? ''; });
    $('#info').addEventListener('pointerdown', e => { if (e.target === $('#info') || (e.target as HTMLElement).closest('[data-close]')) $('#info').hidden = true; });

    // Minimap navigation
    const nav = (e: PointerEvent) => {
      const r = this.mini.getBoundingClientRect();
      const { sc, ox, oy, h } = this.miniTx;
      const n = (e.clientX - r.left - ox) / sc - 1 - 0.5;
      const z = h - 2 - (e.clientY - r.top - oy) / sc + 0.5;
      this.chart.flyTo(n, z, undefined, e.type === 'pointerdown');
    };
    this.mini.addEventListener('pointerdown', e => { this.mini.setPointerCapture(e.pointerId); nav(e); });
    this.mini.addEventListener('pointermove', e => { if (e.buttons) nav(e); });

    window.addEventListener('keydown', e => {
      const t = e.target instanceof HTMLElement ? e.target : document.body;
      if (e.key === 'Escape' && t !== input) {
        if (t.matches('input, select, textarea, button')) t.blur();
        e.preventDefault();
        this.escape();
        return;
      }
      if (t.matches('input, select, textarea')) return;
      if (e.key === '?' || e.key === 'h') { e.preventDefault(); if (this.help.isOpen) this.help.close(); else this.help.open(); return; }
      if (this.help.isOpen) return;
      if (e.key === '/' ) { e.preventDefault(); input.focus(); return; }
      if (this.sim.isOpen || this.xs.isOpen) return;
      if (e.key === '0') this.chart.fit();
      else if (e.key === '+' || e.key === '=') this.chart.zoomBy(1.5);
      else if (e.key === '-') this.chart.zoomBy(1 / 1.5);
      else if (e.key === 't' || e.key === 'T') this.look.cycleTheme(e.shiftKey ? -1 : 1);
      else if (e.key === 'f' && this.pinned) this.chart.focusNuclide(this.pinned);
      else if (e.key === 's' && this.pinned?.branches.length) this.openChainSim(this.pinned);
      else if (e.key === '1') this.setMode('explore');
      else if (e.key === '2') this.setMode('chart');
      else if (e.key === '3') this.setMode('fy');
      else if (e.key === '4') this.setMode('act');
      else if (e.key.startsWith('Arrow')) {
        const p = this.pinned;
        if (!p) return;
        e.preventDefault();
        const [dz, dn] = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key] as [number, number];
        const next = this.ds.get(p.z + dz, p.n + dn) ?? (dz ? this.ds.get(p.z + dz, p.n + dn + (dz > 0 ? 1 : -1)) : undefined);
        if (next) {
          this.pin(next);
          const [x, y] = this.chart.toScreen(next.n, next.z);
          const vp = this.chart.viewport;
          if (x < 60 || y < 60 || x > vp.W - 60 || y > vp.H - 60) this.chart.flyTo(next.n, next.z);
        }
      }
    });
    window.addEventListener('hashchange', () => this.fromHash());
  }

  /** Run a "Try it" example from the help panel. */
  private async runExample(ex: Example) {
    const find = (id: string) => this.search(id).find(n => n.id === id) ?? null;
    if (ex.kind === 'nuclide' || ex.kind === 'sim') {
      const nu = find(ex.id);
      if (!nu) return;
      if (this.state.mode === 'act' || this.state.mode === 'fy') await this.setMode('chart');
      this.pin(nu, true);
      if (ex.kind === 'sim') this.openChainSim(nu);
    } else if (ex.kind === 'xs') {
      const nu = find(ex.id);
      if (!nu) return;
      this.pin(nu, true);
      this.xs.open(this.ds, nu);
    } else if (ex.kind === 'act') {
      const s = this.state;
      s.actSp = ex.sp;
      if (ex.target.includes('-')) {
        const nu = find(ex.target);
        if (!nu) return;
        s.actIso = `${nu.z},${nu.n}`; s.actZ = nu.z;
      } else {
        s.actZ = this.ds.meta.elements.indexOf(ex.target); s.actIso = null;
      }
      this.pin(null);
      if (s.mode !== 'act') await this.setMode('act');
      this.afterActChange();
    } else if (ex.kind === 'fy') {
      this.pin(null);
      if (this.state.mode !== 'fy') await this.setMode('fy');
      await this.setFySys(ex.sys);
    } else if (ex.kind === 'color') {
      this.state.color = ex.mode;
      if (ex.mode === 'fy') await this.ensureFy();
      if (ex.mode === 'act') await this.ensureAct();
      ($('#colorBy') as HTMLSelectElement).value = ex.mode;
      this.catOff.clear();
      this.saveState();
      this.recolor();
    } else if (ex.kind === 'mode') {
      await this.setMode(ex.mode);
    }
  }

  /** Theme, palette or magic-line change from the appearance popover. */
  private onLook(what: 'theme' | 'colors' | 'magic') {
    if (!this.chart) return;
    if (what === 'magic') { this.chart.showMagic = this.look.look.magic; this.chart.invalidate(); return; }
    if (what === 'theme') this.chart.readTheme();
    this.recolor();
    this.renderDetail();
    if (this.sim.isOpen) this.sim.redraw();
    if (this.xs.isOpen) this.xs.redraw();
  }

  /**
   * Escape backs out one layer at a time: popovers and dialogs, then the pinned
   * nuclide, legend filters, fission/activation mode, and finally the zoomed view.
   */
  escape() {
    this.tip.hidden = true;
    if (this.help.isOpen) { this.help.close(); return; }
    if (this.look.isOpen) { this.look.close(); return; }
    if (!$('#info').hidden) { $('#info').hidden = true; return; }
    if (this.sim.isOpen) { this.sim.close(); return; }
    if (this.xs.isOpen) { this.xs.close(); return; }
    if (this.pinned) { this.pin(null); return; }
    if (this.catOff.size) { this.catOff.clear(); this.renderLegend(); this.refocus(); return; }
    if (this.state.mode !== 'explore') { this.setMode('explore'); return; }
    if (this.explored) { this.explored = null; this.renderDetail(); this.updateInsets(); return; }
    if (!this.chart.isFit()) { this.chart.fit(); return; }
  }

  private showInfo() {
    const B = $('#infoBody');
    B.innerHTML = '';
    const ul = el('ul');
    for (const s of this.ds.meta.sources) ul.append(el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name)));
    ul.append(el('li', {}, el('a', { href: 'https://www.nndc.bnl.gov/endf-b8.0/', target: '_blank', rel: 'noopener' }, 'ENDF/B-VIII.0 neutron sublibrary (reaction cross sections)')));
    B.append(el('h4', {}, 'Sources'), ul, el('div', { class: 'stat' }, `${this.ds.nuclides.length} ground states · ${this.fyIndex.length} fission-yield sets · built ${this.ds.meta.built}`));

    // Simplifications made to the evaluated data so the chart stays fast and readable.
    const notes: [string, string[]][] = [
      ['Nuclides & decay', [
        'Ground states only. Isomers (e.g. Tc-99m, Ba-137m) are not separate cells, so chains skip isomeric steps.',
        'Up to three decay modes per nuclide, as listed by LiveChart. The cell colour is the largest branch.',
        'Delayed-particle branches (β⁻n, εp, …) are subtracted from their parent β⁻ or ε branch.',
        'Missing branching ratios are filled in as the remainder (100% if there is only one mode). Totals above 100% are scaled down. Inferred branches are drawn dashed.',
        'Half-life limits (e.g. Xe-134, > 5.8e22 y) are shown at the limit value. Very short-lived states quoted as level widths are converted to half-lives.',
      ]],
      ['Fission yields', [
        'Only the evaluated energies are available (thermal, 0.5 MeV, 2 MeV, 14 MeV, spontaneous). Nothing is interpolated in between.',
        'Yields to isomeric states are merged into the ground state. Independent yields are summed; cumulative yields use the ground-state value.',
      ]],
      ['Neutron activation', [
        'Thermal cross sections combine the background with a single-level Breit–Wigner sum over resolved resonances at 0.0253 eV. This is typically within a few percent of reference values.',
        'Fission-spectrum values average the tabulated cross sections over a U-235 Watt spectrum. Resonance contributions are left out, so (n,γ) values there are underestimates; threshold reactions are fine.',
        'Production weight = abundance × σ (barns per target atom). It is a relative production rate: no flux, irradiation time or self-shielding.',
        'First-generation reactions only. Products are shown as ground states (no isomer split, no further captures).',
      ]],
      ['Cross-section plots', [
        'Resolved resonances are rebuilt from the ENDF parameters with the formalism each evaluation uses (Breit–Wigner, Reich–Moore, R-matrix limited) and Doppler-broadened to 293.6 K. R-matrix charged-particle channels use constant widths.',
        'Where an evaluation asks for unresolved-resonance averages to be added, they are computed without width-fluctuation corrections, so capture there can read 10–30% high.',
        'Curves are thinned to about 1% for drawing.',
      ]],
      ['Decay simulation', [
        'Exact Bateman solution for the chain shown. Nuclides with an unknown half-life are treated as decaying in 1 µs.',
        'Spontaneous fission and daughters that are not on the chart count as losses. Fission products are not followed.',
        'The fission-pulse simulation starts from the independent yields of one fission and has no neutron capture during decay.',
      ]],
    ];
    for (const [title, items] of notes) {
      const list = el('ul', { class: 'notes' });
      for (const t of items) list.append(el('li', {}, t));
      B.append(el('h4', {}, title), list);
    }

    B.append(el('h4', {}, 'Keys'));
    const keys = el('div', { class: 'keys' });
    for (const [k, v] of [['/', 'Search'], ['1 2 3 4', 'Explore · Decay · Fission · Activation'], ['Click', 'Lock chain & details'], ['Click empty', 'Unlock'], ['Shift + scroll', 'Travel along the valley of stability'], ['← ↑ → ↓', 'Step between neighbours'], ['s', 'Simulate decay'], ['0', 'Fit'], ['+ −', 'Zoom'], ['t', 'Next theme'], ['Esc', 'Back out one level'], ['Shift-click legend', 'Solo category'], ['? or h', 'Help']]) {
      keys.append(el('kbd', {}, k), el('span', {}, v));
    }
    B.append(keys);
    $('#info').hidden = false;
  }
}

// ---------------------------------------------------------------- helpers
/** A small "?" that opens a help topic. */
function q(topic: string) {
  return el('button', { class: 'qbtn', 'data-help': topic }, '?');
}

function segment(opts: [string, string][], value: string, on: (v: string) => void) {
  const seg = el('div', { class: 'seg small full' });
  for (const [v, l] of opts) {
    const b = el('button', { class: v === value ? 'on' : '' }, l);
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      on(v);
    });
    seg.append(b);
  }
  return seg;
}

function svgIcon(d: string) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

function pctShort(f: number) {
  const p = f * 100;
  if (p >= 99.95) return '100%';
  if (p >= 10) return `${p.toFixed(1).replace(/\.0$/, '')}%`;
  if (p >= 0.1) return `${Number(p.toPrecision(2))}%`;
  return `${p.toExponential(0)}%`;
}

export function prettyMode(m: string) {
  if (/^(SF|IT)$/.test(m) || /^\d+[A-Z][a-z]?$/.test(m) || m === 'Mg') return m;
  return m
    .replace('EC+B+', 'ε')
    .replace(/B-/g, 'β⁻')
    .replace(/B\+/g, 'β⁺')
    .replace(/EC/g, 'ε')
    .replace(/(\d*)P/g, '$1p')
    .replace(/(\d*)N/g, '$1n')
    .replace(/A$/, 'α')
    .replace(/SF$/, 'SF');
}

function shortHlText(nu: Nuclide) {
  if (nu.hl == null) return nu.hlt.replace(/\s*\([^)]*\)$/, '');
  const op = /^[<>≥≤≈]/.exec(nu.hlt)?.[0] ?? '';
  return op + fmtTime(nu.hl, 3);
}

function shortEnergy(s: FySystem) {
  if (s.spont) return 'SF';
  if (s.energy < 1) return 'Thermal';
  if (s.energy >= 1e7) return `${s.energy / 1e6} MeV`;
  return `${s.energy / 1e6} MeV`;
}

/** Periodic-table position (row, col) for the compact picker; f-block on rows 8-9. */
function ptPos(z: number): [number, number] {
  if (z === 1) return [0, 0];
  if (z === 2) return [0, 17];
  const periods: [number, number][] = [[3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118]];
  for (let p = 0; p < periods.length; p++) {
    const [a, b] = periods[p];
    if (z < a || z > b) continue;
    const row = p + 1;
    const i = z - a;
    if (b - a + 1 === 8) return [row, i < 2 ? i : i + 10];
    if (b - a + 1 === 18) return [row, i];
    // 32-wide periods: s-block, f-block (row 8/9), d+p blocks
    if (i < 2) return [row, i];
    if (i < 17) return [row === 5 ? 8 : 9, i - 2 + 2];
    return [row, i - 14];
  }
  return [0, 0];
}

const app = new App();
app.init().catch(err => {
  console.error(err);
  $('#loading').innerHTML = `<div style="color:var(--text-dim)">Failed to load data. Run <code>npm run data</code>.</div>`;
});
(window as unknown as { app: App }).app = app;

// Canvas renderer and interaction for the chart.
import type { Dataset, Nuclide } from './data';
import { luminance, type RGB } from './colors';

export interface Edge {
  from: Nuclide;
  to: Nuclide;
  color: string;
  /** 0..1 weight: drives line width and opacity. */
  weight: number;
  label?: string;
  dashed?: boolean;
}

export interface Overlay {
  edges: Edge[];
  /** Cells to outline, with a colour. */
  rings: { nu: Nuclide; color: string; width?: number }[];
}

interface Theme {
  bg: string; grid: string; magic: string; text: string; textDim: string; axis: string; ring: string;
}

const MAGIC = [2, 8, 20, 28, 50, 82, 126];

export class Chart {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private W = 0;
  private H = 0;

  // View: world centre (n, z) and pixels per cell.
  cx = 60; cy = 45; s = 8;
  private tcx = 60; private tcy = 45; private ts = 8;
  private anchor: { wx: number; wy: number; sx: number; sy: number } | null = null;
  private animating = false;
  private dirty = false;

  private textColors: string[] = [];
  /** Per-nuclide opacity (null = all opaque). */
  private alpha: Float32Array | null = null;
  /** Hidden cells are not drawn at all. */
  private hidden: Uint8Array | null = null;
  private overlay: Overlay = { edges: [], rings: [] };
  private sub: string[] | null = null; // optional third label line per nuclide
  hover: Nuclide | null = null;
  pinned: Nuclide | null = null;
  showMagic = true;
  private theme!: Theme;

  onHover: (nu: Nuclide | null, x: number, y: number) => void = () => {};
  onClick: (nu: Nuclide | null) => void = () => {};
  onViewChange: () => void = () => {};

  private grid: (Nuclide | undefined)[][] = [];
  /** Lowest Z present in each N column. */
  private colMin: number[] = [];

  constructor(canvas: HTMLCanvasElement, private ds: Dataset) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    for (const nu of ds.nuclides) {
      (this.grid[nu.z] ??= [])[nu.n] = nu;
      if (this.colMin[nu.n] == null || nu.z < this.colMin[nu.n]) this.colMin[nu.n] = nu.z;
    }
    this.readTheme();
    this.buildSpine();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.bind();
    this.fit(false);
  }

  // ------------------------------------------------------------ public API
  readTheme() {
    const st = getComputedStyle(document.documentElement);
    const v = (n: string) => st.getPropertyValue(n).trim();
    this.theme = {
      bg: v('--chart-bg'), grid: v('--chart-grid'), magic: v('--chart-magic'), text: v('--text'),
      textDim: v('--text-dim'), axis: v('--chart-axis'), ring: v('--accent'),
    };
    const font = v('--font') || DEFAULT_FONT;
    if (font !== FONT) {
      FONT = font;
      this.widthCache.clear();
      this.sprites = new SpriteCache();
    }
    this.invalidate();
  }

  setColors(colors: RGB[]) {
    this.rgb = colors;
    this.darkText = colors.map(c => luminance(c) > 0.42);
    this.textColors = this.darkText.map(d => (d ? DARK_TEXT : LIGHT_TEXT));
    this.layerDirty = true;
    this.invalidate();
  }

  setFocus(alpha: Float32Array | null, hidden: Uint8Array | null = null) {
    this.alpha = alpha;
    this.hidden = hidden;
    this.layerDirty = true;
    this.invalidate();
  }

  // Cell layer: one pixel per nuclide, scaled up with nearest-neighbour sampling.
  private rgb: RGB[] = [];
  private darkText: boolean[] = [];
  private layer: HTMLCanvasElement | null = null;
  private layerDirty = true;
  private buildLayer() {
    const W = this.ds.maxN + 1, H = this.ds.maxZ + 1;
    const c = (this.layer ??= document.createElement('canvas'));
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    const d = img.data;
    for (const nu of this.ds.nuclides) {
      if (this.hidden?.[nu.idx]) continue;
      const k = ((this.ds.maxZ - nu.z) * W + nu.n) * 4;
      const col = this.rgb[nu.idx];
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2];
      d[k + 3] = Math.round(255 * (this.alpha ? this.alpha[nu.idx] : 1));
    }
    g.putImageData(img, 0, 0);
    this.layerDirty = false;
  }

  // Label sprites: symbol + superscript A rendered once per size bucket.
  private sprites = new SpriteCache();
  private spriteFor(nu: Nuclide, dark: boolean, P: number) {
    const key = `${nu.idx}${dark ? 'd' : 'l'}${P}`;
    return this.sprites.get(key, () => {
      const sym = nu.z === 0 ? 'n' : nu.s;
      const aP = P * 0.62;
      const wa = this.textW(500, String(nu.a), aP), ws = this.textW(600, sym, P);
      const pad = 2;
      const T = wa + 1 + ws;
      return {
        w: Math.ceil(T + pad * 2), h: Math.ceil(P * 1.3 + pad * 2), ox: pad + T / 2, oy: pad + P * 0.98,
        draw: (g: CanvasRenderingContext2D, x: number, y: number) => {
          g.fillStyle = dark ? DARK_TEXT : LIGHT_TEXT;
          g.textBaseline = 'alphabetic';
          g.textAlign = 'left';
          const by = y + pad + P * 0.98;
          g.font = `500 ${aP}px ${FONT}`;
          g.fillText(String(nu.a), x + pad, by - P * 0.42);
          g.font = `600 ${P}px ${FONT}`;
          g.fillText(sym, x + pad + wa + 1, by);
        },
      };
    });
  }

  setOverlay(o: Overlay) {
    this.overlay = o;
    this.invalidate();
  }

  setSubLabels(sub: string[] | null) {
    this.sub = sub;
    this.invalidate();
  }

  invalidate() {
    if (!this.dirty) {
      this.dirty = true;
      requestAnimationFrame(this.frame);
    }
  }

  /** Screen space covered by floating panels, in px. */
  insets = { l: 0, r: 0, t: 0, b: 0 };

  /** Fit the whole chart in the viewport. */
  fit(animate = true) {
    this.fitBox(0, this.ds.maxN, 0, this.ds.maxZ, animate, 1e9, { l: 0, r: this.insets.r, t: 0, b: 0 });
  }

  /** True when the view is (close to) the whole-chart fit. */
  isFit() {
    const { maxN, maxZ } = this.ds;
    const pad = 36, r = this.insets.r;
    const w = Math.max(80, this.W - r - pad * 2), h = Math.max(80, this.H - pad * 2);
    const s = clampS(Math.min(w / (maxN + 1), h / (maxZ + 1)));
    return Math.abs(this.ts - s) / s < 0.08 && Math.abs(this.tcx - this.cx) < 1 && Math.abs(this.tcy - this.cy) < 1 && this.ts <= s * 1.08;
  }

  /**
   * Move along the valley of stability by a screen distance (px). Positive goes
   * toward heavier nuclides. The view keeps its offset from the valley.
   */
  travel(px: number) {
    const sp = this.spine;
    if (!sp.length) return;
    // Mass number near the view centre picks the local direction of the valley.
    const A = Math.round(Math.min(sp.length - 1, Math.max(1, this.tcx + this.tcy)));
    const k = 6;
    const a0 = sp[Math.max(1, A - k)], a1 = sp[Math.min(sp.length - 1, A + k)];
    let dn = a1[0] - a0[0], dz = a1[1] - a0[1];
    const len = Math.hypot(dn, dz) || 1;
    dn /= len; dz /= len;
    const dist = px / this.s;
    this.anchor = null;
    this.touched = true;
    this.tcx = Math.min(this.ds.maxN + 5, Math.max(-5, this.tcx + dn * dist));
    this.tcy = Math.min(this.ds.maxZ + 5, Math.max(-5, this.tcy + dz * dist));
    this.kick();
  }

  /** Smoothed line of the most stable nuclide for each mass number: spine[A] = [n, z]. */
  private spine: [number, number][] = [];
  private buildSpine() {
    const best: (Nuclide | undefined)[] = [];
    const score = (nu: Nuclide) => (nu.st ? Infinity : nu.hl ?? -1);
    for (const nu of this.ds.nuclides) {
      const b = best[nu.a];
      if (!b || score(nu) > score(b)) best[nu.a] = nu;
    }
    const raw: [number, number][] = [];
    let last: [number, number] = [0, 0];
    for (let A = 0; A < best.length; A++) {
      const b = best[A];
      if (b) last = [b.n, b.z];
      raw[A] = b ? [b.n, b.z] : [last[0] + 0.6, last[1] + 0.4];
    }
    const w = 5;
    this.spine = raw.map((_, A) => {
      let n = 0, z = 0, c = 0;
      for (let j = Math.max(0, A - w); j <= Math.min(raw.length - 1, A + w); j++) { n += raw[j][0]; z += raw[j][1]; c++; }
      return [n / c, z / c] as [number, number];
    });
  }

  /** Frame a region of the chart in the unobstructed part of the viewport. */
  fitBox(n0: number, n1: number, z0: number, z1: number, animate = true, maxS = 64, ins = this.insets) {
    const { l, r, t, b } = ins;
    const pad = 36;
    const w = Math.max(80, this.W - l - r - pad * 2), h = Math.max(80, this.H - t - b - pad * 2);
    const s = clampS(Math.min(w / (n1 - n0 + 1), h / (z1 - z0 + 1), maxS));
    this.flyTo((n0 + n1) / 2 - (l - r) / (2 * s), (z0 + z1) / 2 + (t - b) / (2 * s), s, animate);
  }

  flyTo(n: number, z: number, s = this.ts, animate = true) {
    if (animate) this.touched = true;
    this.anchor = null;
    this.tcx = n; this.tcy = z; this.ts = clampS(s);
    if (!animate) { this.cx = n; this.cy = z; this.s = this.ts; }
    this.kick();
  }

  focusNuclide(nu: Nuclide, minS = 44) {
    const s = clampS(Math.max(this.ts, minS));
    const { l, r, t, b } = this.insets;
    this.flyTo(nu.n - (l - r) / (2 * s), nu.z + (t - b) / (2 * s), s);
  }

  zoomBy(f: number, sx = this.W / 2, sy = this.H / 2) {
    this.touched = true;
    const [wx, wy] = this.toWorld(sx, sy);
    this.anchor = { wx, wy, sx, sy };
    this.ts = clampS(this.ts * f);
    this.kick();
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.W / 2) / this.s + this.cx, this.cy - (sy - this.H / 2) / this.s];
  }
  toScreen(n: number, z: number): [number, number] {
    return [(n - this.cx) * this.s + this.W / 2, (this.cy - z) * this.s + this.H / 2];
  }

  nuclideAt(sx: number, sy: number): Nuclide | null {
    const [wn, wz] = this.toWorld(sx, sy);
    const n = Math.round(wn), z = Math.round(wz);
    const nu = this.grid[z]?.[n];
    if (!nu || this.hidden?.[nu.idx]) return null;
    return nu;
  }

  get viewport() {
    const [n0, z1] = this.toWorld(0, 0);
    const [n1, z0] = this.toWorld(this.W, this.H);
    return { n0, n1, z0, z1, W: this.W, H: this.H };
  }

  /** Render the current view to a PNG blob at device resolution. */
  snapshot(): Promise<Blob | null> {
    this.draw();
    return new Promise(r => this.canvas.toBlob(r, 'image/png'));
  }

  // ------------------------------------------------------------ internals
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.dirty = false;
    if (!this.touched) this.fit(false);
    this.invalidate();
  }

  /** Set once the user pans or zooms; until then resizes re-fit the chart. */
  touched = false;

  private kick() {
    if (!this.animating) {
      this.animating = true;
      this.invalidate();
    }
  }

  private step() {
    const k = 0.24;
    let moving = false;
    const ds = this.ts - this.s;
    if (Math.abs(ds) > this.s * 1e-3) { this.s += ds * k; moving = true; } else this.s = this.ts;
    if (this.anchor) {
      const a = this.anchor;
      this.cx = a.wx - (a.sx - this.W / 2) / this.s;
      this.cy = a.wy + (a.sy - this.H / 2) / this.s;
      this.tcx = this.cx; this.tcy = this.cy;
      if (!moving) this.anchor = null;
    } else {
      const dx = this.tcx - this.cx, dy = this.tcy - this.cy;
      if (Math.abs(dx) * this.s > 0.3 || Math.abs(dy) * this.s > 0.3) {
        this.cx += dx * k; this.cy += dy * k; moving = true;
      } else { this.cx = this.tcx; this.cy = this.tcy; }
    }
    this.animating = moving;
  }

  private frame = () => {
    this.dirty = false;
    if (this.animating) this.step();
    this.draw();
    if (this.animating) this.invalidate();
    this.onViewChange();
  };

  private draw() {
    const { ctx, s, theme } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.W, this.H);

    const vp = this.viewport;
    const nMin = Math.max(0, Math.floor(vp.n0) - 1), nMax = Math.min(this.ds.maxN, Math.ceil(vp.n1) + 1);
    const zMin = Math.max(0, Math.floor(vp.z0) - 1), zMax = Math.min(this.ds.maxZ, Math.ceil(vp.z1) + 1);
    const half = s / 2;
    const gap = s >= 6 ? Math.min(2, Math.max(0.6, s * 0.05)) : 0;
    const size = s - gap;

    // Cells
    if (this.layerDirty || !this.layer) this.buildLayer();
    ctx.imageSmoothingEnabled = false;
    const [lx, ly] = this.toScreen(-0.5, this.ds.maxZ + 0.5);
    ctx.drawImage(this.layer!, lx, ly, (this.ds.maxN + 1) * s, (this.ds.maxZ + 1) * s);
    ctx.imageSmoothingEnabled = true;
    // Gaps between cells: background-coloured grid lines over the layer.
    if (gap > 0) {
      ctx.strokeStyle = theme.bg;
      ctx.lineWidth = gap;
      ctx.beginPath();
      const [x0, y0] = this.toScreen(nMin - 0.5, zMax + 0.5);
      const [x1, y1] = this.toScreen(nMax + 0.5, zMin - 0.5);
      for (let n = nMin; n <= nMax + 1; n++) {
        const x = (n - 0.5 - this.cx) * s + this.W / 2;
        ctx.moveTo(x, y0); ctx.lineTo(x, y1);
      }
      for (let z = zMin; z <= zMax + 1; z++) {
        const y = (this.cy - (z - 0.5)) * s + this.H / 2;
        ctx.moveTo(x0, y); ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }
    void half; void size;

    if (this.showMagic) this.drawMagic(nMin, nMax, zMin, zMax);
    if (s >= 22) this.drawLabels(nMin, nMax, zMin, zMax, size, gap);
    this.drawOverlay();
    this.drawAxes(nMin, nMax, zMin, zMax);
  }

  private drawMagic(nMin: number, nMax: number, zMin: number, zMax: number) {
    const { ctx, s } = this;
    ctx.strokeStyle = this.theme.magic;
    ctx.lineWidth = Math.max(1, Math.min(2, s * 0.08));
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const m of MAGIC) {
      const row = this.ds.rows[m];
      if (row && m >= zMin - 1 && m <= zMax + 1) {
        const [x0, y] = this.toScreen(row.nMin - 0.5, m);
        const [x1] = this.toScreen(row.nMax + 0.5, m);
        ctx.moveTo(x0, y - s / 2); ctx.lineTo(x1, y - s / 2);
        ctx.moveTo(x0, y + s / 2); ctx.lineTo(x1, y + s / 2);
      }
      if (m >= nMin - 1 && m <= nMax + 1) {
        let z0 = Infinity, z1 = -Infinity;
        for (let z = 0; z <= this.ds.maxZ; z++) if (this.grid[z]?.[m]) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        if (z0 <= z1) {
          const [x, ya] = this.toScreen(m, z1 + 0.5);
          const [, yb] = this.toScreen(m, z0 - 0.5);
          ctx.moveTo(x - s / 2, ya); ctx.lineTo(x - s / 2, yb);
          ctx.moveTo(x + s / 2, ya); ctx.lineTo(x + s / 2, yb);
        }
      }
    }
    ctx.stroke();
  }

  /** Text width at 100px, cached per font weight and string; widths scale linearly with size. */
  private widthCache = new Map<string, number>();
  private textW(weight: number, text: string, px: number) {
    const key = weight + text;
    let w = this.widthCache.get(key);
    if (w == null) {
      this.ctx.font = `${weight} 100px ${FONT}`;
      w = this.ctx.measureText(text).width;
      this.widthCache.set(key, w);
    }
    return (w * px) / 100;
  }

  private drawLabels(nMin: number, nMax: number, zMin: number, zMax: number, size: number, gap: number) {
    const { ctx, s } = this;
    const big = s >= 50;
    const huge = s >= 84;
    const symPx = Math.min(s * (big ? 0.27 : 0.36), 30);
    const smallPx = Math.min(Math.max(8.5, s * 0.13), 14);
    const alpha = this.alpha, hidden = this.hidden;

    // Collect visible cells once, then draw in passes so the font changes rarely.
    const items: { nu: Nuclide; cx: number; top: number; baseY: number; a: number }[] = [];
    for (let z = zMin; z <= zMax; z++) {
      const row = this.grid[z];
      if (!row) continue;
      const cy = (this.cy - z) * s + this.H / 2;
      const top = cy - s / 2 + gap / 2;
      const baseY = big ? top + size * 0.36 : cy + symPx * 0.36;
      for (let n = nMin; n <= nMax; n++) {
        const nu = row[n];
        if (!nu || hidden?.[nu.idx]) continue;
        const a = alpha ? alpha[nu.idx] : 1;
        if (a < 0.3) continue;
        items.push({ nu, cx: (n - this.cx) * s + this.W / 2, top, baseY, a });
      }
    }
    if (!items.length) return;
    let curA = -1, curC = '';
    const style = (a: number, c: string) => {
      if (a !== curA) { ctx.globalAlpha = a; curA = a; }
      if (c !== curC) { ctx.fillStyle = c; curC = c; }
    };
    const dpr = this.dpr;
    const P = Math.max(4, Math.round(2 ** (Math.round(Math.log2(symPx * dpr) * 4) / 4)));
    const k = symPx / P; // device px in the sprite -> CSS px on screen
    for (const it of items) {
      const sp = this.spriteFor(it.nu, this.darkText[it.nu.idx], P);
      if (it.a !== curA) { ctx.globalAlpha = it.a; curA = it.a; }
      ctx.drawImage(sp.page, sp.x, sp.y, sp.w, sp.h, it.cx - sp.ox * k, it.baseY - sp.oy * k, sp.w * k, sp.h * k);
    }
    if (big) {
      ctx.textAlign = 'center';
      ctx.font = `400 ${smallPx}px ${FONT}`;
      for (const it of items) {
        const nu = it.nu;
        style(it.a, this.textColors[nu.idx]);
        const hl = nu.st ? (nu.ab != null ? `${trimNum(nu.ab)}%` : 'stable') : shortHl(nu.hlt);
        ctx.fillText(hl, it.cx, it.top + size * 0.6, size - 4);
      }
      if (huge || this.sub) {
        ctx.font = `400 ${smallPx * 0.92}px ${FONT}`;
        for (const it of items) {
          const nu = it.nu;
          const line = this.sub?.[nu.idx] ?? (huge ? decayLine(nu) : '');
          if (!line) continue;
          style(it.a * 0.85, this.textColors[nu.idx]);
          ctx.fillText(line, it.cx, it.top + size * 0.82, size - 4);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawOverlay() {
    const { ctx, s } = this;
    const o = this.overlay;
    // Edges
    if (o.edges.length) {
      ctx.lineCap = 'round';
      const lw = Math.max(1.2, Math.min(4, s * 0.07));
      for (const e of o.edges) {
        const [x0, y0] = this.toScreen(e.from.n, e.from.z);
        const [x1, y1] = this.toScreen(e.to.n, e.to.z);
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 2) continue;
        const ux = dx / len, uy = dy / len;
        const shrink = Math.min(s * 0.34, len * 0.3);
        const ax = x0 + ux * shrink, ay = y0 + uy * shrink;
        const bx = x1 - ux * shrink, by = y1 - uy * shrink;
        const w = lw * (0.45 + 0.55 * Math.sqrt(e.weight));
        ctx.globalAlpha = 0.45 + 0.55 * Math.sqrt(e.weight);
        // halo for contrast
        ctx.strokeStyle = this.theme.bg;
        ctx.lineWidth = w + 2.5;
        ctx.setLineDash(e.dashed ? [4, 4] : []);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = e.color;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
        // head
        const hs = Math.max(5, Math.min(11, s * 0.2)) * (0.7 + 0.3 * Math.sqrt(e.weight));
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.moveTo(bx + ux * 1, by + uy * 1);
        ctx.lineTo(bx - ux * hs - uy * hs * 0.55, by - uy * hs + ux * hs * 0.55);
        ctx.lineTo(bx - ux * hs + uy * hs * 0.55, by - uy * hs - ux * hs * 0.55);
        ctx.closePath(); ctx.fill();
        if (e.label && s >= 26) {
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          ctx.globalAlpha = 1;
          ctx.font = `600 ${Math.min(13, Math.max(10, s * 0.15))}px ${FONT}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const tw = ctx.measureText(e.label).width + 8;
          ctx.fillStyle = this.theme.bg;
          ctx.globalAlpha = 0.85;
          ctx.beginPath(); ctx.roundRect(mx - tw / 2, my - 8, tw, 16, 4); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = e.color;
          ctx.fillText(e.label, mx, my + 0.5);
          ctx.textBaseline = 'alphabetic';
        }
      }
      ctx.globalAlpha = 1;
    }
    // Rings
    const ring = (nu: Nuclide, color: string, width: number) => {
      const [x, y] = this.toScreen(nu.n, nu.z);
      const r = Math.max(3, s / 2 + width / 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.roundRect(x - r, y - r, r * 2, r * 2, Math.min(6, s * 0.12));
      ctx.stroke();
    };
    for (const r of o.rings) ring(r.nu, r.color, r.width ?? 2);
    if (this.pinned) ring(this.pinned, this.theme.ring, 2.5);
    if (this.hover && this.hover !== this.pinned) ring(this.hover, this.theme.text, 2);
  }

  private drawAxes(nMin: number, nMax: number, zMin: number, zMax: number) {
    const { ctx, s } = this;
    if (s < 5) return;
    // Element symbols at the left end of each row; Z numbers when zoomed.
    const step = s >= 11 ? 1 : s >= 6 ? 2 : 5;
    const symPx = Math.min(13, Math.max(9, s * 0.45));
    const rows: { z: number; x: number; y: number; sym: string }[] = [];
    for (let z = zMin; z <= zMax; z++) {
      if (z % step) continue;
      const row = this.ds.rows[z];
      if (!row) continue;
      const [x, y] = this.toScreen(row.nMin - 0.5, z);
      rows.push({ z, x: Math.max(x - 6, s >= 11 ? 34 : 24), y, sym: z === 0 ? 'n' : this.ds.meta.elements[z] ?? '' });
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.axis;
    ctx.font = `600 ${symPx}px ${FONT}`;
    for (const r of rows) ctx.fillText(r.sym, r.x, r.y);
    if (s >= 16) {
      ctx.font = `400 ${Math.min(11, s * 0.32)}px ${FONT}`;
      ctx.fillStyle = this.theme.textDim;
      for (const r of rows) ctx.fillText(String(r.z), r.x - this.textW(600, r.sym, symPx) - 8, r.y);
    }
    // N numbers below the lowest cell of each column.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `400 10px ${FONT}`;
    ctx.fillStyle = this.theme.textDim;
    const nStep = s >= 18 ? 1 : s >= 9 ? 5 : 10;
    for (let n = Math.ceil(nMin / nStep) * nStep; n <= nMax; n += nStep) {
      const zLow = this.colMin[n];
      if (zLow == null || zLow > zMax) continue;
      const [x, y] = this.toScreen(n, Math.max(zLow, zMin) - 0.5);
      if (y > this.H - 12) continue;
      ctx.fillText(String(n), x, y + 3);
    }
  }

  // ------------------------------------------------------------ input
  private bind() {
    const c = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    let pinch: { d: number; s: number } | null = null;

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) down = { x: p.x, y: p.y, cx: this.cx, cy: this.cy, moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.s };
        if (down) down.moved = true;
      }
    });
    c.addEventListener('pointermove', e => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const [wx, wy] = this.toWorld(mx, my);
        this.s = this.ts = clampS(pinch.s * (d / pinch.d));
        this.cx = this.tcx = wx - (mx - this.W / 2) / this.s;
        this.cy = this.tcy = wy + (my - this.H / 2) / this.s;
        this.anchor = null;
        this.invalidate();
        return;
      }
      if (down) {
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 4) {
          down.moved = true;
          c.classList.add('dragging');
          this.setHover(null, p.x, p.y);
        }
        if (down.moved) {
          this.touched = true;
          this.anchor = null;
          this.cx = this.tcx = down.cx - dx / this.s;
          this.cy = this.tcy = down.cy + dy / this.s;
          this.invalidate();
          return;
        }
      }
      if (e.pointerType === 'mouse' || !down) this.setHover(this.nuclideAt(p.x, p.y), p.x, p.y);
    });
    const end = (e: PointerEvent) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (down && pointers.size === 0) {
        if (!down.moved) {
          const nu = this.nuclideAt(p.x, p.y);
          this.onClick(nu);
          if (e.pointerType !== 'mouse') this.setHover(nu, p.x, p.y);
        }
        down = null;
        c.classList.remove('dragging');
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && !down) this.setHover(null, 0, 0);
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      if (e.shiftKey && !e.ctrlKey) {
        // Browsers often turn shift+wheel into horizontal scrolling, so take whichever axis moved.
        let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (e.deltaMode === 1) d *= 16;
        this.travel(d * 1.4);
        this.setHover(this.nuclideAt(p.x, p.y), p.x, p.y);
        return;
      }
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX) * 0.5 || e.deltaMode !== 0) {
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022));
        this.zoomBy(f, p.x, p.y);
      } else {
        this.anchor = null;
        this.cx = this.tcx = this.cx + e.deltaX / this.s;
        this.invalidate();
      }
      this.setHover(this.nuclideAt(p.x, p.y), p.x, p.y);
    }, { passive: false });
    c.addEventListener('dblclick', e => {
      const p = local(e);
      this.zoomBy(e.shiftKey ? 0.5 : 2.2, p.x, p.y);
    });
  }

  private lastHover: Nuclide | null = null;
  private setHover(nu: Nuclide | null, x: number, y: number) {
    if (nu !== this.lastHover) {
      this.lastHover = nu;
      this.hover = nu;
      this.invalidate();
    }
    this.onHover(nu, x, y);
  }
}

const DEFAULT_FONT = `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
let FONT = DEFAULT_FONT;
const DARK_TEXT = 'rgba(10,12,16,0.92)';
const LIGHT_TEXT = 'rgba(255,255,255,0.95)';

interface SpriteSpec { w: number; h: number; ox: number; oy: number; draw: (g: CanvasRenderingContext2D, x: number, y: number) => void }
interface Sprite { page: HTMLCanvasElement; x: number; y: number; w: number; h: number; ox: number; oy: number }

/** Shelf-packed sprite atlas. Cleared when it grows past a few pages. */
class SpriteCache {
  private pages: HTMLCanvasElement[] = [];
  private g: CanvasRenderingContext2D | null = null;
  private x = 0; private y = 0; private rowH = 0;
  private map = new Map<string, Sprite>();
  private readonly size = 2048;

  get(key: string, make: () => SpriteSpec): Sprite {
    const hit = this.map.get(key);
    if (hit) return hit;
    const spec = make();
    if (!this.g || this.x + spec.w > this.size) { this.x = 0; this.y += this.rowH + 1; this.rowH = 0; }
    if (!this.g || this.y + spec.h > this.size) this.newPage();
    const page = this.pages[this.pages.length - 1];
    const sp: Sprite = { page, x: this.x, y: this.y, w: spec.w, h: spec.h, ox: spec.ox, oy: spec.oy };
    spec.draw(this.g!, this.x, this.y);
    this.x += spec.w + 1;
    this.rowH = Math.max(this.rowH, spec.h);
    this.map.set(key, sp);
    return sp;
  }

  private newPage() {
    if (this.pages.length >= 6) { this.pages = []; this.map.clear(); }
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    this.pages.push(c);
    this.g = c.getContext('2d')!;
    this.x = 0; this.y = 0; this.rowH = 0;
  }
}
const clampS = (s: number) => Math.min(260, Math.max(1.5, s));

function trimNum(v: number) {
  return Number(v.toPrecision(4)).toString();
}

/** Compact half-life text for a cell: drop uncertainty in parentheses. */
function shortHl(t: string) {
  return t.replace(/\s*\([^)]*\)\s*$/, '').replace(/^Γ\s*/, 'Γ ');
}

const MODE_SHORT: Record<string, string> = {
  'B-': 'β⁻', 'EC+B+': 'ε', EC: 'ε', 'B+': 'β⁺', A: 'α', SF: 'SF', P: 'p', '2P': '2p', N: 'n', '2N': '2n', IT: 'IT',
  'B-N': 'β⁻n', 'B-2N': 'β⁻2n', ECP: 'εp', 'B+P': 'β⁺p', '2B-': '2β⁻', '2EC': '2ε', '2B+': '2β⁺',
};
function decayLine(nu: Nuclide): string {
  return nu.branches
    .filter(b => !b.delayed)
    .slice(0, 2)
    .map(b => MODE_SHORT[b.mode] ?? b.mode)
    .join(' ');
}

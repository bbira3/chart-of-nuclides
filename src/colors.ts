// Colour modes: how each nuclide's cell gets its colour.
import type { Dataset, Nuclide } from './data';

export type RGB = [number, number, number];

export interface ColorContext {
  fy: Record<string, [number, number]> | null;
  fyLabel: string;
  /** Activation: each product's share of total production (0..1), by nuclide index. */
  act: Map<number, number> | null;
  dark: boolean;
}

export interface Category { key: string; label: string; color: RGB }

interface BaseMode {
  id: string;
  label: string;
  group: string;
  description: string;
}
export interface CategoricalMode extends BaseMode {
  kind: 'cat';
  categories: (dark: boolean) => Category[];
  value: (nu: Nuclide, ctx: ColorContext) => string | null;
}
export interface ContinuousMode extends BaseMode {
  kind: 'seq' | 'div';
  scale: Scale;
  log?: boolean;
  unit: string;
  /** Raw numeric value (before any log transform). */
  value: (nu: Nuclide, ctx: ColorContext) => number | null;
  /** Domain in transformed space; computed from the data when absent. */
  domain?: [number, number];
  /** Auto domain spanning this many units below the data maximum. */
  autoSpan?: number;
  /** For diverging modes: the centre value (transformed). */
  center?: number;
  format: (v: number) => string;
  /** Optional text describing special cells (e.g. stable). */
  special?: (nu: Nuclide) => { label: string; color: (dark: boolean) => RGB } | null;
  specials?: { label: string; color: (dark: boolean) => RGB }[];
}
export type ColorMode = CategoricalMode | ContinuousMode;

// ----------------------------------------------------------------- palettes
export type Scale = (t: number) => RGB;

function stops(cols: string[]): Scale {
  const rgb = cols.map(hex);
  return (t: number) => {
    t = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
    const x = t * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(x));
    const f = x - i;
    const a = rgb[i], b = rgb[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}

export function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export const css = (c: RGB, a = 1) =>
  a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Relative luminance, used to choose a readable label colour. */
export const luminance = (c: RGB) => {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};

// Perceptually ordered sequential ramps.
export const VIRIDIS = stops(['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']);
export const MAGMA = stops(['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf']);
export const PLASMA = stops(['#0d0887', '#5302a3', '#8b0aa5', '#b83289', '#db5c68', '#f48849', '#febd2a', '#f0f921']);
export const CIVIDIS = stops(['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838']);
export const SPECTRAL = stops(['#5e4fa2', '#3288bd', '#66c2a5', '#abdda4', '#e6f598', '#fee08b', '#fdae61', '#f46d43', '#d53e4f', '#9e0142']);
export const RDBU = stops(['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f2f2f2', '#fddbc7', '#f4a582', '#d6604d', '#b2182b']);
export const PUOR = stops(['#2d004b', '#542788', '#8073ac', '#b2abd2', '#e8e8e8', '#fee0b6', '#fdb863', '#e08214', '#b35806']);

export const INFERNO = stops(['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4']);
export const TURBO = stops(['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402']);
export const CUBEHELIX = stops(['#000000', '#1a1530', '#163d4e', '#1f6642', '#54792f', '#a07949', '#d07e93', '#cf9cda', '#c1caf3', '#d2eeef', '#ffffff']);
export const ICE = stops(['#04082e', '#0b2a6b', '#1660a8', '#2f97c9', '#7cc8e0', '#d4f1f7']);
export const FIRE = stops(['#1a0505', '#4a0b07', '#8a1405', '#d83a00', '#ff8c00', '#ffd34d', '#fffbe0']);
export const AURORA = stops(['#0b1d3a', '#164a6b', '#1b7f7a', '#38b26d', '#a6d854', '#f2e86d', '#f7b6d2', '#c77dff']);
export const SUNSET = stops(['#2d1b4e', '#5b2a86', '#9a348e', '#da627d', '#f78e69', '#fdc46e', '#fff1b5']);
export const BRBG = stops(['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f2f2f2', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30']);
export const COOLWARM = stops(['#3b4cc0', '#6688ee', '#9abbff', '#c9d7f0', '#ededed', '#f2cbb7', '#f7a889', '#e26952', '#b40426']);
export const PIYG = stops(['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#f7f7f7', '#b8e186', '#7fbc41', '#4d9221', '#276419']);
export const ICEFIRE = stops(['#3fe0ff', '#2a8fd6', '#24479b', '#1b1d3a', '#111111', '#3d1420', '#8e1f2f', '#e24a33', '#ffb35c']);

// ------------------------------------------------------------ gradient choices
export interface GradientChoice { id: string; label: string; scale: Scale | null }
export const SEQ_GRADIENTS: GradientChoice[] = [
  { id: 'auto', label: 'Per attribute', scale: null },
  { id: 'viridis', label: 'Viridis', scale: VIRIDIS },
  { id: 'magma', label: 'Magma', scale: MAGMA },
  { id: 'inferno', label: 'Inferno', scale: INFERNO },
  { id: 'plasma', label: 'Plasma', scale: PLASMA },
  { id: 'cividis', label: 'Cividis', scale: CIVIDIS },
  { id: 'turbo', label: 'Turbo', scale: TURBO },
  { id: 'spectral', label: 'Spectral', scale: SPECTRAL },
  { id: 'cubehelix', label: 'Cubehelix', scale: CUBEHELIX },
  { id: 'aurora', label: 'Aurora', scale: AURORA },
  { id: 'sunset', label: 'Sunset', scale: SUNSET },
  { id: 'ice', label: 'Ice', scale: ICE },
  { id: 'fire', label: 'Fire', scale: FIRE },
];
export const DIV_GRADIENTS: GradientChoice[] = [
  { id: 'auto', label: 'Per attribute', scale: null },
  { id: 'rdbu', label: 'Red–Blue', scale: RDBU },
  { id: 'coolwarm', label: 'Cool–Warm', scale: COOLWARM },
  { id: 'puor', label: 'Purple–Orange', scale: PUOR },
  { id: 'brbg', label: 'Brown–Teal', scale: BRBG },
  { id: 'piyg', label: 'Pink–Green', scale: PIYG },
  { id: 'icefire', label: 'Ice–Fire', scale: ICEFIRE },
];
let seqOverride: Scale | null = null;
let divOverride: Scale | null = null;
export function setGradients(seq: string, div: string) {
  seqOverride = SEQ_GRADIENTS.find(g => g.id === seq)?.scale ?? null;
  divOverride = DIV_GRADIENTS.find(g => g.id === div)?.scale ?? null;
}
/** The scale actually used for a continuous mode, honouring the user's gradient choice. */
export function scaleFor(mode: ContinuousMode): Scale {
  return (mode.kind === 'div' ? divOverride : seqOverride) ?? mode.scale;
}

// ------------------------------------------------------------ decay colours
export const FAMILY_LABELS: Record<string, string> = {
  S: 'Stable', 'B-': 'β⁻', EC: 'β⁺ / EC', A: 'α', SF: 'Spontaneous fission', P: 'Proton emission',
  N: 'Neutron emission', IT: 'Isomeric transition', CL: 'Cluster decay', U: 'Unknown',
};

export interface DecayPalette { id: string; label: string; c: Record<string, string> }
export const DECAY_PALETTES: DecayPalette[] = [
  { id: 'modern', label: 'Modern', c: { 'B-': '#4a8fe7', EC: '#e8577e', A: '#f5c73b', SF: '#3fbf73', P: '#f39237', N: '#a07ae0', IT: '#aab4bf', CL: '#2ec4c4' } },
  { id: 'classic', label: 'Karlsruhe', c: { 'B-': '#2f6fdf', EC: '#e3262f', A: '#ffe014', SF: '#1fa64a', P: '#ff8a00', N: '#7fd3f7', IT: '#e6e6e6', CL: '#a6409c' } },
  { id: 'okabe', label: 'Colorblind safe', c: { 'B-': '#0072b2', EC: '#d55e00', A: '#f0e442', SF: '#009e73', P: '#e69f00', N: '#56b4e9', IT: '#bbbbbb', CL: '#cc79a7' } },
  { id: 'pastel', label: 'Pastel', c: { 'B-': '#9cc3f5', EC: '#f4a6b8', A: '#fbe29a', SF: '#a8e0b8', P: '#f9c597', N: '#cdb8f3', IT: '#d8dde3', CL: '#9ee3e0' } },
  { id: 'neon', label: 'Neon', c: { 'B-': '#00e5ff', EC: '#ff2fa0', A: '#ffe600', SF: '#39ff14', P: '#ff7b00', N: '#b14dff', IT: '#c8c8c8', CL: '#00ffc8' } },
  { id: 'earth', label: 'Earth', c: { 'B-': '#3f6f8f', EC: '#b5523b', A: '#d9a441', SF: '#5f8f4e', P: '#c97b3a', N: '#7b6aa0', IT: '#a69f94', CL: '#4f9a94' } },
  { id: 'jewel', label: 'Jewel', c: { 'B-': '#1f4fd1', EC: '#c2185b', A: '#f2a900', SF: '#00897b', P: '#e65100', N: '#6a1b9a', IT: '#90a4ae', CL: '#00acc1' } },
];
let decayPal = DECAY_PALETTES[0];
export function setDecayPalette(id: string) {
  decayPal = DECAY_PALETTES.find(p => p.id === id) ?? DECAY_PALETTES[0];
}

/** Theme-dependent cell colours: stable, unknown decay mode and "no data". */
let themeCells = { stable: '#eef0f3', unknown: '#4b5058', missing: '#3a3e46' };
export function setThemeCells(c: { stable: string; unknown: string; missing: string }) {
  themeCells = c;
}

export const familyColor = (f: string, _dark?: boolean): RGB => {
  if (f === 'S') return hex(themeCells.stable);
  if (f === 'U') return hex(themeCells.unknown);
  return hex(decayPal.c[f] ?? themeCells.unknown);
};
export const paletteColor = (p: DecayPalette, f: string) => p.c[f] ?? themeCells.unknown;

const stableSpecial = {
  label: 'Stable',
  color: (_dark: boolean) => familyColor('S'),
};
export const missingColor = (_dark?: boolean): RGB => hex(themeCells.missing);

// ------------------------------------------------------------ formatting
export function fmtNum(v: number, digits = 3): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(digits - 1).replace('e+', 'e');
  return Number(v.toPrecision(digits)).toLocaleString();
}

const TIME_UNITS: [number, string][] = [
  [31557600 * 1e9, 'Gy'], [31557600 * 1e6, 'My'], [31557600 * 1e3, 'ky'], [31557600, 'y'], [86400, 'd'], [3600, 'h'],
  [60, 'min'], [1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns'], [1e-12, 'ps'], [1e-15, 'fs'], [1e-18, 'as'], [1e-21, 'zs'],
];
export function fmtTime(sec: number, digits = 3): string {
  if (!isFinite(sec)) return '∞';
  if (sec <= 0) return '0 s';
  if (sec >= 31557600 * 1e12) return `${(sec / 31557600).toExponential(1).replace('e+', 'e')} y`;
  for (const [f, u] of TIME_UNITS) if (sec >= f * 0.9999) return `${Number((sec / f).toPrecision(digits))} ${u}`;
  return `${sec.toExponential(1)} s`;
}

// ------------------------------------------------------------ activation bins
/** Decade bins for the share of activation production; brightest = most produced. */
export const ACT_BINS = [
  { key: 'a', min: 0.1, label: '≥ 10 %', color: '#fff3a3' },
  { key: 'b', min: 0.01, label: '1 – 10 %', color: '#fb9b06' },
  { key: 'c', min: 1e-3, label: '0.1 – 1 %', color: '#d4433f' },
  { key: 'd', min: 1e-4, label: '0.01 – 0.1 %', color: '#9c2a72' },
  { key: 'e', min: 0, label: '< 0.01 %', color: '#5a3a8c' },
];
export const actBin = (share: number) => (ACT_BINS.find(b => share >= b.min) ?? ACT_BINS[ACT_BINS.length - 1]).key;

// ------------------------------------------------------------ modes
const MeV = (v: number | null) => (v == null ? null : v / 1000);

export const COLOR_MODES: ColorMode[] = [
  {
    id: 'decay', label: 'Decay mode', group: 'Decay', kind: 'cat',
    description: 'Dominant ground-state decay mode (ENSDF).',
    categories: () => ['S', 'B-', 'EC', 'A', 'SF', 'P', 'N', 'CL', 'IT', 'U'].map(k => ({
      key: k, label: FAMILY_LABELS[k], color: familyColor(k),
    })),
    value: nu => nu.primary,
  },
  {
    id: 'halflife', label: 'Half-life', group: 'Decay', kind: 'seq', scale: SPECTRAL, log: true, unit: 's',
    description: 'Ground-state half-life, log scale. Widths given in eV are converted to half-life.',
    value: nu => (nu.st ? null : nu.hl),
    domain: [-9, 17],
    format: v => fmtTime(10 ** v, 2),
    special: nu => (nu.st ? stableSpecial : null),
    specials: [stableSpecial],
  },
  {
    id: 'qbm', label: 'Q(β⁻)', group: 'Energetics', kind: 'div', scale: RDBU, unit: 'MeV',
    description: 'β⁻ decay energy. Positive values (red) are energetically allowed.',
    value: nu => MeV(nu.qbm), center: 0, domain: [-20, 20], format: v => `${fmtNum(v)} MeV`,
  },
  {
    id: 'qec', label: 'Q(EC)', group: 'Energetics', kind: 'div', scale: RDBU, unit: 'MeV',
    description: 'Electron-capture decay energy. Positive values are energetically allowed.',
    value: nu => MeV(nu.qec), center: 0, domain: [-20, 20], format: v => `${fmtNum(v)} MeV`,
  },
  {
    id: 'qa', label: 'Q(α)', group: 'Energetics', kind: 'div', scale: RDBU, unit: 'MeV',
    description: 'α decay energy. Positive values are energetically allowed.',
    value: nu => MeV(nu.qa), center: 0, domain: [-12, 12], format: v => `${fmtNum(v)} MeV`,
  },
  {
    id: 'be', label: 'Binding energy / A', group: 'Energetics', kind: 'seq', scale: MAGMA, unit: 'MeV',
    description: 'Average binding energy per nucleon (AME2020).',
    value: nu => (nu.be == null || nu.a < 2 ? null : nu.be / 1000), domain: [5, 8.8], format: v => `${fmtNum(v, 4)} MeV`,
  },
  {
    id: 'me', label: 'Mass excess', group: 'Energetics', kind: 'div', scale: PUOR, unit: 'MeV',
    description: 'Mass excess Δ = M − A·u (AME2020).',
    value: nu => MeV(nu.me), center: 0, domain: [-100, 100], format: v => `${fmtNum(v, 4)} MeV`,
  },
  {
    id: 'sn', label: 'Neutron separation S(n)', group: 'Energetics', kind: 'seq', scale: VIRIDIS, unit: 'MeV',
    description: 'One-neutron separation energy. Low values mark the neutron drip line.',
    value: nu => MeV(nu.sn), domain: [0, 20], format: v => `${fmtNum(v)} MeV`,
  },
  {
    id: 'sp', label: 'Proton separation S(p)', group: 'Energetics', kind: 'seq', scale: VIRIDIS, unit: 'MeV',
    description: 'One-proton separation energy. Low values mark the proton drip line.',
    value: nu => MeV(nu.sp), domain: [0, 20], format: v => `${fmtNum(v)} MeV`,
  },
  {
    id: 'fy', label: 'Fission yield', group: 'Fission', kind: 'seq', scale: PLASMA, log: true, unit: '',
    description: 'Fission product yield for the selected fissioning system (ENDF/B-VIII.0), log scale.',
    value: (nu, ctx) => (ctx.fy ? ctx.fy[`${nu.z},${nu.n}`]?.[0] ?? null : null),
    domain: [-10, -1.2],
    format: v => `${fmtPct(10 ** v)}`,
  },
  {
    id: 'act', label: 'Share of activation', group: 'Activation', kind: 'cat',
    description: 'Share of everything produced from the chosen target (abundance × σ), in decade bins.',
    categories: () => ACT_BINS.map(b => ({ key: b.key, label: b.label, color: hex(b.color) })),
    value: (nu, ctx) => {
      const v = ctx.act?.get(nu.idx);
      return v == null ? null : actBin(v);
    },
  },
  {
    id: 'spin', label: 'Spin J', group: 'Structure', kind: 'seq', scale: VIRIDIS, unit: 'ħ',
    description: 'Ground-state spin (first assignment; tentative values included).',
    value: nu => nu.j, domain: [0, 10], format: v => `${fmtSpin(v)}`,
  },
  {
    id: 'parity', label: 'Parity', group: 'Structure', kind: 'cat',
    description: 'Ground-state parity. Tentative assignments are shown lighter.',
    categories: () => [
      { key: '+', label: 'Positive (+)', color: hex('#e8577e') },
      { key: '+?', label: 'Positive, tentative', color: hex('#f2a7bb') },
      { key: '-', label: 'Negative (−)', color: hex('#4a8fe7') },
      { key: '-?', label: 'Negative, tentative', color: hex('#a6c8f2') },
    ],
    value: nu => (nu.par == null ? null : (nu.par > 0 ? '+' : '-') + (nu.jt ? '?' : '')),
  },
  {
    id: 'mu', label: 'Magnetic moment μ', group: 'Structure', kind: 'div', scale: RDBU, unit: 'μN',
    description: 'Ground-state magnetic dipole moment.',
    value: nu => nu.mu, center: 0, domain: [-4, 6], format: v => `${fmtNum(v)} μN`,
  },
  {
    id: 'q', label: 'Quadrupole moment Q', group: 'Structure', kind: 'div', scale: RDBU, unit: 'b',
    description: 'Ground-state electric quadrupole moment. Positive = prolate, negative = oblate.',
    value: nu => nu.q, center: 0, domain: [-2, 5], format: v => `${fmtNum(v)} b`,
  },
  {
    id: 'rad', label: 'Charge radius', group: 'Structure', kind: 'seq', scale: VIRIDIS, unit: 'fm',
    description: 'RMS nuclear charge radius.',
    value: nu => (nu.rad != null && nu.rad > 0 ? nu.rad : null), format: v => `${fmtNum(v, 4)} fm`,
  },
  {
    id: 'nz', label: 'N / Z ratio', group: 'Structure', kind: 'seq', scale: CIVIDIS, unit: '',
    description: 'Neutron-to-proton ratio.',
    value: nu => (nu.z > 0 ? nu.n / nu.z : null), domain: [0.5, 1.9], format: v => fmtNum(v, 3),
  },
  {
    id: 'abundance', label: 'Natural abundance', group: 'Other', kind: 'seq', scale: VIRIDIS, log: true, unit: '%',
    description: 'Isotopic abundance in natural elements (atom %), log scale.',
    value: nu => nu.ab, domain: [-4, 2], format: v => `${fmtNum(10 ** v)} %`,
  },
  {
    id: 'disc', label: 'Discovery year', group: 'Other', kind: 'seq', scale: CIVIDIS, unit: '',
    description: 'Year the nuclide was first identified.',
    value: nu => nu.disc, domain: [1900, 2024], format: v => `${Math.round(v)}`,
  },
];

export function fmtPct(frac: number): string {
  const p = frac * 100;
  if (p >= 0.01) return `${Number(p.toPrecision(3))} %`;
  return `${p.toExponential(2).replace('e+', 'e')} %`;
}

export function fmtSpin(j: number): string {
  if (Math.abs(j - Math.round(j)) < 1e-6) return `${Math.round(j)}`;
  return `${Math.round(j * 2)}/2`;
}

// ------------------------------------------------------------ evaluation
export interface Coloring {
  mode: ColorMode;
  colors: RGB[]; // per nuclide index
  values: (number | string | null)[]; // value in colour space (transformed)
  domain: [number, number];
}

export function computeColoring(ds: Dataset, mode: ColorMode, ctx: ColorContext): Coloring {
  const colors: RGB[] = new Array(ds.nuclides.length);
  const values: (number | string | null)[] = new Array(ds.nuclides.length);
  const miss = missingColor(ctx.dark);
  if (mode.kind === 'cat') {
    const map = new Map(mode.categories(ctx.dark).map(c => [c.key, c.color]));
    for (const nu of ds.nuclides) {
      const v = mode.value(nu, ctx);
      values[nu.idx] = v;
      colors[nu.idx] = (v != null && map.get(v)) || miss;
    }
    return { mode, colors, values, domain: [0, 1] };
  }
  const tr = (v: number | null) => (v == null ? null : mode.log ? (v > 0 ? Math.log10(v) : null) : v);
  const raw = ds.nuclides.map(nu => tr(mode.value(nu, ctx)));
  let domain = mode.domain;
  if (!domain) {
    const vs = raw.filter((v): v is number => v != null).sort((a, b) => a - b);
    if (mode.autoSpan != null) domain = vs.length ? [vs[vs.length - 1] - mode.autoSpan, vs[vs.length - 1]] : [0, 1];
    else domain = vs.length ? [vs[Math.floor(vs.length * 0.01)], vs[Math.floor(vs.length * 0.99)]] : [0, 1];
    if (!(domain[1] > domain[0])) domain = [domain[0] - 1, domain[0] + 1];
  }
  const [d0, d1] = domain;
  const c = mode.center;
  const scale = scaleFor(mode);
  for (const nu of ds.nuclides) {
    const v = raw[nu.idx];
    values[nu.idx] = v;
    const sp = mode.special?.(nu);
    if (sp) { colors[nu.idx] = sp.color(ctx.dark); continue; }
    if (v == null) { colors[nu.idx] = miss; continue; }
    let t: number;
    if (mode.kind === 'div' && c != null) {
      t = v < c ? 0.5 - 0.5 * Math.min(1, (c - v) / (c - d0)) : 0.5 + 0.5 * Math.min(1, (v - c) / (d1 - c));
    } else t = (v - d0) / (d1 - d0);
    colors[nu.idx] = scale(t);
  }
  return { mode, colors, values, domain };
}

/** Position (0..1) of a transformed value along a mode's legend bar. */
export function legendPos(col: Coloring, v: number): number {
  const m = col.mode as ContinuousMode;
  const [d0, d1] = col.domain;
  if (m.kind === 'div' && m.center != null) {
    const c = m.center;
    return v < c ? 0.5 - 0.5 * Math.min(1, (c - v) / (c - d0)) : 0.5 + 0.5 * Math.min(1, (v - c) / (d1 - c));
  }
  return Math.min(1, Math.max(0, (v - d0) / (d1 - d0)));
}

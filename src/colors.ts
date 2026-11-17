// Colour modes: how each nuclide's cell gets its colour.
import type { Dataset, Nuclide } from './data';

export type RGB = [number, number, number];

export interface ColorContext {
  fy: Record<string, [number, number]> | null;
  fyLabel: string;
  /** Activation production weight per nuclide index (barns per target atom). */
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

// ------------------------------------------------------------ decay colours
export const FAMILY: Record<string, { label: string; color: string; dark?: string }> = {
  S: { label: 'Stable', color: '#1b1d22', dark: '#eef0f3' },
  'B-': { label: 'β⁻', color: '#4a8fe7' },
  EC: { label: 'β⁺ / EC', color: '#e8577e' },
  A: { label: 'α', color: '#f5c73b' },
  SF: { label: 'Spontaneous fission', color: '#3fbf73' },
  P: { label: 'Proton emission', color: '#f39237' },
  N: { label: 'Neutron emission', color: '#a07ae0' },
  IT: { label: 'Isomeric transition', color: '#aab4bf' },
  CL: { label: 'Cluster decay', color: '#2ec4c4' },
  U: { label: 'Unknown', color: '#c5c9cf', dark: '#4b5058' },
};
export const familyColor = (f: string, dark: boolean): RGB => {
  const e = FAMILY[f] ?? FAMILY.U;
  return hex(dark && e.dark ? e.dark : e.color);
};

const stableSpecial = {
  label: 'Stable',
  color: (dark: boolean) => familyColor('S', dark),
};
const missingColor = (dark: boolean): RGB => (dark ? [58, 62, 70] : [214, 217, 222]);
export { missingColor };

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

// ------------------------------------------------------------ modes
const MeV = (v: number | null) => (v == null ? null : v / 1000);

export const COLOR_MODES: ColorMode[] = [
  {
    id: 'decay', label: 'Decay mode', group: 'Decay', kind: 'cat',
    description: 'Dominant ground-state decay mode (ENSDF).',
    categories: dark => ['S', 'B-', 'EC', 'A', 'SF', 'P', 'N', 'CL', 'IT', 'U'].map(k => ({
      key: k, label: FAMILY[k].label, color: familyColor(k, dark),
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
    id: 'act', label: 'Activation production', group: 'Activation', kind: 'seq', scale: t => MAGMA(0.2 + 0.8 * t), log: true, unit: 'b',
    description: 'Production per target atom: abundance × cross section, log scale.',
    value: (nu, ctx) => ctx.act?.get(nu.idx) ?? null,
    autoSpan: 5,
    format: v => `${fmtNum(10 ** v)} b`,
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
    colors[nu.idx] = mode.scale(t);
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

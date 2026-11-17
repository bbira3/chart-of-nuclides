// Pointwise neutron cross sections σ(E), built by scripts/build_xs.py from ENDF/B-VIII.0.
import { REACTION_COLORS } from './activation';

export interface XsCurve {
  mt: number;
  /** log10(E / eV) */
  lx: Float64Array;
  /** log10(σ / b) */
  ly: Float64Array;
  /** Largest log10 σ on the curve. */
  peak: number;
}

export interface XsData {
  T: number;
  /** Resolved and unresolved resonance ranges, eV. */
  rr: [number, number][];
  ur: [number, number][];
  curves: XsCurve[];
}

export interface XsReaction { label: string; name: string; color: string; dz: number; dn: number; topic: string }

/** Reactions in the plot files, in legend order. Empty color means the theme's text color. */
export const XS_REACTIONS: Record<number, XsReaction> = {
  1: { label: 'total', name: 'Total', color: '', dz: 0, dn: 0, topic: 'rx-total' },
  2: { label: 'n,n', name: 'Elastic', color: '#9aa9b8', dz: 0, dn: 0, topic: 'rx-elastic' },
  4: { label: "n,n′", name: 'Inelastic', color: '#c9a27a', dz: 0, dn: 0, topic: 'rx-inelastic' },
  18: { label: 'n,f', name: 'Fission', color: '#ff6b4a', dz: 0, dn: 0, topic: 'rx-fission' },
  102: { label: 'n,γ', name: 'Capture', color: REACTION_COLORS['n,γ'], dz: 0, dn: 1, topic: 'rx-ng' },
  16: { label: 'n,2n', name: '', color: REACTION_COLORS['n,2n'], dz: 0, dn: -1, topic: 'rx-n2n' },
  17: { label: 'n,3n', name: '', color: REACTION_COLORS['n,3n'], dz: 0, dn: -2, topic: 'rx-n3n' },
  103: { label: 'n,p', name: '', color: REACTION_COLORS['n,p'], dz: -1, dn: 1, topic: 'rx-np' },
  104: { label: 'n,d', name: '', color: REACTION_COLORS['n,d'], dz: -1, dn: 0, topic: 'rx-nd' },
  28: { label: 'n,np', name: '', color: '#d48bd6', dz: -1, dn: 0, topic: 'rx-nnp' },
  105: { label: 'n,t', name: '', color: REACTION_COLORS['n,t'], dz: -1, dn: -1, topic: 'rx-nt' },
  106: { label: 'n,³He', name: '', color: REACTION_COLORS['n,³He'], dz: -2, dn: 0, topic: 'rx-nhe3' },
  107: { label: 'n,α', name: '', color: REACTION_COLORS['n,α'], dz: -2, dn: -1, topic: 'rx-na' },
  22: { label: 'n,nα', name: '', color: REACTION_COLORS['n,nα'], dz: -2, dn: -2, topic: 'rx-nna' },
};
export const XS_ORDER = [1, 2, 4, 18, 102, 16, 17, 103, 104, 28, 105, 106, 107, 22];

const base = () => `${import.meta.env.BASE_URL}data/xs/`;

let indexPromise: Promise<Record<string, number[]>> | null = null;
/** Which targets have plots: {"z,n": [mt, ...]}. */
export function loadXsIndex() {
  indexPromise ??= fetch(`${base()}index.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  return indexPromise;
}

const cache = new Map<string, Promise<XsData>>();
export function loadXs(z: number, n: number): Promise<XsData> {
  const key = `${z}_${n}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`${base()}${key}.json`).then(async r => {
      if (!r.ok) throw new Error(`No cross sections for ${key}`);
      return decode(await r.json());
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

interface RawXs { T: number; rr: [number, number][]; ur: [number, number][]; x: Record<string, number[]> }

/** Undo the delta encoding: [dx0, dy0, dx1, dy1, ...] in units of 1e-4 decades. */
function decode(raw: RawXs): XsData {
  const curves: XsCurve[] = [];
  for (const [k, d] of Object.entries(raw.x)) {
    const n = d.length >> 1;
    const lx = new Float64Array(n), ly = new Float64Array(n);
    let x = 0, y = 0, peak = -Infinity;
    for (let i = 0; i < n; i++) {
      x += d[2 * i]; y += d[2 * i + 1];
      lx[i] = x * 1e-4; ly[i] = y * 1e-4;
      if (ly[i] > peak) peak = ly[i];
    }
    curves.push({ mt: +k, lx, ly, peak });
  }
  curves.sort((a, b) => XS_ORDER.indexOf(a.mt) - XS_ORDER.indexOf(b.mt));
  return { T: raw.T, rr: raw.rr, ur: raw.ur, curves };
}

/** log10 σ at log10 E (linear in log-log), or null outside the curve. */
export function xsAt(c: XsCurve, lx: number): number | null {
  const x = c.lx;
  if (!x.length || lx < x[0] || lx > x[x.length - 1]) return null;
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (x[m] <= lx) lo = m; else hi = m;
  }
  const t = x[hi] > x[lo] ? (lx - x[lo]) / (x[hi] - x[lo]) : 0;
  return c.ly[lo] + (c.ly[hi] - c.ly[lo]) * t;
}

/** "6.67 eV", "2.53 meV", "14.1 MeV". */
export function fmtEnergy(ev: number, digits = 3): string {
  const units: [number, string][] = [[1e6, 'MeV'], [1e3, 'keV'], [1, 'eV'], [1e-3, 'meV'], [1e-6, 'µeV']];
  for (const [f, u] of units) if (ev >= f * 0.9999) return `${trim(ev / f, digits)} ${u}`;
  return `${trim(ev / 1e-6, digits)} µeV`;
}

/** "2.68 b", "37.2 kb", "1.2 mb". */
export function fmtBarn(b: number, digits = 3): string {
  const units: [number, string][] = [[1e6, 'Mb'], [1e3, 'kb'], [1, 'b'], [1e-3, 'mb'], [1e-6, 'µb'], [1e-9, 'nb']];
  for (const [f, u] of units) if (b >= f * 0.9999) return `${trim(b / f, digits)} ${u}`;
  return `${trim(b / 1e-9, digits)} nb`;
}

function trim(v: number, digits: number) {
  return String(Number(v.toPrecision(digits)));
}

// Data loading, types and the decay graph.

export interface RawDecay {
  m: string; // mode label as given by ENSDF (B-, EC+B+, A, B-N, ...)
  p: number | null; // percentage of all decays
  u: number | null; // uncertainty of p
  dz: number | null;
  dn: number | null;
  f: string; // family: B-, EC, A, SF, P, N, IT, CL
  d: boolean; // delayed mode (already included in its parent family's percentage)
}

/** Ground-state record. Null and false fields are omitted from the JSON (read as undefined). */
export interface RawNuclide {
  z: number; n: number; a: number; s: string;
  hl: number | null; st: boolean; hlt: string;
  jp: string | null; j: number | null; par: number | null; jt: boolean;
  ab: number | null;
  me: number | null; meu: number | null; mes: boolean;
  be: number | null;
  qbm: number | null; qbn: number | null; qa: number | null; qec: number | null;
  sn: number | null; sp: number | null;
  rad: number | null; mu: number | null; q: number | null;
  disc: number | null;
  dec: RawDecay[];
}

export interface Branch {
  mode: string;
  family: string;
  /** Fraction of all decays going down this branch (0..1). */
  frac: number;
  /** False when ENSDF gives no percentage and the value was inferred. */
  known: boolean;
  /** Percentage exactly as reported (null if missing). */
  pct: number | null;
  unc: number | null;
  delayed: boolean;
  target: Nuclide | null;
  /** True when the daughter falls outside the table (unknown nuclide). */
  offChart: boolean;
}

export interface Nuclide extends RawNuclide {
  idx: number;
  id: string; // "Cs-137"
  name: string; // "Caesium-137"
  /** Decay constant in 1/s (0 for stable). */
  lambda: number;
  branches: Branch[];
  /** Dominant decay family, used for decay-mode colouring. */
  primary: string;
  /** Primordial: has a natural abundance. */
  natural: boolean;
}

export interface FySystem {
  id: string; target: string; tz: number; ta: number; meta: string;
  energy: number; elabel: string; spont: boolean; count: number;
}

export interface FyData {
  id: string;
  ind: Record<string, [number, number]>;
  cum: Record<string, [number, number]>;
}

export interface Meta {
  built: string;
  sources: { name: string; url: string; api?: string }[];
  elements: string[];
  elementNames: string[];
}

export class Dataset {
  readonly nuclides: Nuclide[];
  readonly meta: Meta;
  readonly maxZ: number;
  readonly maxN: number;
  private byKey = new Map<number, Nuclide>();
  /** Min/max N for each Z (row extents). */
  readonly rows: { z: number; nMin: number; nMax: number }[] = [];

  constructor(raw: { meta: Meta; nuclides: RawNuclide[] }) {
    this.meta = raw.meta;
    const names = raw.meta.elementNames;
    this.nuclides = raw.nuclides.map((r, idx) => {
      const id = r.z === 0 ? `n-${r.a}` : `${r.s}-${r.a}`;
      const nm = r.z === 0 ? (r.a === 1 ? 'Neutron' : `${r.a}n`) : `${names[r.z] ?? r.s}-${r.a}`;
      const lambda = r.st || r.hl == null ? 0 : Math.LN2 / Math.max(r.hl, 1e-30);
      return { ...r, dec: r.dec ?? [], st: !!r.st, idx, id, name: nm, lambda, branches: [], primary: 'U', natural: r.ab != null && r.ab > 0 };
    });
    let maxZ = 0, maxN = 0;
    for (const nu of this.nuclides) {
      this.byKey.set(key(nu.z, nu.n), nu);
      maxZ = Math.max(maxZ, nu.z);
      maxN = Math.max(maxN, nu.n);
      let row = this.rows[nu.z];
      if (!row) this.rows[nu.z] = row = { z: nu.z, nMin: nu.n, nMax: nu.n };
      row.nMin = Math.min(row.nMin, nu.n);
      row.nMax = Math.max(row.nMax, nu.n);
    }
    this.maxZ = maxZ;
    this.maxN = maxN;
    for (const nu of this.nuclides) this.buildBranches(nu);
  }

  get(z: number, n: number): Nuclide | undefined {
    return this.byKey.get(key(z, n));
  }

  byId(id: string): Nuclide | undefined {
    const [z, n] = id.split(',').map(Number);
    return this.get(z, n);
  }

  /** Turn ENSDF decay percentages into branch fractions that sum to at most 1. */
  private buildBranches(nu: Nuclide) {
    if (nu.st) { nu.primary = 'S'; return; }
    const direct = nu.dec.filter(d => !d.d);
    const delayed = nu.dec.filter(d => d.d);
    if (direct.length === 0 && delayed.length === 0) { nu.primary = 'U'; return; }

    // Fill in missing percentages.
    const knownSum = direct.reduce((s, d) => s + (d.p ?? 0), 0);
    const unknown = direct.filter(d => d.p == null);
    const fill = unknown.length ? Math.max(0, 100 - knownSum) / unknown.length : 0;
    const pcts = direct.map(d => (d.p != null ? d.p : (unknown.length === direct.length && direct.length === 1 ? 100 : fill)));
    const total = pcts.reduce((s, p) => s + p, 0);
    const norm = total > 100 ? 100 / total : 1;

    // Delayed modes are included in their family's percentage.
    const delayedByFam = new Map<string, number>();
    for (const d of delayed) delayedByFam.set(d.f, (delayedByFam.get(d.f) ?? 0) + (d.p ?? 0));

    const branches: Branch[] = [];
    direct.forEach((d, i) => {
      let p = pcts[i] * norm;
      const sub = delayedByFam.get(d.f) ?? 0;
      if (sub) p = Math.max(0, p - sub * norm);
      branches.push(this.makeBranch(nu, d, p / 100, d.p != null || direct.length === 1));
    });
    for (const d of delayed) {
      branches.push(this.makeBranch(nu, d, ((d.p ?? 0) * norm) / 100, d.p != null));
    }
    nu.branches = branches;

    // Primary family = largest share by family, counting delayed modes toward their family.
    const famShare = new Map<string, number>();
    for (const b of branches) famShare.set(b.family, (famShare.get(b.family) ?? 0) + Math.max(b.frac, 1e-9));
    let best = 'U', bestV = -1;
    for (const [f, v] of famShare) if (v > bestV) { best = f; bestV = v; }
    nu.primary = best;
  }

  private makeBranch(nu: Nuclide, d: RawDecay, frac: number, known: boolean): Branch {
    let target: Nuclide | null = null;
    let offChart = false;
    if (d.dz != null && d.dn != null && !(d.dz === 0 && d.dn === 0)) {
      target = this.get(nu.z + d.dz, nu.n + d.dn) ?? null;
      offChart = target == null;
    }
    return { mode: d.m, family: d.f, frac, known, pct: d.p, unc: d.u, delayed: d.d, target, offChart };
  }
}

export const key = (z: number, n: number) => z * 1000 + n;

export async function loadDataset(): Promise<Dataset> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/nuclides.json`);
  if (!res.ok) throw new Error(`Failed to load nuclide data (${res.status})`);
  return new Dataset(await res.json());
}

export async function loadFyIndex(): Promise<FySystem[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/fy/index.json`);
  if (!res.ok) throw new Error('Failed to load fission-yield index');
  return (await res.json()).systems;
}

const fyCache = new Map<string, Promise<FyData>>();
export function loadFy(id: string): Promise<FyData> {
  let p = fyCache.get(id);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/fy/${id}.json`).then(r => {
      if (!r.ok) throw new Error(`Failed to load yields ${id}`);
      return r.json();
    });
    fyCache.set(id, p);
  }
  return p;
}

// Neutron activation: which products form when a target is irradiated.
import type { Dataset, Nuclide } from './data';

export type Spectrum = 0 | 1 | 2; // thermal, fission, 14 MeV
export const SPECTRA = ['Thermal', 'Fission', '14 MeV'];

export interface ActData {
  spectra: string[];
  reactions: Record<string, [string, number, number]>;
  targets: Record<string, Record<string, [number, number, number]>>;
}

export interface ActReaction {
  target: Nuclide;
  product: Nuclide | null;
  mt: number;
  label: string;
  /** Cross section in barns for the chosen spectrum. */
  sigma: number;
  /** Target atom fraction (abundance) times sigma: barns per atom of element. */
  weight: number;
}

export interface ActProduct {
  product: Nuclide;
  weight: number;
  reactions: ActReaction[];
}

let actPromise: Promise<ActData> | null = null;
export function loadActivation(): Promise<ActData> {
  actPromise ??= fetch(`${import.meta.env.BASE_URL}data/activation.json`).then(r => {
    if (!r.ok) throw new Error('Failed to load activation data');
    return r.json();
  });
  return actPromise;
}

/** Reactions on a single nuclide, for the detail panel. */
export function reactionsOn(ds: Dataset, act: ActData, nu: Nuclide) {
  const e = act.targets[`${nu.z},${nu.n}`];
  if (!e) return [];
  return Object.entries(e)
    .map(([mt, sig]) => {
      const [label, dz, dn] = act.reactions[mt];
      return { mt: +mt, label, sig, product: ds.get(nu.z + dz, nu.n + dn) ?? null };
    })
    .sort((a, b) => Math.max(...b.sig) - Math.max(...a.sig));
}

/**
 * Targets: a natural element (all isotopes weighted by abundance), or a single nuclide.
 */
export function activate(ds: Dataset, act: ActData, targets: { nu: Nuclide; frac: number }[], sp: Spectrum) {
  const reactions: ActReaction[] = [];
  for (const { nu, frac } of targets) {
    const e = act.targets[`${nu.z},${nu.n}`];
    if (!e) continue;
    for (const [mt, sig] of Object.entries(e)) {
      const sigma = sig[sp];
      if (!(sigma > 0)) continue;
      const [label, dz, dn] = act.reactions[mt];
      reactions.push({
        target: nu, product: ds.get(nu.z + dz, nu.n + dn) ?? null, mt: +mt, label, sigma, weight: sigma * frac,
      });
    }
  }
  const byProduct = new Map<number, ActProduct>();
  for (const r of reactions) {
    if (!r.product) continue;
    let p = byProduct.get(r.product.idx);
    if (!p) byProduct.set(r.product.idx, (p = { product: r.product, weight: 0, reactions: [] }));
    p.weight += r.weight;
    p.reactions.push(r);
  }
  const products = [...byProduct.values()].sort((a, b) => b.weight - a.weight);
  for (const p of products) p.reactions.sort((a, b) => b.weight - a.weight);
  return { reactions, products };
}

/** Natural isotopes of an element (abundance > 0), as target fractions. */
export function naturalTargets(ds: Dataset, z: number) {
  return ds.nuclides.filter(nu => nu.z === z && nu.ab != null && nu.ab > 0).map(nu => ({ nu, frac: nu.ab! / 100 }));
}

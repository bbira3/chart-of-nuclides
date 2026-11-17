// Decay-chain traversal: everything reachable from a nuclide, with probabilities.
import type { Branch, Nuclide } from './data';

export interface ChainEdge {
  from: Nuclide;
  to: Nuclide;
  branch: Branch;
  /** Probability that a decay of the chain head travels along this edge. */
  flow: number;
}

export interface Chain {
  head: Nuclide;
  /** Nuclides in topological order, head first. */
  nodes: Nuclide[];
  /** Probability that the head eventually passes through each node. */
  prob: Map<number, number>;
  /** Shortest step count from the head to each node. */
  depth: Map<number, number>;
  edges: ChainEdge[];
  /** End points: stable nuclides, or unstable ones with no known decay. */
  ends: { nuclide: Nuclide; prob: number }[];
  /** Fraction lost to fission or to daughters outside the table. */
  fission: number;
  offChart: number;
}

const cache = new Map<number, Chain>();

export function decayChain(head: Nuclide): Chain {
  const hit = cache.get(head.idx);
  if (hit) return hit;

  // 1. Find everything reachable, recording depth.
  const reach = new Map<number, Nuclide>([[head.idx, head]]);
  const depth = new Map<number, number>([[head.idx, 0]]);
  const queue: Nuclide[] = [head];
  while (queue.length) {
    const nu = queue.shift()!;
    for (const b of nu.branches) {
      const t = b.target;
      if (!t || t === nu) continue;
      if (!reach.has(t.idx)) {
        reach.set(t.idx, t);
        depth.set(t.idx, depth.get(nu.idx)! + 1);
        queue.push(t);
      }
    }
  }

  // 2. Topologically sort the reachable subgraph (Kahn). Cycles should not occur
  //    in real data; if one does, the leftover nodes are appended in BFS order.
  const indeg = new Map<number, number>();
  for (const nu of reach.values()) indeg.set(nu.idx, 0);
  for (const nu of reach.values())
    for (const b of nu.branches) if (b.target && b.target !== nu) indeg.set(b.target.idx, indeg.get(b.target.idx)! + 1);
  const order: Nuclide[] = [];
  const ready = [head];
  const placed = new Set<number>();
  while (ready.length) {
    const nu = ready.shift()!;
    if (placed.has(nu.idx)) continue;
    placed.add(nu.idx);
    order.push(nu);
    for (const b of nu.branches) {
      const t = b.target;
      if (!t || t === nu) continue;
      const d = indeg.get(t.idx)! - 1;
      indeg.set(t.idx, d);
      if (d === 0) ready.push(t);
    }
  }
  for (const nu of reach.values()) if (!placed.has(nu.idx)) order.push(nu);

  // 3. Push probability downstream.
  const prob = new Map<number, number>([[head.idx, 1]]);
  const edges: ChainEdge[] = [];
  let fission = 0, offChart = 0;
  const ends: { nuclide: Nuclide; prob: number }[] = [];
  for (const nu of order) {
    const p = prob.get(nu.idx) ?? 0;
    if (nu.branches.length === 0) {
      ends.push({ nuclide: nu, prob: p });
      continue;
    }
    for (const b of nu.branches) {
      const flow = p * b.frac;
      if (b.target && b.target !== nu) {
        prob.set(b.target.idx, (prob.get(b.target.idx) ?? 0) + flow);
        edges.push({ from: nu, to: b.target, branch: b, flow });
      } else if (b.family === 'SF' || b.mode.endsWith('SF')) {
        fission += flow;
      } else if (b.offChart) {
        offChart += flow;
      }
    }
  }
  ends.sort((a, b) => b.prob - a.prob);

  const chain: Chain = { head, nodes: order, prob, depth, edges, ends, fission, offChart };
  cache.set(head.idx, chain);
  return chain;
}

/** The single most probable path from the head to a stable end point. */
export function mainPath(chain: Chain): Nuclide[] {
  const path = [chain.head];
  let cur = chain.head;
  const seen = new Set([cur.idx]);
  for (;;) {
    let best: Branch | null = null;
    for (const b of cur.branches) if (b.target && !seen.has(b.target.idx) && (!best || b.frac > best.frac)) best = b;
    if (!best || !best.target) break;
    cur = best.target;
    seen.add(cur.idx);
    path.push(cur);
  }
  return path;
}

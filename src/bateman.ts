// Analytic Bateman solution for a decay network in topological order.
//
// Each inventory is a sum of exponentials, N_i(t) = sum_j C[i][j] exp(-lambda_j t).
// Substituting into dN_i/dt = -lambda_i N_i + sum_p b_pi lambda_p N_p gives
//   C[i][j] = sum_p b_pi lambda_p C[p][j] / (lambda_i - lambda_j)   (j != i)
//   C[i][i] = N0_i - sum_{j != i} C[i][j]
// Equal decay constants along a path are nudged apart slightly.

export interface SimNode {
  lambda: number;
  parents: { i: number; b: number }[];
}

export interface SimInput {
  nodes: SimNode[];
  n0: number[];
  times: number[];
}

export interface SimOutput {
  /** atoms[i][t] */
  atoms: Float64Array[];
  /** activity[i][t] = lambda_i * atoms */
  activity: Float64Array[];
}

export function solveBateman(inp: SimInput): SimOutput {
  const { nodes, n0, times } = inp;
  const n = nodes.length;
  const lam = nodes.map(nd => nd.lambda);

  // Separate any equal non-zero decay constants.
  const seen = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (lam[i] === 0) continue;
    let l = lam[i];
    while (seen.has(l)) l *= 1 + 1e-6;
    lam[i] = l;
    seen.set(l, i);
  }

  // Sparse rows: for node i, map j -> C[i][j].
  const rows: Map<number, number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Map<number, number>();
    for (const { i: p, b } of nodes[i].parents) {
      const pr = rows[p];
      if (!pr) continue;
      const f = b * lam[p];
      if (f === 0) continue;
      for (const [j, c] of pr) {
        const d = lam[i] - lam[j];
        if (d === 0) continue;
        row.set(j, (row.get(j) ?? 0) + (f * c) / d);
      }
    }
    let sum = 0;
    for (const c of row.values()) sum += c;
    row.set(i, (row.get(i) ?? 0) + n0[i] - sum);
    rows[i] = row;
  }

  const T = times.length;
  const atoms: Float64Array[] = [];
  const activity: Float64Array[] = [];
  const expCache = new Map<number, Float64Array>();
  const expOf = (j: number) => {
    let e = expCache.get(j);
    if (!e) {
      e = new Float64Array(T);
      const l = lam[j];
      for (let t = 0; t < T; t++) e[t] = Math.exp(-l * times[t]);
      expCache.set(j, e);
    }
    return e;
  };
  for (let i = 0; i < n; i++) {
    const a = new Float64Array(T);
    for (const [j, c] of rows[i]) {
      if (c === 0) continue;
      const e = expOf(j);
      for (let t = 0; t < T; t++) a[t] += c * e[t];
    }
    const act = new Float64Array(T);
    const li = nodes[i].lambda;
    for (let t = 0; t < T; t++) {
      if (!(a[t] > 1e-300)) a[t] = 0;
      act[t] = li * a[t];
    }
    atoms.push(a);
    activity.push(act);
  }
  return { atoms, activity };
}

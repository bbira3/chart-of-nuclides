#!/usr/bin/env python3
"""
Build pointwise cross-section files for the σ(E) plots.

    python scripts/build_xs.py            # all targets, in parallel
    python scripts/build_xs.py U-238 Fe-56

Reads data/raw/ENDF-B-VIII.0_neutrons.zip (downloaded by build_data.py) and writes
public/data/xs/<z>_<n>.json plus public/data/xs/index.json. Needs numpy.
See endf_xs.py for the physics and its simplifications.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from endf_neutron import split_sections  # noqa: E402
from endf_xs import KT, encode, iter_targets, target_curves  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ZIP = ROOT / "data" / "raw" / "ENDF-B-VIII.0_neutrons.zip"
OUT = ROOT / "public" / "data" / "xs"


def sig(v: float, n: int = 5) -> float:
    return float(f"{v:.{n}g}")


def one(z: int, a: int, text: str):
    t = time.time()
    curves, info = target_curves(split_sections(text))
    x = {}
    for mt, (e, s) in curves.items():
        enc = encode(e, s, tol=0.006)
        if enc and len(enc) >= 4:
            x[str(mt)] = enc
    doc = {"T": 293.6, "rr": [[sig(a_), sig(b_)] for a_, b_ in info["rr"]],
           "ur": [[sig(a_), sig(b_)] for a_, b_ in info["ur"]], "x": x}
    path = OUT / f"{z}_{a - z}.json"
    path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return z, a, path.stat().st_size, time.time() - t, sorted(int(k) for k in x)


def main():
    want = {w.lower() for w in sys.argv[1:]}
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for z, a, name, text in iter_targets(ZIP):
        sym = name.split("_")[1]
        if want and f"{sym}-{a}".lower() not in want:
            continue
        jobs.append((z, a, text))
    print(f"{len(jobs)} targets, kT = {KT:.5f} eV")
    done, total = [], 0
    with ProcessPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(one, *j): j[:2] for j in sorted(jobs, key=lambda j: -len(j[2]))}
        for f in as_completed(futs):
            z, a = futs[f]
            try:
                z, a, size, dt, mts = f.result()
            except Exception as e:  # keep going; one bad evaluation shouldn't stop the build
                print(f"  FAILED z={z} a={a}: {e!r}", flush=True)
                continue
            total += size
            done.append((z, a, mts))
            if dt > 20 or len(done) % 50 == 0:
                print(f"  {len(done):4d}/{len(jobs)}  z={z} a={a}  {size / 1024:.0f} kB  {dt:.0f}s", flush=True)
    if not want:
        index = {f"{z},{a - z}": mts for z, a, mts in sorted(done)}
        (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(done)} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Build the data files used by the Chart of Nuclides web app.

Sources
-------
1. IAEA Nuclear Data Section, LiveChart of Nuclides API (ground states).
   https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all
   The data are evaluated from ENSDF, with masses from AME2020 and
   ground-state properties from NUBASE2020.
2. ENDF/B-VIII.0 fission product yield sublibraries (NNDC, BNL):
     - nfy (neutron-induced fission yields), MF=8 MT=454/459
     - sfy (spontaneous fission yields), MF=8 MT=454/459
   https://www.nndc.bnl.gov/endf-b8.0/

Usage
-----
    python scripts/build_data.py            # uses cached raw files when present
    python scripts/build_data.py --refresh  # re-download everything

Outputs go to public/data/:
    nuclides.json       ground-state table and decay branches
    fy/index.json       list of fissioning systems
    fy/<id>.json        independent and cumulative yields for each system

Only the Python standard library is needed.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

LIVECHART_URL = "https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all"
NFY_URL = "https://www.nndc.bnl.gov/endf-b8.0/zips/ENDF-B-VIII.0_nfy.zip"
SFY_URL = "https://www.nndc.bnl.gov/endf-b8.0/zips/ENDF-B-VIII.0_sfy.zip"
NEUTRON_URL = "https://www.nndc.bnl.gov/endf-b8.0/zips/ENDF-B-VIII.0_neutrons.zip"

ELEMENTS = (
    "n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn "
    "Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr "
    "Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra "
    "Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
).split()

ELEMENT_NAMES = (
    "neutron,Hydrogen,Helium,Lithium,Beryllium,Boron,Carbon,Nitrogen,Oxygen,Fluorine,Neon,"
    "Sodium,Magnesium,Aluminium,Silicon,Phosphorus,Sulfur,Chlorine,Argon,Potassium,Calcium,"
    "Scandium,Titanium,Vanadium,Chromium,Manganese,Iron,Cobalt,Nickel,Copper,Zinc,Gallium,"
    "Germanium,Arsenic,Selenium,Bromine,Krypton,Rubidium,Strontium,Yttrium,Zirconium,Niobium,"
    "Molybdenum,Technetium,Ruthenium,Rhodium,Palladium,Silver,Cadmium,Indium,Tin,Antimony,"
    "Tellurium,Iodine,Xenon,Caesium,Barium,Lanthanum,Cerium,Praseodymium,Neodymium,Promethium,"
    "Samarium,Europium,Gadolinium,Terbium,Dysprosium,Holmium,Erbium,Thulium,Ytterbium,Lutetium,"
    "Hafnium,Tantalum,Tungsten,Rhenium,Osmium,Iridium,Platinum,Gold,Mercury,Thallium,Lead,"
    "Bismuth,Polonium,Astatine,Radon,Francium,Radium,Actinium,Thorium,Protactinium,Uranium,"
    "Neptunium,Plutonium,Americium,Curium,Berkelium,Californium,Einsteinium,Fermium,"
    "Mendelevium,Nobelium,Lawrencium,Rutherfordium,Dubnium,Seaborgium,Bohrium,Hassium,"
    "Meitnerium,Darmstadtium,Roentgenium,Copernicium,Nihonium,Flerovium,Moscovium,"
    "Livermorium,Tennessine,Oganesson"
).split(",")

UA = {"User-Agent": "Mozilla/5.0 (chart-of-nuclides data builder)"}


# --------------------------------------------------------------------------- io
def fetch(url: str, dest: Path, refresh: bool) -> Path:
    if dest.exists() and not refresh:
        print(f"  cached  {dest.relative_to(ROOT)}")
        return dest
    print(f"  fetch   {url}")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def num(s: str) -> float | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def rnd(v: float | None, sig: int = 6) -> float | None:
    if v is None:
        return None
    if v == 0:
        return 0
    return float(f"{v:.{sig}g}")


# ------------------------------------------------------------------ decay modes
# Each mode maps to the (dZ, dN) of the daughter. None means no single daughter
# (fission). "Delayed" modes (B-N, ECP, ...) are reported by ENSDF as a fraction of
# all decays that is *included* in the parent beta/EC percentage, so the
# app subtracts them from the parent branch when it builds chains.
CLUSTERS = {"14C": (6, 8), "24NE": (10, 14), "{+22}NE": (10, 12), "{+24}NE": (10, 14),
            "{+25}NE": (10, 15), "{+34}SI": (14, 20), "34SI": (14, 20), "{+28}MG": (12, 16)}


def mode_info(mode: str):
    """Return (canonical_mode, dZ, dN, family, delayed) or None for unusable modes."""
    m = mode.strip().upper()
    if not m:
        return None
    if m in CLUSTERS:
        z, n = CLUSTERS[m]
        label = re.sub(r"[{}+]", "", mode)
        label = re.sub(r"(\d+)([A-Za-z]+)", lambda mt: mt.group(1) + mt.group(2).capitalize(), label)
        return (label, -z, -n, "CL", False)
    if m == "MG":  # cluster emission with unspecified mass
        return ("Mg", None, None, "CL", False)
    if m in ("SF",):
        return ("SF", None, None, "SF", False)
    if m == "IT":
        return ("IT", 0, 0, "IT", False)
    if m == "A":
        return ("A", -2, -2, "A", False)
    if m == "P":
        return ("P", -1, 0, "P", False)
    if m == "2P":
        return ("2P", -2, 0, "P", False)
    if m == "N":
        return ("N", 0, -1, "N", False)
    if m == "2N":
        return ("2N", 0, -2, "N", False)
    if m == "B-":
        return ("B-", 1, -1, "B-", False)
    if m == "2B-":
        return ("2B-", 2, -2, "B-", False)
    if m in ("EC", "B+", "EC+B+"):
        return (m, -1, 1, "EC", False)
    if m in ("2EC", "2B+"):
        return (m, -2, 2, "EC", False)
    if m == "SF+EC+B+":
        return ("SF+EC+B+", None, None, "SF", False)
    mm = re.fullmatch(r"B-(\d*)N", m)
    if mm:
        k = int(mm.group(1) or 1)
        return (m, 1, -1 - k, "B-", True)
    if m == "B-A":
        return (m, -1, -3, "B-", True)
    if m == "B-P":
        return (m, 0, -1, "B-", True)
    if m == "B-SF":
        return (m, None, None, "B-", True)
    mm = re.fullmatch(r"(EC|B\+)(\d*)P", m)
    if mm:
        k = int(mm.group(2) or 1)
        return (m, -1 - k, 1, "EC", True)
    if m in ("ECA", "B+A"):
        return (m, -3, -1, "EC", True)
    if m == "ECSF":
        return (m, None, None, "EC", True)
    print(f"  warning: unknown decay mode {mode!r}", file=sys.stderr)
    return None


# ------------------------------------------------------------------- livechart
HL_UNIT_LABEL = {"Y": "y", "d": "d", "h": "h", "m": "min", "s": "s", "ms": "ms", "us": "µs",
                 "ns": "ns", "ps": "ps", "fs": "fs", "as": "as", "eV": "eV", "keV": "keV",
                 "MeV": "MeV"}
OP_LABEL = {"GT": ">", "LT": "<", "GE": "≥", "LE": "≤", "AP": "≈"}


def parse_jp(jp: str):
    """Return (spin_value, parity, tentative) from ENSDF J-pi strings like '(5/2+)'."""
    s = (jp or "").strip()
    if not s:
        return None, None, False
    tentative = "(" in s or "[" in s
    first = re.split(r"[,&]|OR", s.replace(" ", ""))[0]
    first = first.replace("(", "").replace(")", "").replace("[", "").replace("]", "")
    par = None
    if first.endswith("+"):
        par = 1
    elif first.endswith("-"):
        par = -1
    if "(" in s and par is not None and re.search(r"\d\)?[+-]?\)?[+-]", s) is None:
        pass
    mm = re.match(r"(\d+)(?:/(\d+))?", first)
    spin = None
    if mm:
        spin = int(mm.group(1)) / (int(mm.group(2)) if mm.group(2) else 1)
    return spin, par, tentative


def build_nuclides(csv_path: Path):
    rows = list(csv.DictReader(io.StringIO(csv_path.read_text(encoding="utf-8"))))
    out = []
    modes_seen = set()
    for r in rows:
        if not (r.get("z") or "").isdigit():
            continue
        z, n = int(r["z"]), int(r["n"])
        a = z + n
        hl_txt = (r["half_life"] or "").strip()
        stable = hl_txt.upper() == "STABLE"
        hl_sec = num(r["half_life_sec"])
        unit = (r["unit_hl"] or "").strip()
        op = OP_LABEL.get((r["operator_hl"] or "").strip(), "")
        if stable:
            hl_label = "Stable"
        elif hl_txt and hl_txt != "?":
            unc = (r["unc_hl"] or "").strip()
            hl_label = f"{op}{hl_txt} {HL_UNIT_LABEL.get(unit, unit)}".strip()
            if unit in ("eV", "keV", "MeV"):
                hl_label = f"Γ {op}{hl_txt} {unit}"
            if unc and not op:
                hl_label += f" ({unc})"
        else:
            hl_label = "Unknown"

        decays = []
        for k in (1, 2, 3):
            mode = (r[f"decay_{k}"] or "").strip()
            info = mode_info(mode)
            if not info:
                continue
            label, dz, dn, fam, delayed = info
            modes_seen.add(label)
            pct = num(r[f"decay_{k}_%"])
            unc = num(r[f"unc_{k}"])
            decays.append({"m": label, "p": rnd(pct, 6), "u": rnd(unc, 3),
                           "dz": dz, "dn": dn, "f": fam, "d": delayed})

        spin, parity, tent = parse_jp(r["jp"])
        ba = num(r["binding"])  # keV per nucleon (AME binding energy / A)
        disc = num(r["discovery"])
        out.append({
            "z": z, "n": n, "a": a,
            "s": ELEMENTS[z] if z < len(ELEMENTS) else r["symbol"],
            "hl": None if stable else rnd(hl_sec, 6),
            "st": stable,
            "hlt": hl_label,
            "hlu": rnd(num(r["unc_hls"]), 4),
            "jp": (r["jp"] or "").strip() or None,
            "j": spin, "par": parity, "jt": tent,
            "ab": rnd(num(r["abundance"]), 6),
            "abu": rnd(num(r["unc_a"]), 4),
            "me": rnd(num(r["massexcess"]), 9),        # keV
            "meu": rnd(num(r["unc_me"]), 4),
            "mes": (r["me_systematics"] or "").strip().upper() == "Y",
            "am": rnd(num(r["atomic_mass"]), 12),       # micro-u
            "be": rnd(ba, 8),                           # keV/nucleon
            "qbm": rnd(num(r["qbm"]), 8),               # keV
            "qbn": rnd(num(r["qbm_n"]), 8),
            "qa": rnd(num(r["qa"]), 8),
            "qec": rnd(num(r["qec"]), 8),
            "sn": rnd(num(r["sn"]), 8),
            "sp": rnd(num(r["sp"]), 8),
            "rad": rnd(num(r["radius"]), 5),            # fm, rms charge radius
            "mu": rnd(num(r["magnetic_dipole"]), 6),
            "q": rnd(num(r["electric_quadrupole"]), 6),
            "disc": int(disc) if disc else None,
            "dec": decays,
        })
    out.sort(key=lambda x: (x["z"], x["n"]))
    print(f"  {len(out)} ground states, decay modes: {sorted(modes_seen)}")
    return out


# ------------------------------------------------------------------------ ENDF
_ENDF_FLOAT = re.compile(r"^([+-]?\d*\.?\d*)([+-]\d+)$")


def endf_float(s: str) -> float:
    s = s.strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        m = _ENDF_FLOAT.match(s.replace(" ", ""))
        if not m:
            raise
        return float(f"{m.group(1)}e{m.group(2)}")


def parse_mf8_yields(text: str):
    """Parse MF=8 MT=454 and MT=459 sections. Returns {mt: [(E, [(za, fps, y, dy), ...])]}."""
    lines = text.splitlines()
    sections: dict[int, list[str]] = {454: [], 459: []}
    za = None
    for ln in lines:
        if len(ln) < 75:
            continue
        try:
            mf = int(ln[70:72])
            mt = int(ln[72:75])
        except ValueError:
            continue
        if mf == 8 and mt in sections:
            sections[mt].append(ln)
    res = {}
    for mt, sec in sections.items():
        if not sec:
            continue
        head = sec[0]
        za = endf_float(head[0:11])
        le_plus_1 = int(head[22:33])
        pos = 1
        energies = []
        for _ in range(le_plus_1):
            cont = sec[pos]
            energy = endf_float(cont[0:11])
            nn = int(cont[44:55])
            nfp = int(cont[55:66])
            pos += 1
            vals = []
            while len(vals) < nn:
                ln = sec[pos]
                for k in range(6):
                    if len(vals) >= nn:
                        break
                    vals.append(endf_float(ln[11 * k:11 * (k + 1)]))
                pos += 1
            recs = [(int(round(vals[4 * i])), int(round(vals[4 * i + 1])), vals[4 * i + 2], vals[4 * i + 3])
                    for i in range(nfp)]
            energies.append((energy, recs))
        res[mt] = energies
    return int(round(za)) if za else None, res


def energy_label(e: float, spontaneous: bool) -> tuple[str, str]:
    if spontaneous:
        return "sf", "Spontaneous fission"
    if e < 1.0:
        return "t", "Thermal (0.0253 eV)"
    if e >= 1e7:
        return "h", f"High energy ({e/1e6:g} MeV)"
    if e >= 1e5:
        return "f", f"Fast ({e/1e6:g} MeV)"
    return f"e{int(e)}", f"{e/1e3:g} keV"


def build_yields(zip_path: Path, prefix: str, spontaneous: bool):
    systems = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in sorted(zf.namelist()):
            if not name.endswith(".endf"):
                continue
            base = Path(name).stem  # nfy-092_U_235 or nfy-095_Am_242m1
            mm = re.match(r"[ns]fy-(\d+)_([A-Za-z]+)_(\d+)(m\d)?", base)
            if not mm:
                continue
            tz, tsym, ta, meta = int(mm.group(1)), mm.group(2), int(mm.group(3)), mm.group(4) or ""
            text = zf.read(name).decode("latin-1")
            _, data = parse_mf8_yields(text)
            ind = data.get(454, [])
            cum = data.get(459, [])
            for i, (energy, recs) in enumerate(ind):
                key, elabel = energy_label(energy, spontaneous)
                tgt = f"{tsym}-{ta}{'m' if meta else ''}"
                sid = f"{tsym}{ta}{meta}_{key}"
                crecs = cum[i][1] if i < len(cum) else []
                systems.append({
                    "id": sid, "target": tgt, "tz": tz, "ta": ta, "meta": meta,
                    "energy": energy, "ek": key, "elabel": elabel,
                    "spont": spontaneous,
                    "ind": collapse(recs, cumulative=False),
                    "cum": collapse(crecs, cumulative=True),
                })
    return systems


def collapse(recs, cumulative: bool):
    """Collapse isomeric states into one value per (Z, N).

    Independent: sum over all states. Cumulative: ground-state value if present,
    otherwise the sum (the isomer's cumulative yield includes its own feeding).
    """
    by = {}
    for za, fps, y, dy in recs:
        z, a = za // 1000, za % 1000
        key = f"{z},{a - z}"
        e = by.setdefault(key, {"y": 0.0, "dy2": 0.0, "g": None, "states": 0})
        e["states"] += 1
        if cumulative and fps == 0:
            e["g"] = (y, dy)
        e["y"] += y
        e["dy2"] += dy * dy
    out = {}
    for key, e in by.items():
        if cumulative and e["g"] is not None:
            y, dy = e["g"]
        else:
            y, dy = e["y"], math.sqrt(e["dy2"])
        if y > 0:
            out[key] = [rnd(y, 5), rnd(dy, 3)]
    return out


# ------------------------------------------------------------------------ main
def main():
    refresh = "--refresh" in sys.argv
    print("Raw data")
    gs = fetch(LIVECHART_URL, RAW / "livechart_ground_states.csv", refresh)
    nfy = fetch(NFY_URL, RAW / "ENDF-B-VIII.0_nfy.zip", refresh)
    sfy = fetch(SFY_URL, RAW / "ENDF-B-VIII.0_sfy.zip", refresh)
    neut = fetch(NEUTRON_URL, RAW / "ENDF-B-VIII.0_neutrons.zip", refresh)

    print("Ground states")
    nucl = build_nuclides(gs)

    print("Fission yields")
    systems = build_yields(nfy, "nfy", False) + build_yields(sfy, "sfy", True)
    # Make ids unique if any collisions remain.
    seen = {}
    for s in systems:
        if s["id"] in seen:
            seen[s["id"]] += 1
            s["id"] += f"_{seen[s['id']]}"
        else:
            seen[s["id"]] = 0
    print(f"  {len(systems)} fissioning systems")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "fy").mkdir(exist_ok=True)
    for old in (OUT / "fy").glob("*.json"):
        old.unlink()

    meta = {
        "built": date.today().isoformat(),
        "sources": [
            {"name": "IAEA LiveChart of Nuclides (ENSDF / NUBASE2020 / AME2020)",
             "url": "https://www-nds.iaea.org/relnsd/vcharthtml/VChartHTML.html",
             "api": LIVECHART_URL},
            {"name": "ENDF/B-VIII.0 Neutron & Spontaneous Fission Yield sublibraries (NNDC/BNL)",
             "url": "https://www.nndc.bnl.gov/endf-b8.0/"},
        ],
        "elements": ELEMENTS,
        "elementNames": ELEMENT_NAMES,
    }
    def compact(d):
        # Null/false fields are omitted; the app treats missing as null.
        return {k: (v if k != "dec" else [{kk: vv for kk, vv in x.items() if vv is not None and vv is not False} for x in v])
                for k, v in d.items() if v is not None and v is not False and k not in ("am", "hlu", "abu")}
    with open(OUT / "nuclides.json", "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "nuclides": [compact(x) for x in nucl]}, f, separators=(",", ":"), ensure_ascii=False)

    index = []
    for s in systems:
        index.append({k: s[k] for k in ("id", "target", "tz", "ta", "meta", "energy", "elabel", "spont")}
                     | {"count": len(s["ind"])})
        with open(OUT / "fy" / f"{s['id']}.json", "w", encoding="utf-8") as f:
            json.dump({"id": s["id"], "ind": s["ind"], "cum": s["cum"]}, f, separators=(",", ":"))
    with open(OUT / "fy" / "index.json", "w", encoding="utf-8") as f:
        json.dump({"source": "ENDF/B-VIII.0", "systems": index}, f, separators=(",", ":"))

    print("Neutron reactions")
    from endf_neutron import REACTIONS, build_activation
    act = build_activation(neut, rnd)
    print(f"  {len(act)} targets")
    with open(OUT / "activation.json", "w", encoding="utf-8") as f:
        json.dump({
            "source": "ENDF/B-VIII.0 neutron sublibrary",
            "spectra": ["Thermal (0.0253 eV)", "Fission spectrum (Watt, U-235)", "14 MeV (D-T)"],
            "reactions": {str(mt): list(v) for mt, v in REACTIONS.items()},
            "targets": {k: {str(mt): v for mt, v in e.items()} for k, e in act.items()},
        }, f, separators=(",", ":"), ensure_ascii=False)

    size = (OUT / "nuclides.json").stat().st_size
    print(f"Wrote public/data/nuclides.json ({size/1e6:.2f} MB) and {len(systems)} yield files")


if __name__ == "__main__":
    main()

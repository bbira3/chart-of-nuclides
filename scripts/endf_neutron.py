"""
Neutron reaction cross sections from the ENDF/B-VIII.0 neutron sublibrary,
reduced to three spectra for exploring activation:

  th  : thermal point, 0.0253 eV (2200 m/s)
  fs  : averaged over a U-235 thermal-fission (Watt) spectrum
  14  : 14 MeV (D-T fusion neutrons)

Resolved resonances are reconstructed at 0.0253 eV with a single-level
Breit-Wigner sum over the parameters in MF=2 (LRF=1/2/3/7), plus the MF=3
background. This is an approximation of the full multi-level formalism.
It is usually within a few percent at thermal energy and is good enough for
exploration.
"""
from __future__ import annotations

import math
import re
import zipfile
from bisect import bisect_right

# reaction MT -> (label, dZ, dN of the residual nucleus relative to the target)
REACTIONS = {
    102: ("n,γ", 0, 1),
    16: ("n,2n", 0, -1),
    17: ("n,3n", 0, -2),
    103: ("n,p", -1, 1),
    104: ("n,d", -1, 0),
    28: ("n,np", -1, 0),
    105: ("n,t", -1, -1),
    106: ("n,³He", -2, 0),
    107: ("n,α", -2, -1),
    22: ("n,nα", -2, -2),
}
# Partial (level) MTs that sum to the lumped reaction when it is missing.
PARTIALS = {103: range(600, 650), 104: range(650, 700), 105: range(700, 750),
            106: range(750, 800), 107: range(800, 850)}

E_TH = 0.0253


def f(s: str) -> float:
    s = s.strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        m = re.match(r"^([+-]?[\d.]+)([+-]\d+)$", s.replace(" ", ""))
        if not m:
            return 0.0
        return float(f"{m.group(1)}e{m.group(2)}")


def i(s: str) -> int:
    s = s.strip()
    return int(s) if s else 0


class Section:
    """Sequential reader over the lines of one MF/MT section."""

    def __init__(self, lines):
        self.lines = lines
        self.pos = 0

    def cont(self):
        ln = self.lines[self.pos]
        self.pos += 1
        return (f(ln[0:11]), f(ln[11:22]), i(ln[22:33]), i(ln[33:44]), i(ln[44:55]), i(ln[55:66]))

    def values(self, n):
        out = []
        while len(out) < n:
            ln = self.lines[self.pos]
            self.pos += 1
            for k in range(6):
                if len(out) >= n:
                    break
                out.append(f(ln[11 * k:11 * (k + 1)]))
        return out

    def ints(self, n):
        out = []
        while len(out) < n:
            ln = self.lines[self.pos]
            self.pos += 1
            for k in range(6):
                if len(out) >= n:
                    break
                out.append(i(ln[11 * k:11 * (k + 1)]))
        return out

    def list(self):
        c = self.cont()
        return c, self.values(c[4])

    def tab1(self):
        c = self.cont()
        nr, np_ = c[4], c[5]
        interp = self.ints(2 * nr)
        xy = self.values(2 * np_)
        return c, Tab1(interp[0::2], interp[1::2], xy[0::2], xy[1::2])


class Tab1:
    def __init__(self, nbt, ints, x, y):
        self.nbt, self.int, self.x, self.y = nbt, ints, x, y

    def law(self, k):  # k: index of the upper point of the interval (1-based count)
        for nb, law in zip(self.nbt, self.int):
            if k <= nb:
                return law
        return self.int[-1] if self.int else 2

    def __call__(self, e):
        x, y = self.x, self.y
        if not x or e < x[0] or e > x[-1]:
            return 0.0
        j = bisect_right(x, e)
        if j >= len(x):
            return y[-1]
        if j == 0:
            return y[0]
        x0, x1, y0, y1 = x[j - 1], x[j], y[j - 1], y[j]
        if x1 == x0:
            return y1
        law = self.law(j + 1)
        if law == 1:
            return y0
        if law == 3 and x0 > 0 and x1 > 0:
            return y0 + (y1 - y0) * math.log(e / x0) / math.log(x1 / x0)
        if law == 4 and y0 > 0 and y1 > 0:
            return y0 * math.exp(math.log(y1 / y0) * (e - x0) / (x1 - x0))
        if law == 5 and x0 > 0 and x1 > 0 and y0 > 0 and y1 > 0:
            return y0 * math.exp(math.log(y1 / y0) * math.log(e / x0) / math.log(x1 / x0))
        return y0 + (y1 - y0) * (e - x0) / (x1 - x0)


def split_sections(text: str):
    secs = {}
    for ln in text.splitlines():
        if len(ln) < 75:
            continue
        try:
            mf, mt = int(ln[70:72]), int(ln[72:75])
        except ValueError:
            continue
        if mt == 0 or mf == 0:
            continue
        secs.setdefault((mf, mt), []).append(ln)
    return secs


# ----------------------------------------------------------- resonances
def penet(l: int, rho: float) -> float:
    r2 = rho * rho
    if l == 0:
        return rho
    if l == 1:
        return rho * r2 / (1 + r2)
    if l == 2:
        return rho * r2 * r2 / (9 + 3 * r2 + r2 * r2)
    return rho ** (2 * l + 1) / (1 + r2) ** l  # rough, negligible at thermal


def thermal_resonance(sec_lines):
    """Return ({mt: sigma_barn at 0.0253 eV}, EH of the resolved range) using an SLBW sum."""
    s = Section(sec_lines)
    za, awr, _, _, nis, _ = s.cont()
    out: dict[int, float] = {}
    eh_res = 0.0
    try:
        for _ in range(nis):
            zai, abn, _, lfw, ner, _ = s.cont()
            for _ in range(ner):
                el, eh, lru, lrf, nro, naps = s.cont()
                if nro:
                    s.tab1()
                if lru == 0:
                    s.cont()
                    continue
                if lru != 1 or not (el <= E_TH <= eh):
                    return out, max(eh_res, eh if lru == 1 else eh_res)
                eh_res = eh
                if lrf in (1, 2, 3):
                    _resolve_bw(s, lrf, awr, out)
                elif lrf == 7:
                    _resolve_rml(s, awr, out)
                return out, eh_res
    except (IndexError, ValueError):
        pass
    return out, eh_res


def _k(awri, e):
    # Neutron wave number in 1e-12 cm^-1 (ENDF-6 manual, D.1.1)
    return 2.196807e-3 * awri / (awri + 1.0) * math.sqrt(abs(e))


def _resolve_bw(s: Section, lrf: int, awr: float, out):
    spi, ap, _, _, nls, _ = s.cont()
    e = E_TH
    for _ in range(nls):
        (awri, qx_or_apl, l, _, _, nrs), vals = s.list()
        a = 0.123 * awri ** (1 / 3) + 0.08  # channel radius in 1e-12 cm
        k = _k(awri, e)
        pik2 = math.pi / (k * k)
        pe = penet(l, k * a)
        for r in range(nrs):
            er, aj, g1, g2, g3, g4 = vals[6 * r:6 * r + 6]
            if lrf in (1, 2):
                gt, gn, gg, gf = g1, g2, g3, g4
            else:  # Reich-Moore: ER, AJ, GN, GG, GFA, GFB
                gn, gg, gf = g1, g2, abs(g3) + abs(g4)
            gj = (2 * abs(aj) + 1) / (2 * (2 * spi + 1))
            pr = penet(l, _k(awri, er) * a) if er != 0 else pe
            gne = abs(gn) * (pe / pr if pr > 0 else 1.0)
            gtot = gne + abs(gg) + abs(gf)
            den = (e - er) ** 2 + (gtot / 2) ** 2
            out[102] = out.get(102, 0.0) + pik2 * gj * gne * abs(gg) / den


def _resolve_rml(s: Section, awr: float, out):
    _, _, ifg, krm, njs, krl = s.cont()
    (_, _, npp, _, _, _), pp = s.list()
    pairs = [pp[12 * p:12 * p + 12] for p in range(npp)]  # MA MB ZA ZB IA IB Q PNT SHF MT PA PB
    e = E_TH
    for _ in range(njs):
        (aj, pj, kbk, kps, _, nch), chv = s.list()
        chans = [chv[6 * c:6 * c + 6] for c in range(nch)]  # PPI L SCH BND APE APT
        (_, _, _, nrs, _, _), rv = s.list()
        nx = len(rv)
        if nrs == 0:
            if kbk or kps:
                return
            continue
        per = nx // nrs if nrs else 0
        # Spin factor uses the target spin from the neutron pair (pair with MT=2).
        npair = next((p for p in pairs if int(round(p[9])) == 2), None)
        if npair is None:
            return
        ia = npair[4]
        gj = (2 * abs(aj) + 1) / (2 * (2 * ia + 1))
        k = _k(awr, e)
        pik2 = math.pi / (k * k)
        for r in range(nrs):
            row = rv[per * r:per * r + nch + 1]
            er = row[0]
            widths = row[1:]
            gn_e = 0.0
            others = {}
            for c, ch in enumerate(chans):
                ppi, l = int(round(ch[0])), int(round(ch[1]))
                mt = int(round(pairs[ppi - 1][9])) if 0 < ppi <= len(pairs) else 0
                w = abs(widths[c]) if c < len(widths) else 0.0
                if mt == 2:
                    a = ch[4] if ch[4] > 0 else 0.123 * awr ** (1 / 3) + 0.08
                    pe = penet(l, _k(awr, e) * a)
                    pr = penet(l, _k(awr, er) * a) if er != 0 else pe
                    gn_e += w * (pe / pr if pr > 0 else 1.0)
                else:
                    others[mt] = others.get(mt, 0.0) + w
            gtot = gn_e + sum(others.values())
            den = (e - er) ** 2 + (gtot / 2) ** 2
            for mt, w in others.items():
                key = 102 if mt in (102,) else mt
                if 600 <= mt < 650:
                    key = 103
                elif 800 <= mt < 850:
                    key = 107
                if key in REACTIONS:
                    out[key] = out.get(key, 0.0) + pik2 * gj * gn_e * w / den
        if kbk or kps:
            return  # background/phase records follow; stop rather than mis-parse


# ----------------------------------------------------------- spectra
def watt(e_ev: float) -> float:
    e = e_ev / 1e6
    a, b = 0.988, 2.249
    return math.exp(-e / a) * math.sinh(math.sqrt(b * e))


# Log grid for spectrum averaging (1 keV .. 20 MeV); Watt weight below 1 keV is ~1e-5.
_GRID = [10 ** (3 + 4.31 * k / 600) for k in range(601)]
_W = []
for _k_ in range(len(_GRID) - 1):
    e0, e1 = _GRID[_k_], _GRID[_k_ + 1]
    em = math.sqrt(e0 * e1)
    _W.append(watt(em) * (e1 - e0))
_WSUM = sum(_W)


def fission_average(tab: Tab1) -> float:
    tot = 0.0
    for k in range(len(_GRID) - 1):
        em = math.sqrt(_GRID[k] * _GRID[k + 1])
        tot += tab(em) * _W[k]
    return tot / _WSUM


# ----------------------------------------------------------- driver
def build_activation(zip_path, rnd):
    """Return {"z,n": {mt: [th, fs, e14]}} for every target in the library."""
    result = {}
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.endswith(".endf")]
        for name in sorted(names):
            m = re.search(r"n-(\d+)_([A-Za-z]+)_(\d+)(m\d)?\.endf$", name)
            if not m or m.group(4):  # skip isomeric targets
                continue
            z, a = int(m.group(1)), int(m.group(3))
            if a == 0:  # elemental evaluations (e.g. C-0)
                continue
            secs = split_sections(zf.read(name).decode("latin-1"))
            res, eh_res = ({}, 0.0)
            if (2, 151) in secs:
                res, eh_res = thermal_resonance(secs[(2, 151)])
            tabs = {}
            for (mf, mt), lines in secs.items():
                if mf != 3:
                    continue
                try:
                    sec = Section(lines)
                    sec.cont()  # HEAD
                    _, t = sec.tab1()
                except (IndexError, ValueError):
                    continue
                tabs[mt] = t
            entry = {}
            for mt in REACTIONS:
                parts = [tabs[mt]] if mt in tabs else [tabs[p] for p in PARTIALS.get(mt, []) if p in tabs]
                th = res.get(mt, 0.0) + sum(t(E_TH) for t in parts)
                if parts:
                    fs = sum(fission_average(t) for t in parts)
                    e14 = sum(t(14e6) for t in parts)
                else:
                    fs = e14 = 0.0
                if max(th, fs, e14) <= 1e-9:
                    continue
                entry[mt] = [rnd(th, 4), rnd(fs, 4), rnd(e14, 4)]
            if entry:
                result[f"{z},{a - z}"] = entry
    return result

"""
Pointwise neutron cross sections σ(E) from ENDF/B-VIII.0, for plotting.

For every target in the neutron sublibrary:

  1. Resolved resonances (MF=2) are reconstructed on an adaptive energy grid with
     the formalism the evaluation uses: SLBW (LRF=1), MLBW (LRF=2), Reich-Moore
     (LRF=3) or R-matrix limited in the Reich-Moore approximation (LRF=7; charged
     particle penetrabilities are taken as constant). The MF=3 background is added.
  2. Unresolved resonance averages are added when the evaluation asks for it
     (LSSF=0), without width-fluctuation corrections.
  3. The result is Doppler-broadened to 293.6 K with the exact free-gas kernel
     (a Gaussian in sqrt(E) space, including the low-energy term).
  4. Each curve is thinned for drawing on log-log axes and written in a compact
     delta-encoded form.

The aim is a faithful picture for exploration, not a processing code such as
NJOY: small differences in the elastic cross section near resonances and in the
unresolved range are expected.

Needs numpy.
"""
from __future__ import annotations

import math
import re
import zipfile

import numpy as np

from endf_neutron import Section, split_sections

KT = 8.617333262e-5 * 293.6      # eV
K0 = 2.196807122623e-3            # sqrt(2 m_n)/hbar in 1/(1e-12 cm sqrt(eV))
E_MIN, E_MAX = 1e-5, 2e7

# Reactions written to the plot files, and where to find them if the lumped MT is missing.
PLOT_MTS = [1, 2, 4, 18, 102, 16, 17, 22, 28, 103, 104, 105, 106, 107]
PARTIALS = {4: range(51, 92), 18: (19, 20, 21, 38), 103: range(600, 650), 104: range(650, 700),
            105: range(700, 750), 106: range(750, 800), 107: range(800, 850)}


def lump(mt: int) -> int:
    """Map a partial MT (e.g. MT=600, an (n,p) to the ground state) to the plotted reaction."""
    if 51 <= mt <= 91:
        return 4
    for k, r in PARTIALS.items():
        if mt in r:
            return k
    return mt


# ------------------------------------------------------------------ tabulated functions
class Tab:
    def __init__(self, t):
        self.x = np.asarray(t.x, float)
        self.y = np.asarray(t.y, float)
        self.nbt = np.asarray(t.nbt, int)
        self.law = np.asarray(t.int, int)

    def __call__(self, e):
        e = np.asarray(e, float)
        x, y = self.x, self.y
        if len(x) < 2:
            return np.zeros_like(e)
        j = np.clip(np.searchsorted(x, e, side="right"), 1, len(x) - 1)
        x0, x1, y0, y1 = x[j - 1], x[j], y[j - 1], y[j]
        law = self.law[np.clip(np.searchsorted(self.nbt, j + 1, side="left"), 0, len(self.law) - 1)] \
            if len(self.law) else np.full(e.shape, 2)
        with np.errstate(all="ignore"):
            dx = x1 - x0
            t = np.where(dx > 0, (e - x0) / np.where(dx > 0, dx, 1), 0.0)
            r = y0 + (y1 - y0) * t
            r = np.where(law == 1, y0, r)
            lx = (x0 > 0) & (x1 > 0) & (e > 0)
            ly = (y0 > 0) & (y1 > 0)
            tl = np.where(lx, np.log(np.where(lx, e / np.where(x0 > 0, x0, 1), 1)) /
                          np.log(np.where(lx & (x1 != x0), x1 / np.where(x0 > 0, x0, 1), 2)), 0.0)
            r = np.where((law == 3) & lx, y0 + (y1 - y0) * tl, r)
            ry = np.where(ly, np.log(np.where(ly, y1 / np.where(y0 > 0, y0, 1), 1)), 0.0)
            r = np.where((law == 4) & ly, y0 * np.exp(ry * t), r)
            r = np.where((law == 5) & lx & ly, y0 * np.exp(ry * tl), r)
            r = np.where(dx > 0, r, y1)
        inside = (e >= x[0]) & (e <= x[-1])
        return np.where(inside, np.nan_to_num(r), 0.0)

    def sample(self, per_decade=60):
        """Its own points plus a log grid, so log-log drawing follows the stated interpolation."""
        x = self.x[self.x > 0]
        if len(x) < 2:
            return x, self(x)
        lo, hi = math.log10(max(x[0], E_MIN)), math.log10(min(x[-1], E_MAX))
        g = np.logspace(lo, hi, max(2, int((hi - lo) * per_decade)))
        e = np.unique(np.concatenate([x[(x >= E_MIN) & (x <= E_MAX)], g]))
        return e, self(e)


# ------------------------------------------------------------------ hard-sphere functions
def pen_shift(l, rho):
    r2 = rho * rho
    if l == 0:
        return rho, np.zeros_like(rho)
    if l == 1:
        d = 1 + r2
        return rho * r2 / d, -1 / d
    if l == 2:
        d = 9 + 3 * r2 + r2 * r2
        return rho * r2 * r2 / d, -(18 + 3 * r2) / d
    if l == 3:
        d = 225 + 45 * r2 + 6 * r2 ** 2 + r2 ** 3
        return rho * r2 ** 3 / d, -(675 + 90 * r2 + 6 * r2 ** 2) / d
    d = 11025 + 1575 * r2 + 135 * r2 ** 2 + 10 * r2 ** 3 + r2 ** 4
    return rho * r2 ** 4 / d, -(44100 + 4725 * r2 + 270 * r2 ** 2 + 10 * r2 ** 3) / d


def phase(l, h):
    if l == 0:
        return h
    if l == 1:
        return h - np.arctan2(h, 1.0)
    h2 = h * h
    if l == 2:
        return h - np.arctan2(3 * h, 3 - h2)
    if l == 3:
        return h - np.arctan2(h * (15 - h2), 15 - 6 * h2)
    return h - np.arctan2(h * (105 - 10 * h2), 105 - 45 * h2 + h2 * h2)


def chunks(n, m, budget=3_000_000):
    step = max(64, budget // max(1, m))
    for a in range(0, n, step):
        yield slice(a, min(n, a + step))


# ------------------------------------------------------------------ MF=2 parsing
def parse_mf2(lines):
    """Return (awr, [range dict, ...]). Unknown or unsupported pieces are skipped."""
    s = Section(lines)
    _, awr, _, _, nis, _ = s.cont()
    ranges = []
    for _ in range(nis):
        _, abn, _, lfw, ner, _ = s.cont()
        for _ in range(ner):
            el, eh, lru, lrf, nro, naps = s.cont()
            rng = dict(el=el, eh=eh, lru=lru, lrf=lrf, naps=naps, abn=abn, ap_tab=None, ok=True)
            if nro:
                _, t = s.tab1()
                rng["ap_tab"] = Tab(t)
            if lru == 0:
                spi, ap, *_ = s.cont()
                rng.update(spi=spi, ap=ap)
            elif lru == 1 and lrf in (1, 2, 3):
                spi, ap, _, _, nls, _ = s.cont()
                ls = []
                for _ in range(nls):
                    (awri, apl_or_qx, l, lrx, _, nrs), v = s.list()
                    res = np.asarray(v, float).reshape(nrs, 6) if nrs else np.zeros((0, 6))
                    ls.append(dict(awri=awri, apl=apl_or_qx if lrf == 3 else 0.0, l=l, lrx=lrx, res=res))
                rng.update(spi=spi, ap=ap, ls=ls)
            elif lru == 1 and lrf == 7:
                _, _, ifg, krm, njs, krl = s.cont()
                (_, _, npp, _, _, _), pp = s.list()
                pairs = [pp[12 * p:12 * p + 12] for p in range(npp)]
                groups = []
                for _ in range(njs):
                    (aj, pj, kbk, kps, _, nch), chv = s.list()
                    chans = [chv[6 * c:6 * c + 6] for c in range(nch)]
                    (_, _, _, nrs, _, nx), rv = s.list()
                    per = (len(rv) // nrs) if nrs else 0
                    res = np.asarray([rv[per * r:per * r + nch + 1] for r in range(nrs)], float) \
                        if nrs else np.zeros((0, nch + 1))
                    groups.append(dict(aj=aj, chans=chans, res=res))
                    if kbk or kps:
                        rng["ok"] = len(groups) > 0
                        break  # background R-matrix / phase records are not read
                rng.update(ifg=ifg, krm=krm, pairs=pairs, groups=groups)
                if ifg != 0 or krm not in (2, 3):
                    rng["ok"] = False
            elif lru == 2:
                rng.update(parse_urr(s, lrf, lfw))
            else:
                rng["ok"] = False
                ranges.append(rng)
                return awr, ranges
            ranges.append(rng)
    return awr, ranges


def parse_urr(s: Section, lrf: int, lfw: int):
    out = dict(ls=[])
    if lrf == 1 and lfw == 0:
        spi, ap, lssf, _, nls, _ = s.cont()
        for _ in range(nls):
            (awri, _, l, _, _, njs), v = s.list()
            js = []
            for j in range(njs):
                d, aj, amun, gno, gg, _ = v[6 * j:6 * j + 6]
                js.append(dict(aj=aj, amun=amun, es=None, d=d, gn0=gno, gg=gg, gf=0.0, gx=0.0))
            out["ls"].append(dict(awri=awri, l=l, js=js))
    elif lrf == 1:
        (spi, ap, lssf, _, ne, nls), es = s.list()
        for _ in range(nls):
            awri, _, l, _, njs, _ = s.cont()
            js = []
            for _ in range(njs):
                _, v = s.list()
                d, aj, amun, gno, gg, _ = v[:6]
                js.append(dict(aj=aj, amun=amun, es=np.asarray(es), d=d, gn0=gno, gg=gg,
                               gf=np.asarray(v[6:6 + ne]), gx=0.0))
            out["ls"].append(dict(awri=awri, l=l, js=js))
    else:
        spi, ap, lssf, _, nls, _ = s.cont()
        for _ in range(nls):
            awri, _, l, _, njs, _ = s.cont()
            js = []
            for _ in range(njs):
                (aj, _, _, _, _, ne), v = s.list()
                amun = v[3]
                tab = np.asarray(v[6:6 + 6 * ne], float).reshape(ne, 6)
                js.append(dict(aj=aj, amun=amun, es=tab[:, 0], d=tab[:, 1], gx=tab[:, 2],
                               gn0=tab[:, 3], gg=tab[:, 4], gf=tab[:, 5]))
            out["ls"].append(dict(awri=awri, l=l, js=js))
    out.update(spi=spi, ap=ap, lssf=lssf)
    return out


# ------------------------------------------------------------------ resolved formalisms
def _radii(rng, awri, E):
    """(radius for penetrability, radius for phase shift) in 1e-12 cm."""
    ap = rng["ap"]
    ap_e = rng["ap_tab"](E) if rng["ap_tab"] is not None else np.full(E.shape, ap)
    a_pen = (0.123 * awri ** (1 / 3) + 0.08) if rng["naps"] == 0 else ap
    if rng["naps"] == 1 and rng["ap_tab"] is not None:
        a_pen = ap_e
    return a_pen, ap_e


def eval_bw(rng, E):
    out = {1: np.zeros_like(E), 2: np.zeros_like(E), 18: np.zeros_like(E), 102: np.zeros_like(E)}
    spi, lrf = rng["spi"], rng["lrf"]
    for lg in rng["ls"]:
        awri, l, res = lg["awri"], lg["l"], lg["res"]
        k = K0 * awri / (awri + 1) * np.sqrt(E)
        a_pen, a_ph = _radii(rng, awri, E)
        P, S = pen_shift(l, k * a_pen)
        phi = phase(l, k * a_ph)
        pik2 = math.pi / (k * k)
        s2 = np.sin(phi) ** 2
        out[2] += 4 * pik2 * (2 * l + 1) * s2
        if not len(res):
            continue
        er, aj, gt, gn, gg, gf = res.T
        gn, gg, gf = np.abs(gn), np.abs(gg), np.abs(gf)
        gx = np.clip(gt - gn - gg - gf, 0, None) if lg["lrx"] else np.zeros_like(gn)
        gj = (2 * np.abs(aj) + 1) / (2 * (2 * spi + 1))
        kr = K0 * awri / (awri + 1) * np.sqrt(np.abs(er))
        ar = a_pen if np.isscalar(a_pen) else float(np.mean(a_pen))
        Pr, Sr = pen_shift(l, kr * ar)
        Pr = np.where(Pr > 0, Pr, 1e-30)
        js = np.unique(np.abs(aj)) if lrf == 2 else None
        for sl in chunks(len(E), len(er)):
            Pe, Se = P[sl, None], S[sl, None]
            gne = gn * Pe / Pr
            ep = er + gn * (Sr - Se) / (2 * Pr)
            gtot = gne + gg + gf + gx
            d = E[sl, None] - ep
            den = d * d + 0.25 * gtot * gtot
            base = gj * gne / den
            out[102][sl] += pik2[sl] * (base * gg).sum(1)
            out[18][sl] += pik2[sl] * (base * gf).sum(1)
            if lrf == 1:
                el = gj * (gne * gne - 2 * gne * gtot * s2[sl, None] + 2 * d * gne * np.sin(2 * phi[sl, None])) / den
                out[2][sl] += pik2[sl] * el.sum(1)
            else:
                w = np.exp(-2j * phi[sl])
                for J in js:
                    m = np.abs(aj) == J
                    X = (1j * gne[:, m] / (-d[:, m] - 0.5j * gtot[:, m])).sum(1)
                    U = w * (1 + X)
                    g = (2 * J + 1) / (2 * (2 * spi + 1))
                    out[2][sl] += pik2[sl] * g * (np.abs(1 - U) ** 2 - 4 * s2[sl])
    out[1] = out[2] + out[18] + out[102]
    return out


def eval_rm(rng, E):
    out = {1: np.zeros_like(E), 2: np.zeros_like(E), 18: np.zeros_like(E), 102: np.zeros_like(E)}
    spi = rng["spi"]
    for lg in rng["ls"]:
        awri, l, res = lg["awri"], lg["l"], lg["res"]
        k = K0 * awri / (awri + 1) * np.sqrt(E)
        a_pen, a_ph = _radii(rng, awri, E)
        if lg["apl"] > 0:  # l-dependent radius replaces AP (also for penetrability when NAPS=1)
            a_ph = np.full(E.shape, lg["apl"])
            if rng["naps"] == 1:
                a_pen = lg["apl"]
        P, _ = pen_shift(l, k * a_pen)
        phi = phase(l, k * a_ph)
        pik2 = math.pi / (k * k)
        s2 = np.sin(phi) ** 2
        out[2] += 4 * pik2 * (2 * l + 1) * s2
        out[1] += 4 * pik2 * (2 * l + 1) * s2
        if not len(res):
            continue
        ar = a_pen if np.isscalar(a_pen) else float(np.mean(a_pen))
        for J in np.unique(res[:, 1]):
            r = res[res[:, 1] == J]
            er, _, gn, gg, gfa, gfb = r.T
            g = (2 * abs(J) + 1) / (2 * (2 * spi + 1))
            kr = K0 * awri / (awri + 1) * np.sqrt(np.abs(er))
            Pr, _ = pen_shift(l, kr * ar)
            Pr = np.where(Pr > 0, Pr, 1e-30)
            an0 = np.sqrt(np.abs(gn) / Pr)
            fa = np.sign(gfa) * np.sqrt(np.abs(gfa))
            fb = np.sign(gfb) * np.sqrt(np.abs(gfb))
            fis = bool(np.any(gfa) or np.any(gfb))
            for sl in chunks(len(E), len(er)):
                inv = 0.5j / (er - E[sl, None] - 0.5j * np.abs(gg))
                pe = P[sl]
                knn = pe * (inv @ (an0 * an0))
                if fis:
                    sp = np.sqrt(pe)
                    K = np.empty((len(knn), 3, 3), complex)
                    K[:, 0, 0] = knn
                    K[:, 0, 1] = K[:, 1, 0] = sp * (inv @ (an0 * fa))
                    K[:, 0, 2] = K[:, 2, 0] = sp * (inv @ (an0 * fb))
                    K[:, 1, 1] = inv @ (fa * fa)
                    K[:, 1, 2] = K[:, 2, 1] = inv @ (fa * fb)
                    K[:, 2, 2] = inv @ (fb * fb)
                    M = np.eye(3)[None] - K
                    rhs = np.zeros((len(knn), 3, 1), complex)
                    rhs[:, 0, 0] = 1
                    x = np.linalg.solve(M, rhs)[:, :, 0]
                    inn, ina, inb = x[:, 0], x[:, 1], x[:, 2]
                    sf = 4 * pik2[sl] * g * (np.abs(ina) ** 2 + np.abs(inb) ** 2)
                else:
                    inn = 1 / (1 - knn)
                    sf = 0.0
                U = np.exp(-2j * phi[sl]) * (2 * inn - 1)
                st = 2 * pik2[sl] * g * (1 - U.real)
                se = pik2[sl] * g * np.abs(1 - U) ** 2
                pot = 4 * pik2[sl] * g * s2[sl]
                out[1][sl] += st - pot
                out[2][sl] += se - pot
                out[18][sl] += sf
                out[102][sl] += st - se - sf
    return out


def eval_rml(rng, E, awr):
    """R-matrix limited (LRF=7), Reich-Moore approximation with an eliminated capture channel."""
    out = {1: np.zeros_like(E), 2: np.zeros_like(E), 102: np.zeros_like(E)}
    pairs = rng["pairs"]
    npair = next((p for p in pairs if int(round(p[9])) == 2), None)
    if npair is None:
        return out
    spin_t = abs(npair[5] if abs(npair[0] - 1) < 0.1 else npair[4])  # sign carries parity
    k = K0 * awr / (awr + 1) * np.sqrt(E)
    pik2 = math.pi / (k * k)
    for grp in rng["groups"]:
        res = grp["res"]
        J = abs(grp["aj"])
        g = (2 * J + 1) / (2 * (2 * spin_t + 1))
        chans = []
        for c, ch in enumerate(grp["chans"]):
            ppi, l = int(round(ch[0])), int(round(ch[1]))
            p = pairs[ppi - 1] if 0 < ppi <= len(pairs) else None
            if p is None:
                continue
            mt = int(round(p[9]))
            chans.append(dict(col=c + 1, l=l, mt=lump(mt), pair=p, ape=ch[4], apt=ch[5]))
        er = res[:, 0] if len(res) else np.zeros(0)
        gam = [c for c in chans if c["mt"] == 102]
        gg = np.abs(sum(res[:, c["col"]] for c in gam)) if gam and len(res) else np.zeros(len(er))
        open_ = [c for c in chans if c["mt"] != 102]
        neut = [i for i, c in enumerate(open_) if c["mt"] == 2]
        if not neut:
            continue
        # Width amplitudes at E: a_rc(E) = sign * sqrt(|Γ_rc| P_c(E) / P_c(|Er|)).
        amps = []
        phis = {}
        for i, c in enumerate(open_):
            p = c["pair"]
            ma, mb, q = p[0], p[1], p[6]
            gw = res[:, c["col"]] if len(res) else np.zeros(0)
            a0 = np.sign(gw) * np.sqrt(np.abs(gw))
            ec = E * awr / (awr + 1) + q
            if c["mt"] in (2, 4) and p[2] == 0 and p[0] > 0.5:  # neutron out (a uncharged, not a photon)
                mu = ma * mb / (ma + mb)
                apt = c["apt"] or c["ape"]
                ecr = np.abs(er) * awr / (awr + 1) + q
                pr, _ = pen_shift(c["l"], K0 * np.sqrt(mu * np.clip(ecr, 1e-30, None)) * apt)
                a0 = a0 / np.sqrt(np.where(pr > 0, pr, 1e-30))
                pe, _ = pen_shift(c["l"], K0 * np.sqrt(mu * np.clip(ec, 0, None)) * apt)
                fac = np.sqrt(np.where(ec > 0, pe, 0.0))
                if c["mt"] == 2:
                    phis[i] = phase(c["l"], k * (c["ape"] or apt))
            else:
                fac = np.where(ec > 0, 1.0, 0.0)  # charged/photon channels: constant widths
            amps.append((a0, fac))
        n_open = len(open_)
        for sl in chunks(len(E), max(1, len(er) * n_open)):
            m = sl.stop - sl.start
            if len(er):
                inv = 0.5j / (er - E[sl, None] - 0.5j * gg)
            K = np.zeros((m, n_open, n_open), complex)
            if len(er):
                A = [a0[None, :] * fac[sl, None] for a0, fac in amps]
                for i in range(n_open):
                    for j in range(i, n_open):
                        K[:, i, j] = K[:, j, i] = (A[i] * A[j] * inv).sum(1)
            X = np.linalg.inv(np.eye(n_open)[None] - K)
            st = np.zeros(m)
            se = np.zeros(m)
            sx: dict[int, np.ndarray] = {}
            for i in neut:
                ui = np.exp(-1j * phis[i][sl])
                for j in neut:
                    uj = np.exp(-1j * phis[j][sl])
                    U = ui * uj * (2 * X[:, i, j] - (1 if i == j else 0))
                    if i == j:
                        st += 2 * pik2[sl] * g * (1 - U.real)
                    se += pik2[sl] * g * np.abs((1 if i == j else 0) - U) ** 2
                for j, c in enumerate(open_):
                    if c["mt"] == 2:
                        continue
                    sx.setdefault(c["mt"], np.zeros(m))
                    sx[c["mt"]] += 4 * pik2[sl] * g * np.abs(X[:, i, j]) ** 2
            out[1][sl] += st
            out[2][sl] += se
            cap = st - se
            for mt, v in sx.items():
                out.setdefault(mt, np.zeros_like(E))[sl] += v
                cap = cap - v
            out[102][sl] += cap
    return out


def resonance_widths(rng):
    """(Er, Γ) for every resonance in a resolved range, for seeding the grid."""
    if rng["lrf"] in (1, 2, 3):
        rows = [lg["res"] for lg in rng["ls"] if len(lg["res"])]
        if not rows:
            return np.zeros(0), np.zeros(0)
        r = np.vstack(rows)
        if rng["lrf"] == 3:
            return r[:, 0], np.abs(r[:, 2]) + np.abs(r[:, 3]) + np.abs(r[:, 4]) + np.abs(r[:, 5])
        return r[:, 0], np.abs(r[:, 3]) + np.abs(r[:, 4]) + np.abs(r[:, 5])
    ers, ws = [], []
    for grp in rng["groups"]:
        if len(grp["res"]):
            ers.append(grp["res"][:, 0])
            ws.append(np.abs(grp["res"][:, 1:]).sum(1))
    if not ers:
        return np.zeros(0), np.zeros(0)
    return np.concatenate(ers), np.concatenate(ws)


# ------------------------------------------------------------------ unresolved averages
def eval_urr(rng, E):
    """Average resonance cross sections without width-fluctuation factors (LSSF=0 only)."""
    out = {1: np.zeros_like(E), 2: np.zeros_like(E), 18: np.zeros_like(E), 102: np.zeros_like(E)}
    spi = rng["spi"]
    for lg in rng["ls"]:
        awri, l = lg["awri"], lg["l"]
        k = K0 * awri / (awri + 1) * np.sqrt(E)
        a_pen, a_ph = _radii(rng, awri, E)
        P, _ = pen_shift(l, k * a_pen)
        phi = phase(l, k * a_ph)
        s2 = np.sin(phi) ** 2
        pik2 = math.pi / (k * k)
        vl = P / (k * a_pen)  # V_l = P_l / rho
        out[2] += 4 * pik2 * (2 * l + 1) * s2
        for j in lg["js"]:
            g = (2 * abs(j["aj"]) + 1) / (2 * (2 * spi + 1))
            if j["es"] is None:
                d, gn0, gg, gf, gx = j["d"], j["gn0"], j["gg"], 0.0, 0.0
            else:
                es = j["es"]
                f = lambda v: np.interp(E, es, v) if np.ndim(v) else v
                d, gn0, gg, gf, gx = f(j["d"]), f(j["gn0"]), f(j["gg"]), f(j["gf"]), f(j["gx"])
            gn = j["amun"] * gn0 * vl * np.sqrt(E)
            gt = gn + gg + gf + gx
            c = 2 * math.pi * pik2 * g / np.where(np.asarray(d) > 0, d, np.inf)
            out[102] += c * gn * gg / gt
            out[18] += c * gn * gf / gt
            out[2] += c * (gn * gn / gt - 2 * gn * s2)
    out[1] = out[2] + out[18] + out[102]
    return out


# ------------------------------------------------------------------ adaptive grid
def adapt(f, grid, tol=0.004, passes=40, awr=None):
    """Refine `grid` until linear interpolation of f's curves is within tol at midpoints.

    With awr given, intervals narrower than the Doppler width are held only to an area
    tolerance, because broadening averages over that width anyway.
    """
    E = np.unique(grid)
    V = f(E)
    keys = list(V)
    cand = np.ones(len(E) - 1, bool)
    for _ in range(passes):
        idx = np.nonzero(cand & (np.diff(E) > 1e-8 * E[1:]))[0]
        if not len(idx):
            break
        a, b = E[idx], E[idx + 1]
        m = np.where(b / a > 1.5, np.sqrt(a * b), 0.5 * (a + b))
        Vm = f(m)
        bad = np.zeros(len(idx), bool)
        loose = 1.0
        if awr:
            loose = np.maximum(1.0, 2 * np.sqrt(m * KT / awr) / (b - a))
        for key in keys:
            lin = V[key][idx] + (V[key][idx + 1] - V[key][idx]) * (m - a) / (b - a)
            bad |= np.abs(Vm[key] - lin) > tol * loose * np.abs(Vm[key]) + 1e-9
        Em = np.concatenate([E, m])
        order = np.argsort(Em, kind="stable")
        E = Em[order]
        for key in keys:
            V[key] = np.concatenate([V[key], Vm[key]])[order]
        flag = np.concatenate([np.zeros(len(E) - len(m), bool), bad])[order]
        pos = np.nonzero(flag)[0]
        cand = np.zeros(len(E) - 1, bool)
        cand[pos[pos > 0] - 1] = True
        cand[pos[pos < len(E) - 1]] = True
    return E, V


# ------------------------------------------------------------------ Doppler broadening
def _phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def broaden(E, sig, awr, ecut, T=5.5):
    """Free-gas Doppler broadening of a piecewise-linear 0 K curve, applied below ecut."""
    s = math.sqrt(KT / (2 * awr))
    h = s / 3
    y = np.sqrt(E)
    gk = sig * E
    ymax = math.sqrt(ecut) + T * s + 2 * h
    stop = min(len(y), int(np.searchsorted(y, ymax + 4 * h)) + 1)
    yk, gk = y[:stop], gk[:stop]
    neg = yk <= T * s + 4 * h
    yk = np.concatenate([-yk[neg][::-1], [0.0], yk])
    gk = np.concatenate([-gk[neg][::-1], [0.0], gk])
    dy = np.diff(yk)
    I = np.concatenate([[0.0], np.cumsum(0.5 * (gk[1:] + gk[:-1]) * dy)])
    lo = -math.floor(T * s / h) * h
    edges = lo + h * np.arange(int((math.sqrt(ecut) + T * s - lo) / h) + 2)
    edges = edges[edges <= yk[-1]]
    j = np.clip(np.searchsorted(yk, edges, side="right") - 1, 0, len(yk) - 2)
    t = edges - yk[j]
    ddy = yk[j + 1] - yk[j]
    slope = np.where(ddy > 0, (gk[j + 1] - gk[j]) / np.where(ddy > 0, ddy, 1), 0.0)
    Ie = I[j] + gk[j] * t + 0.5 * slope * t * t
    A = np.diff(Ie) / h
    centers = edges[:-1] + 0.5 * h
    M = int(math.ceil(T * s / h))
    w = np.array([_phi((mm + 0.5) * h / s) - _phi((mm - 0.5) * h / s) for mm in range(-M, M + 1)])
    w /= w.sum()
    B = np.convolve(A, w, mode="same")
    ylo = 3 * s
    ok = (centers >= ylo) & (centers <= math.sqrt(ecut)) & (centers + T * s <= edges[-1])
    yc = centers[ok]
    eb, sb = yc * yc, B[ok] / (yc * yc)
    if not len(eb):
        return E, sig
    below, above = E < eb[0], E > eb[-1]
    return (np.concatenate([E[below], eb, E[above]]),
            np.concatenate([sig[below], np.clip(sb, 0, None), sig[above]]))


# ------------------------------------------------------------------ thinning + encoding
def thin(x, y, tol):
    """Keep the fewest points so straight segments stay within tol (in y) of every point."""
    n = len(x)
    if n <= 2:
        return np.arange(n)
    xs, ys = x.tolist(), y.tolist()
    keep = [0]
    x0, y0 = xs[0], ys[0]
    lo, hi = -math.inf, math.inf
    for k in range(1, n):
        dx = xs[k] - x0
        if dx <= 0:
            continue
        sl = (ys[k] - y0) / dx
        if sl < lo or sl > hi:
            a = k - 1
            if a == keep[-1]:
                a = k
            keep.append(a)
            x0, y0 = xs[a], ys[a]
            lo, hi = -math.inf, math.inf
            if a == k:
                continue
            dx = xs[k] - x0
            if dx <= 0:
                continue
        lo = max(lo, (ys[k] - tol - y0) / dx)
        hi = min(hi, (ys[k] + tol - y0) / dx)
    if keep[-1] != n - 1:
        keep.append(n - 1)
    return np.asarray(keep)


FLOOR = 1e-9  # b; values below are dropped from the log plot


def encode(E, sig, tol=0.004):
    """Delta-encoded [x0, y0, dx1, dy1, ...] with x = log10(E)*1e4, y = log10(σ)*1e4."""
    m = (E >= E_MIN) & (E <= E_MAX) & np.isfinite(sig)
    E, sig = E[m], sig[m]
    if not len(E):
        return None
    pos = sig > FLOOR
    if not pos.any():
        return None
    # trim leading/trailing zeros (thresholds), keep interior dips at the floor
    a, b = np.argmax(pos), len(pos) - np.argmax(pos[::-1])
    E, sig = E[a:b], np.maximum(sig[a:b], FLOOR)
    lx, ly = np.log10(E), np.log10(sig)
    k = thin(lx, ly, tol)
    xi = np.round(lx[k] * 1e4).astype(np.int64)
    yi = np.round(ly[k] * 1e4).astype(np.int64)
    xi, idx = np.unique(xi, return_index=True)
    yi = yi[idx]
    d = np.empty(2 * len(xi), np.int64)
    d[0::2] = np.diff(np.concatenate([[0], xi]))
    d[1::2] = np.diff(np.concatenate([[0], yi]))
    return d.tolist()


# ------------------------------------------------------------------ driver
def target_curves(secs):
    """{mt: (E, σ)} pointwise at 293.6 K for one ENDF material, plus range info."""
    head = Section(secs[(1, 451)]).cont()
    awr, lrp = head[1], head[2]
    tabs = {}
    for (mf, mt), lines in secs.items():
        if mf != 3:
            continue
        try:
            sec = Section(lines)
            sec.cont()
            _, t = sec.tab1()
        except (IndexError, ValueError):
            continue
        tabs[mt] = Tab(t)

    def bg_tab(mt):
        if mt in tabs:
            return [tabs[mt]]
        return [tabs[p] for p in PARTIALS.get(mt, []) if p in tabs]

    ranges = []
    if (2, 151) in secs and lrp == 1:
        try:
            awr2, ranges = parse_mf2(secs[(2, 151)])
        except (IndexError, ValueError):
            ranges = []
    resolved = [r for r in ranges if r["lru"] == 1 and r.get("ok") and r["eh"] > E_MIN]
    unres = [r for r in ranges if r["lru"] == 2 and r.get("lssf") == 0 and r["eh"] > E_MIN]

    def res_eval(rng, E):
        if rng["lrf"] in (1, 2):
            return eval_bw(rng, E)
        if rng["lrf"] == 3:
            return eval_rm(rng, E)
        return eval_rml(rng, E, awr)

    pieces: dict[int, list] = {}   # mt -> list of (E, σ) arrays covering resonance ranges
    spans = []
    for rng in resolved + unres:
        el, eh = max(rng["el"], E_MIN), min(rng["eh"], E_MAX)
        if eh <= el:
            continue
        spans.append((el, eh))
        grid = [np.logspace(math.log10(el), math.log10(eh), max(3, int(40 * math.log10(eh / el))))]
        for mt in (1, 2, 18, 102):
            for t in bg_tab(mt):
                grid.append(t.x[(t.x >= el) & (t.x <= eh)])
        if rng["lru"] == 1:
            er, gw = resonance_widths(rng)
            sel = (er > el) & (er < eh)
            er, gw = er[sel], np.maximum(gw[sel], 1e-9 * er[sel])
            off = np.array([-20, -8, -4, -2, -1.5, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.5, 2, 4, 8, 20]) * 0.5
            grid.append((er[:, None] + gw[:, None] * off[None, :]).ravel())
            fn = lambda E, rng=rng: res_eval(rng, E)
        else:
            for lg in rng["ls"]:
                for j in lg["js"]:
                    if j["es"] is not None:
                        grid.append(np.asarray(j["es"]))
            fn = lambda E, rng=rng: eval_urr(rng, E)
        g = np.concatenate(grid)
        g = g[(g >= el) & (g <= eh)]

        def total(E, fn=fn):
            v = fn(E)
            for mt in list(v):
                for t in bg_tab(mt):
                    v[mt] = v[mt] + t(E)
            return v

        E, V = adapt(total, np.concatenate([g, [el, eh]]), tol=0.005, awr=awr)
        for mt, s in V.items():
            pieces.setdefault(mt, []).append((E, s))

    def outside(e):
        m = np.ones(len(e), bool)
        for el, eh in spans:
            m &= ~((e >= el) & (e <= eh))
        return m

    curves = {}
    for mt in PLOT_MTS:
        parts = bg_tab(mt)
        Es, Ss = [], []
        for t in parts:
            e, _ = t.sample()
            Es.append(e)
        if Es:
            e = np.unique(np.concatenate(Es))
            e = e[outside(e)] if mt in pieces else e
            s = sum(t(e) for t in parts)
            Es, Ss = [e], [s]
        for e, s in pieces.get(mt, []):
            Es.append(e)
            Ss.append(s)
        if not Es:
            continue
        e = np.concatenate(Es)
        s = np.concatenate(Ss)
        o = np.argsort(e, kind="stable")
        e, s = e[o], s[o]
        if mt in pieces and resolved:
            ecut = min(max(r["eh"] for r in resolved) * 1.02, E_MAX)
            e, s = broaden(e, np.clip(s, 0, None), awr, ecut)
        curves[mt] = (e, s)
    info = dict(awr=awr,
                rr=[[r["el"], r["eh"]] for r in resolved],
                ur=[[r["el"], r["eh"]] for r in ranges if r["lru"] == 2])
    return curves, info


def iter_targets(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        for name in sorted(zf.namelist()):
            m = re.search(r"n-(\d+)_([A-Za-z]+)_(\d+)(m\d)?\.endf$", name)
            if not m or m.group(4):
                continue
            z, a = int(m.group(1)), int(m.group(3))
            if a == 0:
                continue
            yield z, a, name, zf.read(name).decode("latin-1")

# Chart of Nuclides

An interactive, canvas-rendered chart of the nuclides for exploration. It covers all 3,386 known ground states.

- **Explore** (the default): hover any nuclide to see its full details in the side panel, with no chain overlay. Click to keep the panel on that nuclide.
- **Decay**: hover any nuclide to see its full downstream decay chain, with branching ratios on the arrows. Click to pin it and open the details panel. Arrow keys step between neighbouring nuclides.
- **Fission**: choose a fissioning system (61 sets: thermal, fast, 14 MeV and spontaneous) and switch between cumulative and independent yields. A minimum-yield slider dims or hides everything below it. *Decay fission products* simulates the decay heat curve of a fission pulse.
- **Activation**: choose an element (natural isotopic mix) or a single isotope, and a neutron spectrum: thermal, U-235 fission spectrum, or 14 MeV. The chart shows every (n,γ), (n,2n), (n,p), (n,α)… product, weighted by abundance × σ.
- **Color by**: decay mode, half-life, Q-values, binding energy, mass excess, separation energies, spin, parity, moments, charge radius, N/Z, abundance, discovery year, fission yield or activation production. Click legend entries to toggle them; shift-click to solo one.
- **Simulate decay**: an analytic Bateman solution, run in a Web Worker and plotted on log-log axes.
- **Help** (`?` button or the `?` / `h` key): 47 short topics on using the chart, decay modes, every neutron reaction, fission and nuclear properties. Each has "Try it" examples that set up the chart and links to Wikipedia. Labels with a dotted underline or a small `?` anywhere in the app open the matching topic.
- **Themes and colors** (palette button): 9 UI themes, 7 decay-mode palettes (including a colorblind-safe one), and selectable sequential and diverging gradients.

## Data sources

| What | Source |
|---|---|
| Ground states, half-lives, decay modes and branchings, Jπ, masses, Q-values, moments, radii, abundances | IAEA LiveChart of Nuclides API (ENSDF / NUBASE2020 / AME2020) |
| Fission product yields (neutron-induced and spontaneous) | ENDF/B-VIII.0 NFY and SFY sublibraries (NNDC) |
| Neutron reaction cross sections | ENDF/B-VIII.0 neutron sublibrary (NNDC) |

Notes on the processing (`scripts/`):
- Delayed-particle branches (β⁻n, εp, …) are subtracted from their parent β⁻/ε branch when chains are built.
- Isomers are not shown separately. Independent yields of isomeric states are summed into the ground state; cumulative yields use the ground-state value.
- Thermal cross sections combine the MF=3 background with a single-level Breit–Wigner sum over the resolved resonances in MF=2, evaluated at 0.0253 eV. This reproduces the standard thermal values (Co-59 37.2 b, Au-197 98.7 b, Gd-157 253 kb) to within a few percent. Fission-spectrum values average MF=3 over a U-235 Watt spectrum, so (n,γ) values in that spectrum are approximate.
- Nuclides with an unknown half-life are treated as prompt (1 µs) in decay simulations.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
```

To rebuild the data (downloads about 315 MB of raw ENDF files into `data/raw/`, which is git-ignored):

```bash
npm run data       # python scripts/build_data.py [--refresh]
```

`npm run build` produces a static site in `dist/`.

## Keys

`/` search · `1 2 3 4` modes · Shift+scroll travels along the valley of stability · arrows step · `s` simulate · `f` focus · `0` fit · `+ −` zoom · `t` next theme · `Esc` backs out one level (dialog → pinned nuclide → back to Explore → full view)

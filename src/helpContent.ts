// Help topics: short explanations, how each thing shows up on the chart,
// live examples ("Try it"), and Wikipedia links. All links were checked to exist.

export type Example =
  | { kind: 'nuclide'; id: string; label?: string }
  | { kind: 'act'; target: string; sp: 0 | 1 | 2; label: string }
  | { kind: 'fy'; sys: string; label: string }
  | { kind: 'sim'; id: string; label: string }
  | { kind: 'xs'; id: string; label: string }
  | { kind: 'color'; mode: string; label: string }
  | { kind: 'mode'; mode: 'explore' | 'chart' | 'fy' | 'act'; label: string };

export interface Topic {
  id: string;
  group: string;
  title: string;
  /** Short notation shown under the title, e.g. "Z+1, N−1". */
  move?: string;
  body: string[];
  /** Where to look on the chart. */
  chart?: string;
  examples?: Example[];
  links: [string, string][]; // [label, wikipedia page]
  keywords?: string;
}

const W = (page: string) => `https://en.wikipedia.org/wiki/${page}`;

export const GROUPS = ['Using the chart', 'Decay', 'Neutron reactions', 'Fission', 'Nuclear properties'];

export const TOPICS: Topic[] = [
  // ------------------------------------------------------------ using the chart
  {
    id: 'chart', group: 'Using the chart', title: 'Reading the chart',
    body: [
      'Each square is one nuclide: a specific number of protons (Z, up the side) and neutrons (N, along the bottom).',
      'A row is one element, so its squares are isotopes. A column has the same neutron number (isotones). Diagonals running down and to the right have the same mass number A = Z + N (isobars).',
      'Stable nuclides form a ridge up the middle called the valley of stability. Nuclides to the lower right have too many neutrons and usually β⁻ decay; those to the upper left have too many protons and usually decay by β⁺ or electron capture.',
    ],
    chart: 'Use Shift + scroll to travel along the valley of stability.',
    examples: [{ kind: 'nuclide', id: 'Fe-56', label: 'Fe-56, one of the most tightly bound nuclei' }],
    links: [['Table of nuclides', W('Table_of_nuclides')], ['Isotope', W('Isotope')], ['Isotone', W('Isotone')], ['Isobar', W('Isobar_(nuclide)')]],
    keywords: 'isotope isotone isobar grid axes',
  },
  {
    id: 'modes', group: 'Using the chart', title: 'The four modes',
    body: [
      'Explore (1): hover any nuclide to fill the details panel. Nothing else changes, so you can browse freely.',
      'Decay (2): hover to preview a nuclide\'s whole decay chain; click to lock it on screen.',
      'Fission (3): pick a fissioning nucleus and neutron energy, and see how likely each fission product is.',
      'Activation (4): pick an element or isotope and a neutron energy, and see what neutron reactions turn it into. Click a product to see its decay chain.',
    ],
    examples: [
      { kind: 'mode', mode: 'chart', label: 'Open Decay mode' },
      { kind: 'mode', mode: 'fy', label: 'Open Fission mode' },
      { kind: 'mode', mode: 'act', label: 'Open Activation mode' },
    ],
    links: [],
    keywords: 'explore decay fission activation tabs',
  },
  {
    id: 'navigate', group: 'Using the chart', title: 'Moving around',
    body: [
      'Scroll to zoom, drag to pan, double-click to zoom in. Shift + scroll moves along the valley of stability.',
      'Press / to search, e.g. "Cs-137", "235U", "lead" or just "137" for every nuclide with that mass number.',
      'With a nuclide pinned, the arrow keys step to its neighbours. F focuses it, S opens its decay simulation.',
      'Esc backs out one level at a time: close dialogs, unpin, return to Explore, then zoom out to the whole chart.',
      'The minimap in the corner shows where you are; click or drag it to jump.',
    ],
    links: [],
    keywords: 'zoom pan scroll keyboard shortcuts search escape minimap',
  },
  {
    id: 'colors', group: 'Using the chart', title: 'Colors and the legend',
    body: [
      'The Color menu chooses what the squares show: decay mode, half-life, energies, nuclear shape and more. Each attribute has its own help topic.',
      'Click a legend entry to hide that category; Shift-click to show only it. On a color bar, the white marker shows where the hovered nuclide falls.',
      'The palette button (top right) changes the theme, the decay-mode colors (including a colorblind-safe set) and the gradients.',
    ],
    links: [],
    keywords: 'legend palette theme gradient',
  },
  {
    id: 'simulate', group: 'Using the chart', title: 'Decay simulation',
    body: [
      'Simulate decay starts from pure atoms of one nuclide and follows every member of its chain over time. The curves come from the Bateman equations, which give an exact solution for a chain of decays.',
      'Activity is decays per second. When a long-lived parent feeds short-lived daughters, the daughters\' activities climb until they all match the parent: secular equilibrium. U-238 shows this clearly.',
      'Hover the plot to read values, click a legend line to hide it, and Shift-click to jump to that nuclide.',
    ],
    examples: [{ kind: 'sim', id: 'U-238', label: 'Simulate U-238' }, { kind: 'sim', id: 'Ra-226', label: 'Simulate Ra-226' }],
    links: [['Bateman equation', W('Bateman_equation')], ['Secular equilibrium', W('Secular_equilibrium')], ['Decay chain', W('Decay_chain')]],
    keywords: 'bateman activity equilibrium plot',
  },

  // ------------------------------------------------------------ decay
  {
    id: 'decay-modes', group: 'Decay', title: 'Decay modes overview',
    body: [
      'An unstable nucleus releases energy by changing into a more stable one. Which way it goes depends on which side of the valley of stability it sits: neutron-rich nuclei turn neutrons into protons (β⁻), proton-rich ones do the reverse (β⁺ / electron capture), and heavy ones shed whole α particles.',
      'Color by "Decay mode" to see these regions; each mode has its own topic below.',
    ],
    examples: [{ kind: 'color', mode: 'decay', label: 'Color by decay mode' }],
    links: [['Radioactive decay', W('Radioactive_decay')]],
  },
  {
    id: 'decay-chain', group: 'Decay', title: 'Decay chains',
    body: [
      'A decay often produces another unstable nuclide, which decays again, and so on until something stable is reached. That sequence is a decay chain.',
      'When a nuclide has more than one decay mode, the chain branches; the percentages on the arrows are branching ratios. Dashed arrows are branches whose ratio was not measured.',
    ],
    chart: 'In Decay mode, hover a nuclide to preview its chain and click to lock it.',
    examples: [{ kind: 'nuclide', id: 'U-238', label: 'U-238 → Pb-206' }, { kind: 'nuclide', id: 'Th-232', label: 'Th-232 → Pb-208' }],
    links: [['Decay chain', W('Decay_chain')]],
    keywords: 'branching ratio series',
  },
  {
    id: 'beta-minus', group: 'Decay', title: 'β⁻ decay', move: 'Z + 1, N − 1 · one step up-left',
    body: [
      'A neutron turns into a proton, emitting an electron and an antineutrino. The mass number stays the same.',
      'This is how neutron-rich nuclides decay, including almost all fission products. Carbon-14 dating and tritium are both β⁻ emitters.',
    ],
    examples: [{ kind: 'nuclide', id: 'Cs-137' }, { kind: 'nuclide', id: 'C-14' }, { kind: 'nuclide', id: 'H-3' }],
    links: [['Beta decay', W('Beta_decay')]],
    keywords: 'beta minus electron antineutrino',
  },
  {
    id: 'beta-plus', group: 'Decay', title: 'β⁺ decay and electron capture (ε)', move: 'Z − 1, N + 1 · one step down-right',
    body: [
      'A proton turns into a neutron, either by emitting a positron (β⁺) or by capturing one of the atom\'s own electrons (electron capture, EC or ε). Both give the same daughter.',
      'β⁺ needs at least 1.022 MeV of decay energy; below that, only electron capture is possible. Positron emitters such as F-18 are the basis of PET scans.',
      'K-40 is unusual: it decays both ways, mostly β⁻ to Ca-40 and partly by electron capture to Ar-40.',
    ],
    examples: [{ kind: 'nuclide', id: 'F-18' }, { kind: 'nuclide', id: 'Be-7' }, { kind: 'nuclide', id: 'K-40' }],
    links: [['Positron emission', W('Positron_emission')], ['Electron capture', W('Electron_capture')], ['PET', W('Positron_emission_tomography')]],
    keywords: 'positron ec epsilon beta plus',
  },
  {
    id: 'alpha', group: 'Decay', title: 'α decay', move: 'Z − 2, N − 2 · two steps down-left',
    body: [
      'The nucleus emits an α particle, a helium-4 nucleus of two protons and two neutrons.',
      'It dominates for heavy nuclides above lead, where the strong force struggles to hold so many protons together. The long uranium and thorium chains are mostly α steps.',
    ],
    examples: [{ kind: 'nuclide', id: 'Po-210' }, { kind: 'nuclide', id: 'Am-241' }, { kind: 'nuclide', id: 'U-238' }],
    links: [['Alpha decay', W('Alpha_decay')], ['Alpha particle', W('Alpha_particle')]],
    keywords: 'helium',
  },
  {
    id: 'sf', group: 'Decay', title: 'Spontaneous fission',
    body: [
      'The nucleus splits into two medium-mass fragments plus a few neutrons, with no outside trigger.',
      'It only matters for the heaviest nuclides. Cf-252 fissions in about 3% of its decays and is used as a portable neutron source. In this chart\'s simulations, a chain ends at spontaneous fission.',
    ],
    examples: [{ kind: 'nuclide', id: 'Cf-252' }, { kind: 'fy', sys: 'Cf252_sf', label: 'Cf-252 fission yields' }],
    links: [['Spontaneous fission', W('Spontaneous_fission')], ['Neutron source', W('Neutron_source')]],
  },
  {
    id: 'proton-emission', group: 'Decay', title: 'Proton emission', move: 'Z − 1 · one step down',
    body: [
      'Past the proton drip line, a nucleus has so many protons that one is not bound at all and simply escapes.',
      'These nuclides sit on the far upper-left edge of the chart and live for microseconds to milliseconds.',
    ],
    examples: [{ kind: 'nuclide', id: 'I-109' }, { kind: 'nuclide', id: 'Lu-151' }],
    links: [['Proton emission', W('Proton_emission')], ['Nuclear drip line', W('Nuclear_drip_line')]],
  },
  {
    id: 'neutron-emission', group: 'Decay', title: 'Neutron emission', move: 'N − 1 · one step left',
    body: [
      'Past the neutron drip line, an extra neutron is unbound and leaves almost instantly, often in about 10⁻²¹ s. Such short lives are usually quoted as an energy width (e.g. "Γ 0.65 MeV") rather than a time.',
    ],
    examples: [{ kind: 'nuclide', id: 'He-5' }],
    links: [['Neutron emission', W('Neutron_emission')], ['Nuclear drip line', W('Nuclear_drip_line')]],
  },
  {
    id: 'delayed', group: 'Decay', title: 'β-delayed particle emission (β⁻n, εp…)', move: 'β⁻n: Z + 1, N − 2',
    body: [
      'Sometimes a β decay leaves the daughter so excited that it immediately throws off a neutron (β⁻n) or proton (εp).',
      'Delayed neutrons from fission products such as Br-87 and I-137 arrive seconds after fission. That delay is what makes nuclear reactors controllable.',
    ],
    chart: 'These branches appear as separate arrows in a chain.',
    examples: [{ kind: 'nuclide', id: 'I-137' }, { kind: 'nuclide', id: 'Br-87' }],
    links: [['Delayed neutron', W('Delayed_neutron')]],
    keywords: 'beta delayed neutron proton',
  },
  {
    id: 'double-beta', group: 'Decay', title: 'Double β decay', move: 'Z + 2, N − 2',
    body: [
      'Two neutrons turn into two protons at once. This only happens when ordinary β decay is energetically forbidden, and it is incredibly slow: half-lives around 10²¹ years, tens of billions of times the age of the universe.',
    ],
    examples: [{ kind: 'nuclide', id: 'Xe-136' }, { kind: 'nuclide', id: 'Te-130' }],
    links: [['Double beta decay', W('Double_beta_decay')]],
  },
  {
    id: 'isomer', group: 'Decay', title: 'Isomers and isomeric transition (IT)',
    body: [
      'Some nuclei have long-lived excited states called isomers, marked with "m" (Tc-99m, Ba-137m). They drop to the ground state by emitting a gamma ray, so Z and N do not change.',
      'This chart shows ground states only, so isomers are not separate squares.',
    ],
    links: [['Nuclear isomer', W('Nuclear_isomer')], ['Isomeric transition', W('Isomeric_transition')]],
    keywords: 'metastable gamma',
  },
  {
    id: 'cluster', group: 'Decay', title: 'Cluster decay',
    body: [
      'A heavy nucleus emits a fragment bigger than an α particle, such as C-14 or Ne-24. It is extremely rare: Ra-223 emits a C-14 nucleus about once per billion decays.',
    ],
    examples: [{ kind: 'nuclide', id: 'Ra-223' }],
    links: [['Cluster decay', W('Cluster_decay')]],
  },

  // ------------------------------------------------------------ neutron reactions
  {
    id: 'reactions', group: 'Neutron reactions', title: 'Reading (n,x) notation',
    body: [
      'Reactions are written target(in,out)product. Co-59(n,γ)Co-60 means a neutron hits Co-59, a gamma ray comes out, and Co-60 is left behind.',
      'Each reaction moves the product a fixed step on the chart: (n,γ) one to the right, (n,2n) one to the left, (n,p) one down-right, (n,α) two down and one left.',
      'The chart shows the nucleus left behind, not the particle that flies off. In Li-6(n,t)He-4 the arrow lands on He-4, while the useful tritium is the emitted particle.',
      'Products are often radioactive, which is why neutron irradiation makes materials "activated".',
    ],
    chart: 'In Activation mode, the arrows go from target to product and are colored by reaction.',
    examples: [{ kind: 'act', target: 'Fe', sp: 2, label: 'Iron in 14 MeV neutrons' }],
    links: [['Nuclear reaction', W('Nuclear_reaction')], ['Neutron activation', W('Neutron_activation')], ['Nuclear transmutation', W('Nuclear_transmutation')]],
    keywords: 'notation activation',
  },
  {
    id: 'rx-ng', group: 'Neutron reactions', title: '(n,γ) radiative capture', move: 'N + 1 · one step right',
    body: [
      'The nucleus absorbs the neutron and gets rid of the extra energy as gamma rays. The product is the same element, one mass unit heavier.',
      'This is the main reaction for slow (thermal) neutrons and the main way materials become radioactive in reactors: Co-59 → Co-60, Na-23 → Na-24, Au-197 → Au-198.',
      'Some cross sections are enormous. Gd-157 (~250,000 b) is used in control rods, and Xe-135 (~2.6 million b) is the reactor poison behind "iodine pit" effects.',
    ],
    examples: [
      { kind: 'act', target: 'Co', sp: 0, label: 'Cobalt in thermal neutrons' },
      { kind: 'act', target: 'Au', sp: 0, label: 'Gold in thermal neutrons' },
    ],
    links: [['Neutron capture', W('Neutron_capture')], ['Neutron poison', W('Neutron_poison')], ['Xenon-135', W('Xenon-135')]],
    keywords: 'n gamma capture radiative',
  },
  {
    id: 'rx-n2n', group: 'Neutron reactions', title: '(n,2n)', move: 'N − 1 · one step left',
    body: [
      'A fast neutron knocks a second neutron out, so two leave. The product is the same element, one mass unit lighter.',
      'It has a threshold: the neutron must bring enough energy to unbind a neutron, about 8 MeV for most nuclei but under 2 MeV for Be-9. So it shows up with 14 MeV fusion neutrons, not thermal ones.',
      'Because it turns one neutron into two, beryllium and lead are used as neutron multipliers in fusion blankets.',
    ],
    examples: [{ kind: 'act', target: 'Au', sp: 2, label: 'Gold in 14 MeV neutrons' }, { kind: 'act', target: 'Fe', sp: 2, label: 'Iron in 14 MeV neutrons' }],
    links: [['Neutron multiplier', W('Neutron_multiplier')], ['Nuclear reaction', W('Nuclear_reaction')]],
    keywords: 'n2n threshold multiplier',
  },
  {
    id: 'rx-n3n', group: 'Neutron reactions', title: '(n,3n)', move: 'N − 2 · two steps left',
    body: [
      'Two extra neutrons are knocked out. The threshold is roughly twice that of (n,2n), around 11 to 20 MeV, so with 14 MeV neutrons it appears mainly in heavy nuclei such as U-238.',
    ],
    examples: [{ kind: 'act', target: 'U-238', sp: 2, label: 'U-238 in 14 MeV neutrons' }],
    links: [['Nuclear reaction', W('Nuclear_reaction')]],
  },
  {
    id: 'rx-np', group: 'Neutron reactions', title: '(n,p)', move: 'Z − 1, N + 1 · one step down-right',
    body: [
      'A neutron goes in and a proton comes out. The product has the same mass number, one element lower, and is usually β⁻ radioactive, decaying straight back to the target element.',
      'Most (n,p) reactions need fast neutrons. The famous exception is N-14(n,p)C-14, which works with slow neutrons: cosmic-ray neutrons hitting nitrogen in the air make the carbon-14 used for radiocarbon dating.',
    ],
    examples: [{ kind: 'act', target: 'N-14', sp: 0, label: 'N-14 in thermal neutrons' }, { kind: 'act', target: 'Fe', sp: 2, label: 'Fe-56(n,p)Mn-56 at 14 MeV' }],
    links: [['Carbon-14', W('Carbon-14')], ['Nuclear reaction', W('Nuclear_reaction')]],
    keywords: 'n p proton radiocarbon',
  },
  {
    id: 'rx-nd', group: 'Neutron reactions', title: '(n,d)', move: 'Z − 1 · one step down',
    body: [
      'A deuteron (one proton plus one neutron) is emitted. It needs fast neutrons and is usually small. It produces the same nuclide as (n,np).',
    ],
    links: [['Deuterium', W('Deuterium')], ['Nuclear reaction', W('Nuclear_reaction')]],
    keywords: 'deuteron',
  },
  {
    id: 'rx-nnp', group: 'Neutron reactions', title: '(n,np)', move: 'Z − 1 · one step down',
    body: [
      'A neutron and a proton come out separately. The product is the same as for (n,d). At 14 MeV it is often larger than (n,d), for example in nickel and copper.',
    ],
    links: [['Nuclear reaction', W('Nuclear_reaction')]],
  },
  {
    id: 'rx-nt', group: 'Neutron reactions', title: '(n,t)', move: 'Z − 1, N − 1 · one step down-left',
    body: [
      'A triton, the nucleus of tritium (H-3: one proton, two neutrons), is emitted.',
      'Usually tiny, but Li-6(n,t)He-4 has a huge thermal cross section (~940 b). That reaction is how tritium is bred for fusion reactors: a lithium blanket around the plasma catches neutrons and makes new fuel.',
      'On the chart the arrow points to He-4, the nucleus left behind. The tritium is the particle that flies off.',
    ],
    examples: [{ kind: 'act', target: 'Li-6', sp: 0, label: 'Li-6 in thermal neutrons' }],
    links: [['Tritium', W('Tritium')], ['Breeding blanket', W('Breeding_blanket')], ['Lithium-6', W('Lithium-6')], ['Triton', W('Triton_(physics)')]],
    keywords: 'triton tritium breeding lithium',
  },
  {
    id: 'rx-nhe3', group: 'Neutron reactions', title: '(n,³He)', move: 'Z − 2 · two steps down',
    body: [
      'A helium-3 nucleus (two protons, one neutron) is emitted. It is rare and has very small cross sections.',
      'Not to be confused with He-3(n,p)H-3, the reaction used in helium-3 neutron detectors.',
    ],
    links: [['Helium-3', W('Helium-3')], ['Neutron detection', W('Neutron_detection')]],
  },
  {
    id: 'rx-na', group: 'Neutron reactions', title: '(n,α)', move: 'Z − 2, N − 1 · two steps down, one left',
    body: [
      'An α particle (helium-4 nucleus) is emitted. Most (n,α) reactions need fast neutrons.',
      'B-10(n,α)Li-7 is the big exception: about 3,840 b for slow neutrons. That is why boron is used in control rods, neutron detectors and boron neutron capture therapy for cancer.',
      'In reactor steels, (n,α) reactions slowly build up helium gas that makes the metal brittle.',
    ],
    examples: [{ kind: 'act', target: 'B-10', sp: 0, label: 'B-10 in thermal neutrons' }],
    links: [['Boron-10', W('Boron-10')], ['Boron neutron capture therapy', W('Boron_neutron_capture_therapy')], ['Control rod', W('Control_rod')], ['Alpha particle', W('Alpha_particle')]],
    keywords: 'alpha boron helium',
  },
  {
    id: 'rx-nna', group: 'Neutron reactions', title: '(n,nα)', move: 'Z − 2, N − 2 · two steps down-left',
    body: [
      'The neutron bounces back out and an α particle is knocked loose. It only happens with fast neutrons, giving the same product as α decay of the target.',
    ],
    links: [['Nuclear reaction', W('Nuclear_reaction')]],
  },
  {
    id: 'spectra', group: 'Neutron reactions', title: 'Neutron energies: Thermal, Fission, 14 MeV',
    body: [
      'Thermal (0.0253 eV): neutrons slowed by a moderator such as water or graphite until they move at about 2.2 km/s. Capture (n,γ) dominates.',
      'Fission: the energies neutrons are born with in U-235 fission (a "Watt spectrum", averaging about 2 MeV), as in a fast reactor. Threshold reactions such as (n,p) begin to appear.',
      '14 MeV: neutrons from deuterium–tritium fusion. Almost every channel is open, with (n,2n), (n,p) and (n,α) competing.',
    ],
    links: [['Neutron temperature', W('Neutron_temperature')], ['Neutron moderator', W('Neutron_moderator')], ['Prompt neutron', W('Prompt_neutron')], ['D–T fusion', W('Deuterium%E2%80%93tritium_fusion')]],
    keywords: 'thermal fast fusion watt spectrum',
  },
  {
    id: 'cross-section', group: 'Neutron reactions', title: 'Cross sections and barns',
    body: [
      'A cross section measures how likely a reaction is, expressed as an effective target area. One barn is 10⁻²⁴ cm², roughly the size of a uranium nucleus ("as big as a barn" to the physicists who named it).',
      'Reactions per second per atom = cross section × neutron flux. Values range from microbarns to millions of barns.',
    ],
    examples: [{ kind: 'xs', id: 'Au-197', label: 'Plot σ(E) for Au-197' }],
    links: [['Neutron cross section', W('Neutron_cross_section')], ['Barn (unit)', W('Barn_(unit)')], ['Neutron flux', W('Neutron_flux')]],
    keywords: 'barn sigma probability',
  },
  {
    id: 'xs-plot', group: 'Neutron reactions', title: 'Cross-section plots σ(E)',
    body: [
      'How likely each reaction is at each neutron energy, from 10 µeV to 20 MeV on log–log axes. Scroll to zoom, drag to pan, double-click to reset. Hover to read every curve at one energy; click a legend row to show or hide it.',
      'Low energies: capture usually falls as 1/v, a straight line sloping down, because a slower neutron spends longer near the nucleus.',
      'Middle: resonances, sharp peaks where the neutron energy matches an excited state of the compound nucleus. Higher up they crowd together and are shown as smooth averages (the "unresolved" band).',
      'Fast: above about 1 MeV the curves are smooth, and threshold reactions such as (n,2n), (n,p) and (n,α) switch on once the neutron brings enough energy.',
      'Data from ENDF/B-VIII.0. Resonances are rebuilt from their parameters here and Doppler-broadened to room temperature (293.6 K), so treat fine details as approximate.',
    ],
    chart: 'Shaded humps along the bottom show where thermal and fission neutrons sit; dashed lines mark 0.0253 eV and 14 MeV. These match the three energy options in Activation mode.',
    examples: [
      { kind: 'xs', id: 'U-238', label: 'U-238 capture resonances' },
      { kind: 'xs', id: 'U-235', label: 'U-235 fission' },
      { kind: 'xs', id: 'B-10', label: 'B-10: clean 1/v' },
      { kind: 'xs', id: 'Fe-56', label: 'Fe-56: wide resonances' },
    ],
    links: [['Neutron cross section', W('Neutron_cross_section')], ['Neutron temperature', W('Neutron_temperature')], ['ENDF', W('Evaluated_Nuclear_Data_File')]],
    keywords: 'sigma energy plot graph 1/v resonance threshold',
  },
  {
    id: 'resonance', group: 'Neutron reactions', title: 'Resonances',
    body: [
      "A neutron joining a nucleus forms a compound nucleus carrying the neutron's binding energy plus its kinetic energy. When that total lands on one of the compound nucleus's excited states, the reaction becomes far more likely: a sharp peak.",
      "Each peak has a Breit–Wigner shape set by the state's energy and how fast it decays by each route (neutron, gamma, fission). Heavy nuclei have many closely spaced states, so their resonances start at a few eV. Light and magic nuclei have few, widely spaced ones.",
      "Thermal motion of the target atoms smears the peaks (Doppler broadening). Hotter fuel captures more neutrons in U-238's resonances, which helps keep reactors stable.",
    ],
    examples: [
      { kind: 'xs', id: 'U-238', label: 'U-238: dense resonances' },
      { kind: 'xs', id: 'Pb-208', label: 'Pb-208: few, far apart' },
    ],
    links: [['Compound nucleus', W('Compound_nucleus')], ['Breit–Wigner distribution', W('Breit%E2%80%93Wigner_distribution')], ['Doppler broadening', W('Doppler_broadening')], ['Resonance escape probability', W('Resonance_escape_probability')]],
    keywords: 'resonance peak compound breit wigner doppler resolved unresolved',
  },
  {
    id: 'rx-elastic', group: 'Neutron reactions', title: '(n,n) elastic scattering', move: 'no change · same nucleus',
    body: [
      'The neutron bounces off and the nucleus is left as it was, apart from its recoil. Nothing is transmuted, so elastic scattering never activates anything.',
      "It is how moderators work: each collision with a light nucleus such as hydrogen or carbon takes a large share of the neutron's energy, slowing fission neutrons to thermal speeds.",
    ],
    examples: [{ kind: 'xs', id: 'C-12', label: 'C-12, a graphite moderator' }],
    links: [['Elastic scattering', W('Elastic_scattering')], ['Neutron moderator', W('Neutron_moderator')], ['Neutron scattering', W('Neutron_scattering')]],
    keywords: 'elastic scattering moderator n,n',
  },
  {
    id: 'rx-inelastic', group: 'Neutron reactions', title: '(n,n′) inelastic scattering', move: 'no change · nucleus left excited',
    body: [
      'The neutron scatters but leaves the nucleus in an excited state, which then emits a gamma ray. The neutron loses at least that excitation energy, so this starts above a threshold, typically 0.1–1 MeV.',
      'It is the main way fast neutrons slow down in heavy materials such as iron and uranium.',
    ],
    examples: [{ kind: 'xs', id: 'Fe-56', label: 'Fe-56' }],
    links: [['Inelastic scattering', W('Inelastic_scattering')], ['Neutron scattering', W('Neutron_scattering')]],
    keywords: 'inelastic n,n′ excited',
  },
  {
    id: 'rx-fission', group: 'Neutron reactions', title: '(n,f) neutron-induced fission', move: 'splits into two lighter nuclei',
    body: [
      'The nucleus splits into two fragments, releasing about 200 MeV and two or three new neutrons. Fissile nuclei such as U-235 and Pu-239 fission with slow neutrons; U-238 and Th-232 need fast neutrons above about 1 MeV.',
      'Where the fragments land on the chart is shown in Fission mode.',
    ],
    examples: [
      { kind: 'xs', id: 'U-235', label: 'U-235: fissile' },
      { kind: 'xs', id: 'U-238', label: 'U-238: fast only' },
      { kind: 'mode', mode: 'fy', label: 'Fission yields' },
    ],
    links: [['Nuclear fission', W('Nuclear_fission')], ['Fissile material', W('Fissile_material')]],
    keywords: 'fission n,f fissile',
  },
  {
    id: 'rx-total', group: 'Neutron reactions', title: 'Total cross section',
    body: [
      'The sum of every reaction at that energy: elastic, inelastic, capture, fission and the rest. It is what a beam "sees": a thin sample lets through a fraction e^(−nσx) of the neutrons, which is how the total is measured.',
    ],
    links: [['Neutron cross section', W('Neutron_cross_section')]],
    keywords: 'total transmission',
  },
  {
    id: 'activation-share', group: 'Neutron reactions', title: 'Share of activation',
    body: [
      'For the chosen target, each reaction\'s weight is the isotope\'s natural abundance × its cross section. Its share is that weight divided by the total, so the shares add up to 100%.',
      'Share tells you what forms most often. How radioactive a product becomes also depends on its half-life: a long-lived product builds up activity slowly, while a short-lived one saturates quickly and then disappears soon after irradiation stops.',
    ],
    examples: [{ kind: 'act', target: 'Co', sp: 0, label: 'Cobalt in thermal neutrons' }],
    links: [['Neutron activation', W('Neutron_activation')], ['Activation product', W('Activation_product')]],
    keywords: 'production weight abundance',
  },

  // ------------------------------------------------------------ fission
  {
    id: 'fission-yields', group: 'Fission', title: 'Fission product yields',
    body: [
      'A fissioning nucleus usually splits unevenly, so the products form two humps: one around mass 95 and one around mass 138 for U-235.',
      'Independent yield: the chance per fission that a nuclide is made directly by the split. Because each fission makes two fragments, these add up to 2 (200%).',
      'Cumulative yield: also counts everything that later decays into it, which is what you eventually find in spent fuel. Cs-137 and Sr-90 have cumulative yields around 6%.',
    ],
    examples: [{ kind: 'fy', sys: 'U235_t', label: 'U-235 thermal fission' }],
    links: [['Fission product yield', W('Fission_product_yield')], ['Nuclear fission product', W('Nuclear_fission_product')]],
    keywords: 'independent cumulative double hump',
  },
  {
    id: 'fission-systems', group: 'Fission', title: 'Fissioning systems',
    body: [
      'Yields depend on what is fissioning and how fast the incoming neutron is. With more energy, symmetric splits become likelier and the valley between the two humps fills in.',
      'Compare U-235 thermal with U-235 at 14 MeV, or with Cf-252 spontaneous fission.',
    ],
    examples: [{ kind: 'fy', sys: 'U235_h', label: 'U-235 at 14 MeV' }, { kind: 'fy', sys: 'Pu239_t', label: 'Pu-239 thermal' }, { kind: 'fy', sys: 'Cf252_sf', label: 'Cf-252 spontaneous' }],
    links: [['Nuclear fission', W('Nuclear_fission')], ['Spontaneous fission', W('Spontaneous_fission')]],
  },
  {
    id: 'decay-heat', group: 'Fission', title: 'Decay of fission products',
    body: [
      '"Decay fission products" follows the fragments of one fission as they decay. The total activity falls roughly as time⁻¹·², which is why reactors keep producing heat long after shutdown.',
      'After a few years, Cs-137 and Sr-90 (both about 30-year half-lives) dominate, and after centuries even they have faded.',
    ],
    links: [['Decay heat', W('Decay_heat')], ['Nuclear fission product', W('Nuclear_fission_product')]],
    keywords: 'pulse decay heat spent fuel',
  },

  // ------------------------------------------------------------ properties
  {
    id: 'half-life', group: 'Nuclear properties', title: 'Half-life',
    body: [
      'The time for half of a sample to decay. It ranges from about 10⁻²² s for unbound nuclei to longer than 10²⁴ years for double-β emitters.',
      'The decay constant is λ = ln 2 / T½, and activity is λ × the number of atoms.',
    ],
    examples: [{ kind: 'color', mode: 'halflife', label: 'Color by half-life' }],
    links: [['Half-life', W('Half-life')]],
  },
  {
    id: 'q-value', group: 'Nuclear properties', title: 'Q-values',
    body: [
      'Q is the energy a decay releases: the mass before minus the mass after, times c². If Q is positive the decay can happen; if negative it cannot.',
      'The Q(β⁻), Q(EC) and Q(α) color modes show where each decay is energetically allowed, which explains the shape of the decay-mode map.',
    ],
    examples: [{ kind: 'color', mode: 'qa', label: 'Color by Q(α)' }],
    links: [['Q value', W('Q_value_(nuclear_science)')], ['Decay energy', W('Decay_energy')]],
  },
  {
    id: 'binding', group: 'Nuclear properties', title: 'Binding energy per nucleon',
    body: [
      'The energy needed to pull a nucleus completely apart, divided by its number of nucleons. It peaks around iron and nickel (about 8.8 MeV).',
      'That peak is why fusing light nuclei and splitting heavy ones both release energy.',
    ],
    examples: [{ kind: 'color', mode: 'be', label: 'Color by B/A' }, { kind: 'nuclide', id: 'Ni-62' }],
    links: [['Nuclear binding energy', W('Nuclear_binding_energy')]],
  },
  {
    id: 'mass-excess', group: 'Nuclear properties', title: 'Mass excess',
    body: [
      'The difference between a nuclide\'s actual mass and its mass number A in atomic mass units, given in MeV. Every Q-value is a difference of mass excesses.',
    ],
    examples: [{ kind: 'color', mode: 'me', label: 'Color by mass excess' }],
    links: [['Mass excess', W('Mass_excess')]],
  },
  {
    id: 'separation', group: 'Nuclear properties', title: 'Separation energies and drip lines',
    body: [
      'S(n) and S(p) are the energies needed to remove one neutron or one proton. Where they fall to zero are the drip lines, the edges of nuclear existence.',
      'The striped look comes from pairing: nucleons bind more tightly in pairs, so adding a neutron to an odd-N nucleus gains more energy than adding one to an even-N nucleus.',
    ],
    examples: [{ kind: 'color', mode: 'sn', label: 'Color by S(n)' }],
    links: [['Separation energy', W('Separation_energy')], ['Nuclear drip line', W('Nuclear_drip_line')], ['Even and odd nuclei', W('Even_and_odd_atomic_nuclei')]],
  },
  {
    id: 'spin-parity', group: 'Nuclear properties', title: 'Spin and parity (Jπ)',
    body: [
      'J is the nucleus\'s total angular momentum; π (+ or −) is its parity, a mirror symmetry. Nuclei with even Z and even N always have 0+ ground states, because their nucleons pair off.',
      'Values in parentheses are tentative assignments.',
    ],
    examples: [{ kind: 'color', mode: 'spin', label: 'Color by spin' }, { kind: 'color', mode: 'parity', label: 'Color by parity' }],
    links: [['Nuclear shell model', W('Nuclear_shell_model')], ['Parity', W('Parity_(physics)')]],
    keywords: 'jpi angular momentum',
  },
  {
    id: 'magnetic-moment', group: 'Nuclear properties', title: 'Magnetic moment',
    body: [
      'How strongly the nucleus acts like a tiny magnet, measured in nuclear magnetons (μN). It comes mostly from the unpaired nucleons and is what NMR and MRI detect.',
    ],
    examples: [{ kind: 'color', mode: 'mu', label: 'Color by μ' }],
    links: [['Nuclear magnetic moment', W('Nuclear_magnetic_moment')]],
  },
  {
    id: 'quadrupole', group: 'Nuclear properties', title: 'Quadrupole moment (shape)',
    body: [
      'Measures how far the charge is from spherical. Positive means stretched like a cigar (prolate), negative means flattened like a disc (oblate).',
      'Large values cluster in the rare earths and actinides, regions far from magic numbers where nuclei are strongly deformed.',
    ],
    examples: [{ kind: 'color', mode: 'q', label: 'Color by Q' }],
    links: [['Nuclear quadrupole moment', W('Nuclear_quadrupole_moment')]],
    keywords: 'deformation prolate oblate shape',
  },
  {
    id: 'charge-radius', group: 'Nuclear properties', title: 'Charge radius',
    body: [
      'The root-mean-square radius of the proton distribution, a few femtometres (10⁻¹⁵ m). It grows roughly as 1.2 × A^(1/3) fm, because nuclear matter has nearly constant density.',
    ],
    examples: [{ kind: 'color', mode: 'rad', label: 'Color by radius' }],
    links: [['Charge radius', W('Charge_radius')]],
  },
  {
    id: 'valley', group: 'Nuclear properties', title: 'Valley of stability and N/Z',
    body: [
      'Light stable nuclei have about equal numbers of neutrons and protons; heavy ones need up to about 1.5 neutrons per proton to dilute the protons\' electric repulsion.',
      'Shift + scroll on the chart travels along this valley.',
    ],
    examples: [{ kind: 'color', mode: 'nz', label: 'Color by N/Z' }],
    links: [['Valley of stability', W('Valley_of_stability')], ['Neutron–proton ratio', W('Neutron%E2%80%93proton_ratio')]],
  },
  {
    id: 'magic', group: 'Nuclear properties', title: 'Magic numbers',
    body: [
      '2, 8, 20, 28, 50, 82 and 126 protons or neutrons fill complete shells, like noble gases for electrons, and make nuclei extra stable. The faint lines on the chart mark them.',
      'Nuclei magic in both Z and N are "doubly magic": He-4, O-16, Ca-40, Ca-48, Ni-56, Sn-132 and Pb-208.',
    ],
    examples: [{ kind: 'nuclide', id: 'Pb-208' }, { kind: 'nuclide', id: 'Sn-132' }, { kind: 'nuclide', id: 'Ca-48' }],
    links: [['Magic number', W('Magic_number_(physics)')], ['Nuclear shell model', W('Nuclear_shell_model')]],
    keywords: 'shell closure doubly magic',
  },
  {
    id: 'abundance', group: 'Nuclear properties', title: 'Natural abundance',
    body: [
      'The fraction of an element\'s atoms on Earth that are this isotope. Activation weights each isotope of a natural element by its abundance.',
    ],
    examples: [{ kind: 'color', mode: 'abundance', label: 'Color by abundance' }],
    links: [['Natural abundance', W('Natural_abundance')]],
  },
  {
    id: 'discovery', group: 'Nuclear properties', title: 'Discovery year',
    body: [
      'When each nuclide was first identified. Stable and naturally radioactive nuclides came first; exotic ones far from stability are still being found with accelerators, while the superheavies push toward the predicted "island of stability".',
    ],
    examples: [{ kind: 'color', mode: 'disc', label: 'Color by discovery year' }],
    links: [['Table of nuclides', W('Table_of_nuclides')], ['Island of stability', W('Island_of_stability')]],
  },
];

/** Help topic for each decay family / mode. */
export function decayTopic(mode: string, family: string, delayed = false): string {
  if (delayed) return 'delayed';
  if (/^2(B|EC)/.test(mode)) return 'double-beta';
  return ({ 'B-': 'beta-minus', EC: 'beta-plus', A: 'alpha', SF: 'sf', P: 'proton-emission', N: 'neutron-emission', IT: 'isomer', CL: 'cluster' } as Record<string, string>)[family] ?? 'decay-modes';
}

/** Help topic for a reaction label such as "n,γ". */
export function reactionTopic(label: string): string {
  return ({
    'n,γ': 'rx-ng', 'n,2n': 'rx-n2n', 'n,3n': 'rx-n3n', 'n,p': 'rx-np', 'n,d': 'rx-nd', 'n,np': 'rx-nnp',
    'n,t': 'rx-nt', 'n,³He': 'rx-nhe3', 'n,α': 'rx-na', 'n,nα': 'rx-nna',
  } as Record<string, string>)[label] ?? 'reactions';
}

/** Help topic for a colour mode. */
export function colorTopic(mode: string): string {
  return ({
    decay: 'decay-modes', halflife: 'half-life', qbm: 'q-value', qec: 'q-value', qa: 'q-value', be: 'binding', me: 'mass-excess',
    sn: 'separation', sp: 'separation', fy: 'fission-yields', act: 'activation-share', spin: 'spin-parity', parity: 'spin-parity',
    mu: 'magnetic-moment', q: 'quadrupole', rad: 'charge-radius', nz: 'valley', abundance: 'abundance', disc: 'discovery',
  } as Record<string, string>)[mode] ?? 'colors';
}

// Appearance popover: theme, decay palette, gradients, magic-number lines.
import { DECAY_PALETTES, DIV_GRADIENTS, SEQ_GRADIENTS, css, paletteColor, setDecayPalette, setGradients, setThemeCells, type GradientChoice } from '../colors';
import { THEMES, applyThemeVars, themeById, type Theme } from '../themes';
import { el } from './dom';

export interface Look {
  theme: string;
  decay: string;
  seq: string;
  div: string;
  magic: boolean;
}

const DEFAULT_LOOK: Look = { theme: 'graphite', decay: 'modern', seq: 'auto', div: 'auto', magic: true };

export class Appearance {
  look: Look;
  private pop: HTMLElement | null = null;
  onChange: (what: 'theme' | 'colors' | 'magic') => void = () => {};

  constructor(button: HTMLElement) {
    this.look = { ...DEFAULT_LOOK };
    try {
      const saved = JSON.parse(localStorage.getItem('con.look') ?? 'null');
      if (saved) this.look = { ...DEFAULT_LOOK, ...saved };
      else if (localStorage.getItem('con.theme') === 'light' || (!localStorage.getItem('con.theme') && matchMedia('(prefers-color-scheme: light)').matches)) this.look.theme = 'paper';
    } catch { /* ignore */ }
    this.applyAll();
    button.addEventListener('click', e => {
      e.stopPropagation();
      if (this.isOpen) this.close(); else this.open();
    });
    document.addEventListener('pointerdown', e => {
      if (this.pop && !this.pop.contains(e.target as Node) && !button.contains(e.target as Node)) this.close();
    });
  }

  get theme(): Theme { return themeById(this.look.theme); }
  get isOpen() { return !!this.pop; }

  private applyAll() {
    const th = this.theme;
    applyThemeVars(th);
    setThemeCells(th.cells);
    setDecayPalette(this.look.decay);
    setGradients(this.look.seq, this.look.div);
  }

  private save() {
    try { localStorage.setItem('con.look', JSON.stringify(this.look)); } catch { /* ignore */ }
  }

  set(patch: Partial<Look>) {
    const prevTheme = this.look.theme;
    this.look = { ...this.look, ...patch };
    this.applyAll();
    this.save();
    if (patch.theme && patch.theme !== prevTheme) this.onChange('theme');
    else if ('magic' in patch) this.onChange('magic');
    else this.onChange('colors');
    if (this.pop) this.render();
  }

  cycleTheme(dir = 1) {
    const i = THEMES.findIndex(t => t.id === this.look.theme);
    this.set({ theme: THEMES[(i + dir + THEMES.length) % THEMES.length].id });
  }

  open() {
    this.pop = el('div', { class: 'look', role: 'dialog' });
    document.body.append(this.pop);
    this.render();
  }

  close() {
    this.pop?.remove();
    this.pop = null;
  }

  private render() {
    const P = this.pop!;
    P.innerHTML = '';
    const pal = DECAY_PALETTES.find(p => p.id === this.look.decay) ?? DECAY_PALETTES[0];

    // Themes
    const grid = el('div', { class: 'themes' });
    for (const th of THEMES) {
      const v = th.vars;
      const pv = el('span', { class: 'pv', style: `background:${v['--chart-bg']}` },
        el('i', { style: `background:${pal.c['B-']}` }),
        el('i', { style: `background:${th.cells.stable}` }),
        el('i', { style: `background:${pal.c.EC}` }),
        el('i', { style: `background:${pal.c.A}` }),
        el('b', { style: `background:${v['--accent']}` }));
      const card = el('button', { class: 'theme-card' + (th.id === this.look.theme ? ' on' : ''), title: th.label },
        pv, el('span', { class: 'nm', style: `background:${v['--panel-solid']};color:${v['--text']};font-family:${v['--font']}` }, th.label));
      card.addEventListener('click', () => this.set({ theme: th.id }));
      grid.append(card);
    }
    P.append(el('div', {}, el('h5', {}, 'Theme'), grid));

    // Decay palettes
    const pals = el('div', { class: 'pals' });
    for (const p of DECAY_PALETTES) {
      const sw = el('span', { class: 'sw' });
      for (const k of ['B-', 'EC', 'A', 'SF', 'P', 'N', 'CL', 'IT']) sw.append(el('i', { style: `background:${paletteColor(p, k)}` }));
      const b = el('button', { class: 'pal' + (p.id === this.look.decay ? ' on' : '') }, sw, el('span', { class: 'nm' }, p.label));
      b.addEventListener('click', () => this.set({ decay: p.id }));
      pals.append(b);
    }
    P.append(el('div', {}, el('h5', {}, 'Decay colors'), pals));

    // Gradients
    const gradList = (list: GradientChoice[], cur: string, key: 'seq' | 'div') => {
      const g = el('div', { class: 'grads' });
      for (const c of list) {
        const bar = el('span', { class: 'gbar' + (c.scale ? '' : ' auto') });
        if (c.scale) {
          const stops: string[] = [];
          for (let i = 0; i <= 12; i++) stops.push(css(c.scale(i / 12)));
          bar.style.background = `linear-gradient(90deg,${stops.join(',')})`;
        }
        const b = el('button', { class: 'grad' + (c.id === cur ? ' on' : '') }, bar, c.label);
        b.addEventListener('click', () => this.set({ [key]: c.id } as Partial<Look>));
        g.append(b);
      }
      return g;
    };
    P.append(el('div', {}, el('h5', {}, 'Gradient'), gradList(SEQ_GRADIENTS, this.look.seq, 'seq')));
    P.append(el('div', {}, el('h5', {}, 'Diverging gradient'), gradList(DIV_GRADIENTS, this.look.div, 'div')));

    // Magic numbers
    const sw = el('button', { class: 'switch' + (this.look.magic ? ' on' : ''), 'aria-label': 'Magic number lines' });
    sw.addEventListener('click', () => this.set({ magic: !this.look.magic }));
    P.append(el('div', { class: 'switch-row' }, el('span', {}, 'Magic number lines'), sw));
  }
}

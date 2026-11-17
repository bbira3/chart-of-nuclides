// UI themes: CSS custom properties applied to :root, plus cell colours for the chart.

export interface Theme {
  id: string;
  label: string;
  dark: boolean;
  vars: Record<string, string>;
  cells: { stable: string; unknown: string; missing: string };
}

const MONO = `"JetBrains Mono", "Cascadia Code", ui-monospace, Consolas, monospace`;
const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
const SANS = `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const DARK_SHADOW = '0 10px 34px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.03) inset';
const LIGHT_SHADOW = '0 8px 30px rgba(20,30,50,0.14)';

function t(
  id: string, label: string, dark: boolean,
  c: {
    bg: string; panel: string; solid: string; panel2: string; line: string; line2: string;
    text: string; dim: string; faint: string; accent: string; accentSoft: string;
    magic: string; axis: string; font?: string; shadow?: string; chartBg?: string;
  },
  cells: Theme['cells'],
): Theme {
  return {
    id, label, dark, cells,
    vars: {
      '--bg': c.bg, '--chart-bg': c.chartBg ?? c.bg, '--chart-magic': c.magic, '--chart-axis': c.axis,
      '--panel': c.panel, '--panel-solid': c.solid, '--panel-2': c.panel2, '--line': c.line, '--line-2': c.line2,
      '--text': c.text, '--text-dim': c.dim, '--text-faint': c.faint, '--accent': c.accent, '--accent-soft': c.accentSoft,
      '--shadow': c.shadow ?? (dark ? DARK_SHADOW : LIGHT_SHADOW), '--font': c.font ?? SANS,
    },
  };
}

export const THEMES: Theme[] = [
  t('graphite', 'Graphite', true, {
    bg: '#0d0f13', panel: 'rgba(22,25,31,0.9)', solid: '#16191f', panel2: '#1e222a', line: 'rgba(255,255,255,0.08)',
    line2: 'rgba(255,255,255,0.14)', text: '#e9ecf1', dim: '#8b93a1', faint: '#5f6774', accent: '#6aa8ff',
    accentSoft: 'rgba(106,168,255,0.16)', magic: 'rgba(255,255,255,0.22)', axis: '#9aa3b0',
  }, { stable: '#eef0f3', unknown: '#4b5058', missing: '#3a3e46' }),
  t('paper', 'Paper', false, {
    bg: '#f4f5f7', panel: 'rgba(255,255,255,0.92)', solid: '#ffffff', panel2: '#f0f2f5', line: 'rgba(0,0,0,0.08)',
    line2: 'rgba(0,0,0,0.14)', text: '#15181d', dim: '#5d6573', faint: '#9299a5', accent: '#2a6fdb',
    accentSoft: 'rgba(42,111,219,0.12)', magic: 'rgba(0,0,0,0.25)', axis: '#4a5260',
  }, { stable: '#1b1d22', unknown: '#c5c9cf', missing: '#d6d9de' }),
  t('midnight', 'Midnight', true, {
    bg: '#060912', panel: 'rgba(12,18,34,0.9)', solid: '#0c1222', panel2: '#141c33', line: 'rgba(140,170,255,0.10)',
    line2: 'rgba(140,170,255,0.2)', text: '#e4eaff', dim: '#8693b8', faint: '#56607e', accent: '#7aa2ff',
    accentSoft: 'rgba(122,162,255,0.18)', magic: 'rgba(140,170,255,0.3)', axis: '#8fa0c8',
  }, { stable: '#f1f4ff', unknown: '#3a4566', missing: '#1c2540' }),
  t('nord', 'Arctic', true, {
    bg: '#2e3440', panel: 'rgba(59,66,82,0.92)', solid: '#3b4252', panel2: '#434c5e', line: 'rgba(216,222,233,0.08)',
    line2: 'rgba(216,222,233,0.16)', text: '#eceff4', dim: '#a3adbf', faint: '#7b869a', accent: '#88c0d0',
    accentSoft: 'rgba(136,192,208,0.18)', magic: 'rgba(236,239,244,0.25)', axis: '#c0c8d6',
  }, { stable: '#eceff4', unknown: '#5b6578', missing: '#3f4656' }),
  t('blueprint', 'Blueprint', true, {
    bg: '#0d3a6b', panel: 'rgba(9,44,84,0.92)', solid: '#0b3260', panel2: '#124a85', line: 'rgba(207,226,255,0.16)',
    line2: 'rgba(207,226,255,0.32)', text: '#f0f6ff', dim: '#a9c6ee', faint: '#7397c4', accent: '#ffd166',
    accentSoft: 'rgba(255,209,102,0.18)', magic: 'rgba(255,255,255,0.5)', axis: '#cfe2ff', font: MONO,
  }, { stable: '#ffffff', unknown: '#2c5e96', missing: '#164a80' }),
  t('phosphor', 'Phosphor', true, {
    bg: '#020803', panel: 'rgba(4,18,8,0.92)', solid: '#04120a', panel2: '#082012', line: 'rgba(57,255,136,0.12)',
    line2: 'rgba(57,255,136,0.25)', text: '#b9ffd0', dim: '#4fb874', faint: '#2f7a4a', accent: '#39ff88',
    accentSoft: 'rgba(57,255,136,0.14)', magic: 'rgba(57,255,136,0.35)', axis: '#6fe39a', font: MONO,
  }, { stable: '#d8ffe5', unknown: '#1d3b28', missing: '#0f2416' }),
  t('synthwave', 'Synthwave', true, {
    bg: '#12071f', panel: 'rgba(29,12,48,0.9)', solid: '#1b0c2e', panel2: '#271341', line: 'rgba(255,79,216,0.12)',
    line2: 'rgba(255,79,216,0.25)', text: '#fbeaff', dim: '#b48fcf', faint: '#7c5d99', accent: '#ff4fd8',
    accentSoft: 'rgba(255,79,216,0.16)', magic: 'rgba(0,229,255,0.4)', axis: '#d9a7ff',
  }, { stable: '#fff3fe', unknown: '#3d2559', missing: '#24133a' }),
  t('parchment', 'Parchment', false, {
    bg: '#f2e8d5', panel: 'rgba(251,245,232,0.94)', solid: '#fbf5e8', panel2: '#efe3cc', line: 'rgba(80,50,20,0.10)',
    line2: 'rgba(80,50,20,0.2)', text: '#3b2f22', dim: '#7a6650', faint: '#a8957d', accent: '#b5562b',
    accentSoft: 'rgba(181,86,43,0.14)', magic: 'rgba(80,50,20,0.32)', axis: '#5c4a36', font: SERIF,
  }, { stable: '#2b2118', unknown: '#cbbca3', missing: '#e3d6bf' }),
  t('contrast', 'High contrast', true, {
    bg: '#000000', panel: 'rgba(0,0,0,0.96)', solid: '#000000', panel2: '#121212', line: 'rgba(255,255,255,0.35)',
    line2: 'rgba(255,255,255,0.6)', text: '#ffffff', dim: '#e0e0e0', faint: '#bdbdbd', accent: '#ffd400',
    accentSoft: 'rgba(255,212,0,0.2)', magic: 'rgba(255,255,255,0.6)', axis: '#ffffff',
  }, { stable: '#ffffff', unknown: '#5a5a5a', missing: '#262626' }),
];

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find(x => x.id === id) ?? THEMES[0];
}

/** Apply a theme's variables to the document and remember them for the next page load. */
export function applyThemeVars(th: Theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  root.dataset.theme = th.dark ? 'dark' : 'light';
  root.style.colorScheme = th.dark ? 'dark' : 'light';
  try {
    localStorage.setItem('con.themeVars', JSON.stringify({ dark: th.dark, vars: th.vars }));
  } catch { /* ignore */ }
}

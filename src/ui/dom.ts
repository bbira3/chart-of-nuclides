import type { Nuclide } from '../data';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

type Child = Node | string | number | null | undefined | false;
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

/** Nuclide name with superscript mass number, e.g. ¹³⁷Cs. */
export function label(nu: Nuclide, cls = 'nm'): HTMLSpanElement {
  return el('span', { class: cls }, el('sup', { class: 'a' }, nu.a), nu.z === 0 ? 'n' : nu.s);
}

export function toast(msg: string) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

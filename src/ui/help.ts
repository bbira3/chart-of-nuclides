// Help panel: searchable topics with explanations, live examples and Wikipedia links.
import { GROUPS, TOPICS, type Example, type Topic } from '../helpContent';
import { $, el } from './dom';

export class Help {
  private root = $('#help');
  private nav = $('#helpNav');
  private article = $('#helpArticle');
  private search = $('#helpSearch') as HTMLInputElement;
  private current: Topic = TOPICS[0];
  /** Called when the user presses a "Try it" example. */
  onExample: (ex: Example) => void = () => {};

  constructor() {
    this.root.addEventListener('pointerdown', e => { if (e.target === this.root) this.close(); });
    $('#helpClose').addEventListener('click', () => this.close());
    this.bindHoverCards();
    this.search.addEventListener('input', () => this.renderNav());
    this.search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const first = this.matches()[0];
        if (first) this.show(first.id);
      }
    });
  }

  get isOpen() { return !this.root.hidden; }

  // ------------------------------------------------------------ hover cards
  // Anything with data-help shows a short explanation on hover; clicking opens the topic.
  private card: HTMLElement | null = null;
  private cardFor: HTMLElement | null = null;
  private cardTimer = 0;

  private bindHoverCards() {
    document.addEventListener('pointerover', e => {
      if (e.pointerType === 'touch') return;
      const t = (e.target as Element | null)?.closest?.('[data-help]') as HTMLElement | null;
      if (t === this.cardFor) return;
      this.hideCard();
      if (!t || this.isOpen) return;
      this.cardFor = t;
      this.cardTimer = window.setTimeout(() => this.showCard(t), 280);
    });
    document.addEventListener('pointerout', e => {
      const to = e.relatedTarget as Node | null;
      if (this.cardFor && (!to || !this.cardFor.contains(to))) this.hideCard();
    });
    document.addEventListener('pointerdown', () => this.hideCard(), true);
    window.addEventListener('scroll', () => this.hideCard(), true);
  }

  private showCard(target: HTMLElement) {
    const t = TOPICS.find(x => x.id === target.dataset.help);
    if (!t || !target.isConnected) return;
    const card = el('div', { class: 'hovercard', role: 'tooltip' }, el('b', {}, t.title));
    if (t.move) card.append(el('span', { class: 'move' }, t.move));
    card.append(el('p', {}, summary(t.body[0] ?? '')), el('div', { class: 'more' }, 'Click for the full explanation'));
    document.body.append(card);
    this.card = card;
    const r = target.getBoundingClientRect();
    const w = card.offsetWidth, h = card.offsetHeight;
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    const top = r.bottom + h + 12 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  private hideCard() {
    clearTimeout(this.cardTimer);
    this.card?.remove();
    this.card = null;
    this.cardFor = null;
  }

  open(topicId?: string) {
    this.hideCard();
    this.root.hidden = false;
    if (topicId) this.search.value = '';
    this.show(topicId ?? this.current.id);
    if (!topicId) setTimeout(() => this.search.focus(), 0);
  }

  close() { this.root.hidden = true; }

  show(id: string) {
    this.current = TOPICS.find(t => t.id === id) ?? TOPICS[0];
    this.renderNav();
    this.renderArticle();
  }

  private matches(): Topic[] {
    const q = this.search.value.trim().toLowerCase();
    if (!q) return TOPICS;
    const norm = (s: string) => s.toLowerCase().replace(/[()]/g, '');
    const qq = norm(q);
    return TOPICS.filter(t => norm(`${t.title} ${t.keywords ?? ''} ${t.body.join(' ')} ${t.move ?? ''}`).includes(qq));
  }

  private renderNav() {
    const list = this.matches();
    this.nav.innerHTML = '';
    for (const g of GROUPS) {
      const items = list.filter(t => t.group === g);
      if (!items.length) continue;
      this.nav.append(el('h6', {}, g));
      for (const t of items) {
        const b = el('button', { class: t.id === this.current.id ? 'on' : '' }, t.title);
        b.addEventListener('click', () => this.show(t.id));
        this.nav.append(b);
      }
    }
    if (!list.length) this.nav.append(el('div', { class: 'stat' }, 'No matching topics'));
    this.nav.querySelector('button.on')?.scrollIntoView({ block: 'nearest' });
  }

  private renderArticle() {
    const t = this.current;
    const A = this.article;
    A.innerHTML = '';
    A.scrollTop = 0;
    A.append(el('div', { class: 'grp' }, t.group), el('h2', {}, t.title));
    if (t.move) A.append(el('div', { class: 'move' }, t.move));
    for (const p of t.body) A.append(el('p', {}, p));
    if (t.chart) A.append(el('p', { class: 'hint' }, t.chart));
    if (t.examples?.length) {
      const row = el('div', { class: 'try' });
      for (const ex of t.examples) {
        const label = ex.kind === 'nuclide' ? ex.label ?? ex.id : ex.label;
        const b = el('button', { class: 'btn' }, label);
        b.addEventListener('click', () => { this.close(); this.onExample(ex); });
        row.append(b);
      }
      A.append(el('h5', {}, 'Try it'), row);
    }
    if (t.links.length) {
      const ul = el('ul', { class: 'wiki' });
      for (const [label, url] of t.links) ul.append(el('li', {}, el('a', { href: url, target: '_blank', rel: 'noopener' }, label, ' ↗')));
      A.append(el('h5', {}, 'Read more on Wikipedia'), ul);
    }
    // Related: other topics in the same group, for easy browsing.
    const related = TOPICS.filter(x => x.group === t.group && x.id !== t.id).slice(0, 8);
    if (related.length) {
      const row = el('div', { class: 'related' });
      for (const r of related) {
        const b = el('button', { class: 'chip' }, r.title);
        b.addEventListener('click', () => this.show(r.id));
        row.append(b);
      }
      A.append(el('h5', {}, `More in ${t.group}`), row);
    }
  }
}

/** First sentence or two of a paragraph, kept short for hover cards. */
function summary(p: string, max = 220): string {
  if (p.length <= max) return p;
  const cut = p.lastIndexOf('. ', max);
  return cut > 60 ? p.slice(0, cut + 1) : `${p.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

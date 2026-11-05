// Owner: A2.
// The instant, deterministic "focus" layout: main task first with what it needs, the primary action
// prominent, ads / promotions / recommendations to the end drawer, navigation collapsed, help and consent
// always open. Same schema and validator as the model's candidates (research-redesign §9).
import type { FitSection, FitSpec, FitSummaryForModel, OutlineKind, PageOutline, Role, SectionLabel } from '../types';
import {
  ACTION_KINDS, CONTAINER_KINDS, CONTROL_KINDS, FIELD_KINDS, RE, chatRoot, fieldGroup, indexOutline, isSideField, isUtility,
  isWarningOverlay, labelFromWords, layoutLimits, lower, outlineProtection, overlayRoot, pickPrimaryAction, snapShowFirst,
  type OutlineIndex,
} from './outline';
import { FIT_PAGE_TYPES, repairSpec } from './spec';

type Cat =
  | 'consent' | 'alert' | 'popup' | 'chat' | 'help' | 'ads' | 'related' | 'promo' | 'nav' | 'legal' | 'header' | 'footer'
  | 'aside' | 'main' | 'other';

interface Unit { id: string; cat: Cat }

const FOLD: ReadonlySet<Cat> = new Set<Cat>(['ads', 'related', 'promo', 'popup']);
const SPECIAL: ReadonlySet<Cat> = new Set<Cat>(['consent', 'alert', 'chat', 'help', 'ads', 'related', 'promo', 'popup']);
/** A form is stepped only with at least this many real fields (search and sign-up fields do not count). */
const MIN_STEP_FIELDS = 3;
/** At most this many steps: more fieldsets are merged (smallest neighbours first). */
const MAX_FORM_STEPS = 6;
const BUY_RE = /\b(add to (cart|bag|basket)|buy( now)?|add to order)\b/;

function section(p: Partial<FitSection> & Pick<FitSection, 'label' | 'role' | 'nodes'>): FitSection {
  return { heading_ref: null, layout: 'as_is', emphasis: 'normal', state: 'open', why: 'main_task', show_first: 0, ...p };
}

class Heuristic {
  readonly ix: OutlineIndex;
  readonly roles: Record<string, Role>;
  private readonly specialBelow = new Map<string, boolean>();
  private readonly stripBelow = new Map<string, boolean>();

  constructor(readonly outline: PageOutline, roles: Record<string, Role>, readonly fit: FitSummaryForModel) {
    this.ix = indexOutline(outline);
    this.roles = roles;
  }

  role(id: string): Role | undefined { return this.roles[id] ?? this.ix.nodes.get(id)?.jevRole; }
  kind(id: string): OutlineKind | undefined { return this.ix.kind(id); }
  ord(id: string): number { return this.ix.order.get(id) ?? 0; }

  /** Category from the node's own evidence (role, label, zone, landmark), or null to inherit. */
  ownCat(id: string): Cat | null {
    const n = this.ix.nodes.get(id);
    if (!n) return null;
    const role = this.role(id);
    const label = lower(n.label);
    const zone = n.zone ?? '';
    const lm = lower(n.landmark);
    const action = ACTION_KINDS.has(n.kind);
    const prot = outlineProtection(this.ix, id, this.roles);
    if (prot === 'consent') return 'consent';
    if (chatRoot(this.ix, id) === id) return 'chat';
    const ov = overlayRoot(this.ix, id);
    if (ov === id && role === 'popup_overlay' && isWarningOverlay(this.ix, id, this.roles)) return 'alert';
    if (prot === 'alert') return 'alert';
    // Round 7: Jev's fine role. Teasers for other content, ads, upsells and newsletter boxes are never the page.
    const fine = n.fine;
    if (fine === 'advertising' || fine === 'sponsored') return 'ads';
    if (fine === 'teaser_other_content' || fine === 'social_share' || fine === 'video_autoplay') return 'related';
    if (fine === 'upsell_promo' || fine === 'newsletter_signup') return 'promo';
    // A team or organisation logo labels the content it sits in (a scoreboard): it stays with it.
    if (fine === 'team_or_org_logo') return null;
    // A logo is the site's name, shown in the top bar: never a card in the page.
    if (this.isLogo(id)) return 'header';
    if (role === 'advertising' || (!action && RE.ad.test(label))) return 'ads';
    if (role === 'recommendations' || (!action && RE.related.test(label))) return 'related';
    // A shelf of products with prices and "Add to cart" outside the main column is shopping, not the task.
    if ((n.kind === 'region' || n.kind === 'list') && !this.inMainLandmark(id) && lm !== 'main' && this.isShelf(id)) return 'related';
    if (prot === 'help' || (zone.startsWith('overlay') && RE.help.test(label))) return 'help';
    if (role === 'popup_overlay') return 'popup';
    if ((n.kind === 'region' || n.kind === 'list' || n.kind === 'image' || n.kind === 'media') && (RE.promo.test(label) || /carousel|slides?/.test(lower(n.shape)))) return 'promo';
    if (role === 'navigation' || lm === 'navigation' || (n.kind === 'region' && RE.nav.test(label))) return 'nav';
    if (role === 'legal_footer') return 'legal';
    if (lm === 'banner' || zone === 'header_band') return 'header';
    if (lm === 'contentinfo' || zone === 'footer_band') return 'footer';
    // A paragraph that starts at the left edge of the main column is not a side rail.
    if (lm === 'complementary' || ((zone === 'left_rail' || zone === 'right_rail') && !this.inMainLandmark(id))) return 'aside';
    if (lm === 'main' || zone === 'center_column' || zone === 'full_width_mid') return 'main';
    if (zone.startsWith('overlay')) return 'popup';
    return null;
  }

  isStripCandidate(id: string): boolean {
    const n = this.ix.nodes.get(id);
    if (!n || !CONTROL_KINDS.has(n.kind)) return false;
    if (FIELD_KINDS.has(n.kind) && !RE.search.test(lower(n.label)) && this.role(id) !== 'search') return false;
    const zone = n.zone ?? '';
    const top = zone === 'header_band' || lower(n.landmark) === 'banner' || zone.startsWith('overlay');
    return top && (isUtility(this.ix, id, this.roles) || outlineProtection(this.ix, id, this.roles) === 'help');
  }

  hasSpecialBelow(id: string): boolean {
    const hit = this.specialBelow.get(id);
    if (hit !== undefined) return hit;
    const v = (this.ix.children.get(id) ?? []).some((c) => {
      const cc = this.ownCat(c);
      return (cc != null && SPECIAL.has(cc)) || this.isLogo(c) || this.hasSpecialBelow(c);
    });
    this.specialBelow.set(id, v);
    return v;
  }

  hasStripBelow(id: string): boolean {
    const hit = this.stripBelow.get(id);
    if (hit !== undefined) return hit;
    const v = (this.ix.children.get(id) ?? []).some((c) => this.isStripCandidate(c) || this.hasStripBelow(c));
    this.stripBelow.set(id, v);
    return v;
  }

  isSectionHeading(id: string): boolean {
    const n = this.ix.nodes.get(id);
    return !!n && n.kind === 'heading' && (n.level == null || n.level <= 2);
  }

  /** The heading a unit opens with: itself, or its first heading descendant when that comes first. */
  headingOf(id: string): string | null {
    if (this.isSectionHeading(id)) return id;
    if (!CONTAINER_KINDS.has(this.kind(id) as OutlineKind)) return null;
    for (const d of this.ix.descendants(id)) {
      if (this.isSectionHeading(d)) return d;
      const k = this.kind(d);
      if (k === 'text' || FIELD_KINDS.has(k as OutlineKind) || k === 'list' || k === 'table') return null;
    }
    return null;
  }

  headingCarriers(id: string): number {
    return (this.ix.children.get(id) ?? []).filter((c) => this.isSectionHeading(c) || this.ix.descendants(c).some((d) => this.isSectionHeading(d))).length;
  }

  /** Split the tree into units that can each be placed whole. */
  units(id: string, inherited: Cat | null): Unit[] {
    const own = this.ownCat(id);
    const cat: Cat = own ?? inherited ?? 'other';
    const kids = this.ix.children.get(id) ?? [];
    if (!kids.length || !CONTAINER_KINDS.has(this.kind(id) as OutlineKind)) return [{ id, cat }];
    const protectedBelow = this.ix.descendants(id).some((d) => {
      const p = outlineProtection(this.ix, d, this.roles);
      return p === 'help' || p === 'consent' || p === 'alert' || p === 'field';
    });
    if (FOLD.has(cat) && !protectedBelow) return [{ id, cat }];
    if (cat === 'consent' || cat === 'alert' || cat === 'help' || cat === 'chat') return [{ id, cat }];
    let descend = kids.length === 1 && CONTAINER_KINDS.has(this.kind(kids[0] as string) as OutlineKind);
    if (!descend) descend = this.hasSpecialBelow(id) || this.hasStripBelow(id);
    if (!descend && (cat === 'main' || cat === 'other')) descend = this.headingCarriers(id) >= 2;
    if (!descend) return [{ id, cat }];
    return kids.flatMap((k) => this.units(k, cat));
  }

  isLogo(id: string): boolean {
    const n = this.ix.nodes.get(id);
    if (!n || n.fine === 'team_or_org_logo') return false;
    return n.fine === 'site_logo' || ((n.kind === 'image' || n.kind === 'link') && RE.logo.test(lower(n.label)));
  }

  isShelf(id: string): boolean {
    const ds = this.ix.descendants(id);
    if (ds.length > 400) return false;
    const buys = ds.filter((d) => ACTION_KINDS.has(this.kind(d) as OutlineKind) && BUY_RE.test(this.ix.label(d))).length;
    const prices = ds.filter((d) => /price/.test(lower(this.ix.nodes.get(d)?.shape))).length;
    return buys >= 3 || (buys >= 2 && prices >= 2) || prices >= 4;
  }

  inMainLandmark(id: string): boolean {
    return this.ix.ancestors(id).some((a) => lower(this.ix.nodes.get(a)?.landmark) === 'main');
  }

  inMainZone(id: string): boolean {
    const n = this.ix.nodes.get(id);
    const zone = n?.zone ?? '';
    return lower(n?.landmark) === 'main' || zone === 'center_column' || zone === 'full_width_mid';
  }

  subtree(ids: string[]): string[] {
    return ids.flatMap((id) => [id, ...this.ix.descendants(id)]);
  }

  /* ---- page type ---- */

  pageType(content: Set<string>, primary: string | null): FitSpec['page_type'] {
    const hint = this.outline.pageTypeHint;
    const ids = [...content];
    const nodes = ids.map((id) => this.ix.nodes.get(id)).filter((n) => n != null);
    const fields = ids.filter((id) => FIELD_KINDS.has(this.kind(id) as OutlineKind) && !isSideField(this.ix, id, this.roles)).length;
    // The reader's hint is taken unless it calls a page with only search or sign-up fields a form.
    if (hint && (FIT_PAGE_TYPES as readonly string[]).includes(hint) && !(hint === 'form' && fields < 2)) return hint as FitSpec['page_type'];
    const price = nodes.some((n) => /price/.test(lower(n.shape)));
    const buy = nodes.some((n) => ACTION_KINDS.has(n.kind) && BUY_RE.test(lower(n.label)));
    // A price shape and a buy button (a gallery usually comes with them but is not required).
    if (price && buy) return 'product_detail';
    const pa = primary ? this.ix.nodes.get(primary) : null;
    const paShort = !!pa && lower(pa.label).split(/\s+/).filter(Boolean).length <= 6;
    if (fields >= 4 || (fields >= 1 && pa && paShort && RE.submitLike.test(lower(pa.label)))) return 'form';
    const paragraphs = nodes.reduce((a, n) => {
      if (n.kind !== 'text') return a;
      const m = /x\s*(\d+)/.exec(lower(n.shape));
      return a + (m ? Number(m[1]) : 1);
    }, 0);
    const controls = nodes.filter((n) => CONTROL_KINDS.has(n.kind)).length;
    const h1 = nodes.some((n) => n.kind === 'heading' && n.level === 1);
    if (paragraphs >= 6 && controls < 15 && h1) return 'article';
    const bigList = nodes.some((n) => n.kind === 'list' && Number(/x\s*(\d+)/.exec(lower(n.shape))?.[1] ?? 0) >= 6);
    if (bigList) return nodes.some((n) => /\bresults?\b/.test(lower(n.label))) ? 'search_results' : 'listing';
    return 'other';
  }

  taskFor(type: FitSpec['page_type'], primary: string | null): FitSpec['task'] {
    const pl = primary ? lower(this.ix.nodes.get(primary)?.label) : '';
    switch (type) {
      case 'product_detail': return 'buy';
      case 'form':
        if (RE.account.test(pl)) return 'sign_in';
        if (/\bpay\b/.test(pl)) return 'pay';
        if (/\b(book|schedule|appointment|reserve)\b/.test(pl)) return 'book';
        return 'fill_form';
      case 'article': case 'docs': case 'feed': return 'read';
      case 'search_results': return 'search';
      case 'listing': return 'compare';
      case 'video': return 'watch';
      case 'home_portal': case 'account_dashboard': return 'navigate';
      default: return primary ? (BUY_RE.test(pl) ? 'buy' : RE.submitLike.test(pl) ? 'fill_form' : 'other') : 'other';
    }
  }

  /* ---- layout of one content group ---- */

  layoutFor(units: Unit[]): FitSection['layout'] {
    const ids = this.subtree(units.map((u) => u.id));
    const kinds = ids.map((id) => this.kind(id));
    const count = (k: OutlineKind): number => kinds.filter((x) => x === k).length;
    const bigList = ids.some((id) => this.kind(id) === 'list' && Number(/x\s*(\d+)/.exec(lower(this.ix.nodes.get(id)?.shape))?.[1] ?? 0) >= 3);
    const images = count('image') + count('media');
    if (count('table') >= 1 && count('text') <= 2) return 'facts';
    if (bigList || units.filter((u) => ACTION_KINDS.has(this.kind(u.id) as OutlineKind)).length >= 4) return images >= 2 ? 'card_grid' : 'row_list';
    if (images >= 2 && count('text') <= 2) return 'gallery';
    if (count('text') >= 1 && count('text') >= kinds.length / 3) return 'reading';
    return 'as_is';
  }

  /* ---- form steps ---- */

  formSteps(fields: string[], maxFields: number): Array<{ label: SectionLabel; fields: string[] }> {
    // One step per fieldset (GOV.UK: one thing per page), in page order. Fieldsets with one field merge with a
    // neighbouring small one; a long fieldset is split; at most MAX_FORM_STEPS steps.
    const runs: string[][] = [];
    let prevGroup: string | null | undefined;
    for (const f of fields) {
      const g = fieldGroup(this.ix, f);
      const last = runs[runs.length - 1];
      if (last && g === prevGroup) last.push(f); else runs.push([f]);
      prevGroup = g;
    }
    const consent = fields.filter((f) => RE.consentField.test(this.ix.label(f)));
    let steps: string[][] = [];
    for (const run of runs) {
      const r = run.filter((f) => !consent.includes(f) || fields.length <= 1);
      for (let i = 0; i < r.length; i += maxFields) steps.push(r.slice(i, i + maxFields));
    }
    steps = steps.filter((st) => st.length);
    // Lone fields join the next (or previous) small step.
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i] as string[];
      if (st.length !== 1 || steps.length <= 1) continue;
      const next = steps[i + 1];
      const prev = steps[i - 1];
      if (next && next.length + 1 <= maxFields) { next.unshift(...st); steps.splice(i, 1); i--; }
      else if (prev && prev.length + 1 <= maxFields) { prev.push(...st); steps.splice(i, 1); i--; }
    }
    while (steps.length > MAX_FORM_STEPS) {
      let best = 0;
      let size = Infinity;
      for (let i = 0; i < steps.length - 1; i++) {
        const n = (steps[i] as string[]).length + (steps[i + 1] as string[]).length;
        if (n < size) { size = n; best = i; }
      }
      steps.splice(best, 2, [...(steps[best] as string[]), ...(steps[best + 1] as string[])]);
    }
    if (consent.length && fields.length > 1) {
      const last = steps[steps.length - 1];
      if (last && last.length + consent.length <= maxFields) last.push(...consent); else steps.push([...consent]);
    }
    const labelOf = (fs: string[], i: number, n: number): SectionLabel => {
      const group = fieldGroup(this.ix, fs[0] as string);
      const words = `${group ? this.ix.label(group) : ''} ${fs.map((f) => this.ix.label(f)).join(' ')}`;
      if (i === n - 1 && n > 1 && fs.every((f) => consent.includes(f))) return 'Review and submit';
      const l = labelFromWords(words, 'Your details');
      return l === 'Details' ? 'Your details' : l;
    };
    return steps.map((fs, i) => ({ label: labelOf(fs, i, steps.length), fields: fs }));
  }

  /* ---- build ---- */

  build(): FitSpec {
    const limits = layoutLimits(this.fit);
    const units = this.ix.roots.flatMap((r) => this.units(r, null));
    // Content under a "Customers also viewed" / "Sponsored" heading takes that heading's category.
    let foldCat: Cat | null = null;
    let foldParent: string | null = null;
    for (const u of units) {
      if (this.isSectionHeading(u.id)) {
        foldCat = FOLD.has(u.cat) ? u.cat : null;
        foldParent = this.ix.parent(u.id);
        continue;
      }
      if (foldCat && (u.cat === 'main' || u.cat === 'other') && this.ix.parent(u.id) === foldParent && !outlineProtection(this.ix, u.id, this.roles)) {
        u.cat = foldCat;
      } else if (this.ix.parent(u.id) !== foldParent) {
        foldCat = null;
      }
    }
    const byCat = (c: Cat): Unit[] => units.filter((u) => u.cat === c);

    // Help in the main column stays next to the task; elsewhere it is lifted.
    const content: Unit[] = units.filter((u) => u.cat === 'main' || u.cat === 'other' || (u.cat === 'help' && this.inMainZone(u.id)));
    const contentIds = new Set(this.subtree(content.map((u) => u.id)));
    const primary = pickPrimaryAction(this.ix, this.roles, { allow: (id) => contentIds.has(id) });
    const pageType = this.pageType(contentIds, primary);

    // Group the content stream at section headings.
    const groups: Array<{ heading: string | null; units: Unit[] }> = [];
    for (const u of content) {
      const h = this.headingOf(u.id);
      const cur = groups[groups.length - 1];
      if (!cur || (h && cur.units.length)) groups.push({ heading: h, units: [u] });
      else { cur.units.push(u); if (!cur.heading && h) cur.heading = h; }
    }
    // Content before the page title (a product gallery, a lead image) belongs to the title block.
    const g0 = groups[0];
    const g1 = groups[1];
    if (g0 && g1 && g0.heading == null && g1.heading != null && this.ix.nodes.get(g1.heading)?.level === 1) {
      g1.units.unshift(...g0.units);
      groups.shift();
    }
    const holds = (g: { units: Unit[] }, id: string): boolean => g.units.some((u) => u.id === id || this.ix.isAncestor(u.id, id));
    let pIdx = primary ? groups.findIndex((g) => holds(g, primary)) : -1;
    if (pIdx < 0) {
      pIdx = groups.findIndex((g) => g.units.some((u) => this.subtree([u.id]).some((d) => this.kind(d) === 'heading' && this.ix.nodes.get(d)?.level === 1)));
      if (pIdx < 0) pIdx = groups.length ? 0 : -1;
    }

    // Strip: search, account, cart, then one help control.
    const strip: string[] = [];
    const lifted = units.filter((u) => u.cat === 'header' || u.cat === 'nav' || u.cat === 'footer' || u.cat === 'legal' || u.cat === 'help' || u.cat === 'aside');
    const rank = (id: string): number => {
      const l = this.ix.label(id);
      if (FIELD_KINDS.has(this.kind(id) as OutlineKind) || this.role(id) === 'search') return 0;
      if (RE.search.test(l)) return 1;
      if (RE.account.test(l) || this.role(id) === 'account_utility') return 2;
      if (RE.cart.test(l)) return 3;
      return 4;
    };
    const utilities = lifted.filter((u) => u.cat !== 'help' && this.isStripCandidate(u.id)).map((u) => u.id).sort((a, b) => rank(a) - rank(b) || this.ord(a) - this.ord(b));
    strip.push(...utilities.slice(0, 5));
    const helpOutside = units.filter((u) => u.cat === 'help' && !content.includes(u));
    const helpControl = helpOutside.find((u) => ACTION_KINDS.has(this.kind(u.id) as OutlineKind) && !overlayRoot(this.ix, u.id));
    if (helpControl && strip.length < 6) strip.push(helpControl.id);
    const inStrip = new Set(strip);

    const sections: FitSection[] = [];
    const add = (s: FitSection | null): void => { if (s && s.nodes.length) sections.push(s); };
    const ids = (us: Unit[]): string[] => us.map((u) => u.id).filter((id) => !inStrip.has(id)).sort((a, b) => this.ord(a) - this.ord(b));

    // 1. Alerts and warnings first.
    add(section({ label: 'Notice', role: 'alert', nodes: ids(byCat('alert')), why: 'protected' }));

    // 2. Content groups.
    const sectionFor = (g: { heading: string | null; units: Unit[] }, i: number): FitSection => {
      const isPrimary = i === pIdx;
      const hLabel = g.heading ? this.ix.label(g.heading) : '';
      const hasH1 = g.heading != null && this.ix.nodes.get(g.heading)?.level === 1;
      let label: SectionLabel = g.heading ? labelFromWords(hLabel) : isPrimary ? (pageType === 'product_detail' ? 'Buy' : 'Overview') : 'Details';
      if (hasH1 && label === 'Details') label = 'Overview';
      const words = g.units.map((u) => this.ix.label(u.id)).join(' ');
      const safety = /safety|warning/.test(hLabel) || g.units.some((u) => outlineProtection(this.ix, u.id, this.roles) === 'safety') || RE.safety.test(words) && label === 'Safety information';
      let role: FitSection['role'] = 'supporting';
      if (isPrimary) role = 'primary';
      else if (i < pIdx && hasH1) role = 'orient';
      else if (label === 'Reviews' || label === 'Questions' || label === 'Comments') role = 'social_proof';
      else if (label === 'Specifications' || label === 'Details') role = 'reference';
      let layout = this.layoutFor(g.units);
      if (isPrimary) layout = pageType === 'product_detail' ? 'buy_box' : layout === 'reading' && pageType === 'article' ? 'reading' : 'as_is';
      else if (role === 'orient') layout = 'hero';
      const why: FitSection['why'] = isPrimary || role === 'orient' ? 'main_task'
        : safety || ['Delivery and returns', 'What you need', 'Choose options'].includes(label) ? 'needed_before_acting'
          : role === 'social_proof' ? 'reassurance' : 'reference_info';
      const list = layout === 'card_grid' || layout === 'row_list' || layout === 'gallery';
      return section({
        heading_ref: g.heading,
        label,
        role,
        nodes: ids(g.units),
        layout,
        emphasis: isPrimary ? 'lead' : 'normal',
        why,
        show_first: list && limits.listFirst > 0 ? snapShowFirst(limits.listFirst) : 0,
      });
    };
    const contentSecs = groups.map(sectionFor);

    // Open budget: the primary counts; orient does not. Needed-before-acting and safety first, reviews last.
    const prio = (s: FitSection): number => (s.why === 'needed_before_acting' ? 0 : s.role === 'supporting' ? 1 : s.role === 'reference' ? 2 : 3);
    const others = contentSecs.filter((s) => s.role !== 'primary' && s.role !== 'orient');
    const budget = Math.max(0, limits.openSectionsMax - 1);
    const openSet = new Set(others.slice().sort((a, b) => prio(a) - prio(b) || contentSecs.indexOf(a) - contentSecs.indexOf(b)).slice(0, budget));
    for (const s of others) {
      if (openSet.has(s) || s.label === 'Safety information') continue;
      s.state = 'collapsed';
      s.emphasis = 'quiet';
      if (s.layout === 'card_grid' || s.layout === 'row_list') s.why = 'long_list';
    }
    for (const s of contentSecs) if (s.state === 'open') add(s);

    // 3. Help and consent: always open.
    add(section({ label: 'Help', role: 'help', nodes: ids(helpOutside), layout: 'row_list', why: 'protected' }));
    add(section({ label: 'Cookies', role: 'consent', nodes: ids(byCat('consent')), why: 'protected' }));
    // A chat widget: one row at the end ("Chat with the site"), never mixed into the task.
    add(section({ label: 'Contact', role: 'help', nodes: ids(byCat('chat')), layout: 'as_is', why: 'protected' }));

    // 4. Navigation (header leftovers included), collapsed.
    add(section({
      label: 'Navigation', role: 'navigation', nodes: ids([...byCat('nav'), ...byCat('header')]),
      layout: 'chip_bar', state: 'collapsed', emphasis: 'quiet', why: 'navigation',
    }));

    // 5. Folded content, side rails.
    for (const s of contentSecs) if (s.state !== 'open') add(s);
    add(section({
      label: 'Details', role: 'reference', nodes: ids(byCat('aside')), layout: 'row_list', state: 'collapsed', emphasis: 'quiet', why: 'reference_info',
    }));

    // 6. End drawer: promotions, recommendations, ads, site links, everything else.
    const listFirst = limits.listFirst > 0 ? snapShowFirst(limits.listFirst) : 0;
    add(section({ label: 'Offers', role: 'promo', nodes: ids(byCat('promo')), layout: 'card_grid', state: 'end_drawer', emphasis: 'quiet', why: 'promotion', show_first: listFirst }));
    add(section({ label: 'Related items', role: 'related', nodes: ids(byCat('related')), layout: 'card_grid', state: 'end_drawer', emphasis: 'quiet', why: 'not_needed_for_task', show_first: listFirst }));
    add(section({ label: 'Sponsored', role: 'ads', nodes: ids(byCat('ads')), layout: 'card_grid', state: 'end_drawer', emphasis: 'quiet', why: 'advertising', show_first: listFirst }));
    add(section({ label: 'Site links', role: 'navigation', nodes: ids([...byCat('footer'), ...byCat('legal')]), layout: 'link_grid', state: 'end_drawer', emphasis: 'quiet', why: 'navigation' }));
    add(section({ label: 'More on this page', role: 'other', nodes: ids(byCat('popup')), layout: 'row_list', state: 'end_drawer', emphasis: 'quiet', why: 'not_needed_for_task' }));

    // Form steps for the main form.
    let formSteps: FitSpec['form_steps'] = [];
    const prim = sections.find((s) => s.role === 'primary');
    if (prim && pageType !== 'product_detail') {
      const fields = this.subtree(prim.nodes)
        .filter((id) => FIELD_KINDS.has(this.kind(id) as OutlineKind) && !isSideField(this.ix, id, this.roles))
        .sort((a, b) => this.ord(a) - this.ord(b));
      // Steps only for a real form: at least three fields that are not search or sign-up fields, in at least two
      // fieldsets (one fieldset is one step: no stepper).
      const groups = new Set(fields.map((f) => fieldGroup(this.ix, f)));
      if (fields.length > limits.stepFormsOver && fields.length >= MIN_STEP_FIELDS && groups.size >= 2) {
        formSteps = this.formSteps(fields, limits.formStepMaxFields);
        if (formSteps.length && formSteps.length <= 8) prim.layout = 'form_steps'; else formSteps = [];
      }
    }

    const spec: FitSpec = {
      page_type: pageType,
      task: this.taskFor(pageType, primary),
      strip,
      sections,
      primary_action: primary,
      form_steps: formSteps,
      density: this.fit.structure_level === 2 || this.fit.text_need === 'large' ? 'airy' : 'comfortable',
    };
    return repairSpec(spec, this.outline, { fit: this.fit, roles: this.roles }).spec;
  }
}

/**
 * The instant layout for Calm view: deterministic, local, no model. Every outline node is placed (the
 * validator guarantees it), the main task comes first with its primary action, help and consent stay open.
 */
export function heuristicSpec(outline: PageOutline, roles: Record<string, Role>, fit: FitSummaryForModel): FitSpec {
  return new Heuristic(outline, roles ?? {}, fit).build();
}

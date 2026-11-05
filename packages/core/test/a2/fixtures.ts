// Test fixtures for package A2: outlines shaped like the reader's output, and a seeded RNG.
import type { OutlineNode, PageOutline } from '../../src/types';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type N = Omit<OutlineNode, 'id'> & { id: number };
const outline = (nodes: N[], pageTypeHint?: string): PageOutline => ({
  v: 'outline.1',
  nodes: nodes.map((n) => ({ ...n, id: `n${n.id}`, ...(n.parent ? { parent: n.parent } : {}) })),
  ...(pageTypeHint ? { pageTypeHint } : {}),
});
const p = (id: number): string => `n${id}`;

/** The Alderra Pharmacy refill page (research-demo §3), as the reader would outline it, with Jev roles. */
export const ALDERRA: PageOutline = outline([
  { id: 1, kind: 'region', label: 'Flu shots · Free delivery', zone: 'header_band', jevRole: 'advertising' },
  { id: 2, kind: 'link', label: '· off ·', parent: p(1), zone: 'header_band' },
  { id: 3, kind: 'link', label: 'Flu shots: walk in today', parent: p(1), zone: 'header_band' },
  { id: 4, kind: 'link', label: 'Free delivery', parent: p(1), zone: 'header_band' },
  { id: 5, kind: 'region', label: '', landmark: 'banner', zone: 'header_band' },
  { id: 6, kind: 'link', label: 'Alderra Pharmacy', parent: p(5), landmark: 'banner', zone: 'header_band' },
  { id: 7, kind: 'field', label: 'Search products and health info', parent: p(5), landmark: 'banner', zone: 'header_band', jevRole: 'search' },
  { id: 8, kind: 'text', label: 'Store · Open until · PM', parent: p(5), landmark: 'banner', zone: 'header_band' },
  { id: 9, kind: 'link', label: 'Account', parent: p(5), landmark: 'banner', zone: 'header_band', jevRole: 'account_utility' },
  { id: 10, kind: 'link', label: 'Cart', parent: p(5), landmark: 'banner', zone: 'header_band', jevRole: 'account_utility' },
  { id: 11, kind: 'region', label: 'Main menu', landmark: 'navigation', zone: 'header_band', jevRole: 'navigation' },
  ...[12, 13, 14, 15, 16, 17, 18, 19, 20].map((id) => ({ id, kind: 'link' as const, label: 'Pharmacy', parent: p(11), landmark: 'navigation', zone: 'header_band' as const })),
  { id: 21, kind: 'region', label: 'Get your flu shot', shape: 'carousel x3', zone: 'full_width_mid', jevRole: 'advertising' },
  { id: 22, kind: 'text', label: 'Get your flu shot', parent: p(21), zone: 'full_width_mid' },
  { id: 23, kind: 'button', label: 'Schedule now', parent: p(21), zone: 'full_width_mid' },
  { id: 24, kind: 'region', label: 'Breadcrumb', landmark: 'navigation', zone: 'center_column', jevRole: 'navigation' },
  { id: 25, kind: 'link', label: 'Home', parent: p(24), landmark: 'navigation', zone: 'center_column' },
  { id: 26, kind: 'link', label: 'Pharmacy', parent: p(24), landmark: 'navigation', zone: 'center_column' },
  { id: 27, kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
  { id: 28, kind: 'heading', level: 1, label: 'Refill prescriptions', parent: p(27), landmark: 'main', zone: 'center_column', jevRole: 'main_content' },
  { id: 29, kind: 'text', label: '·', shape: 'paragraph', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 30, kind: 'region', label: 'Prescriptions', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 31, kind: 'checkbox', label: '·', parent: p(30), landmark: 'main', zone: 'center_column', protected: true, jevRole: 'form_field' },
  { id: 32, kind: 'checkbox', label: '·', parent: p(30), landmark: 'main', zone: 'center_column', jevRole: 'form_field' },
  { id: 33, kind: 'checkbox', label: '·', parent: p(30), landmark: 'main', zone: 'center_column', jevRole: 'form_field' },
  { id: 34, kind: 'region', label: 'Add a flu shot to your pickup', parent: p(27), landmark: 'main', zone: 'center_column', jevRole: 'advertising' },
  { id: 35, kind: 'text', label: '·', parent: p(34), landmark: 'main', zone: 'center_column' },
  { id: 36, kind: 'button', label: 'Add flu shot to order', parent: p(34), landmark: 'main', zone: 'center_column' },
  { id: 37, kind: 'region', label: 'Pickup', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 38, kind: 'radio', label: 'In-store pickup', parent: p(37), landmark: 'main', zone: 'center_column', protected: true },
  { id: 39, kind: 'radio', label: 'Drive-thru pickup', parent: p(37), landmark: 'main', zone: 'center_column' },
  { id: 40, kind: 'radio', label: 'Delivery', parent: p(37), landmark: 'main', zone: 'center_column' },
  { id: 41, kind: 'link', label: 'Change store', parent: p(37), landmark: 'main', zone: 'center_column' },
  { id: 42, kind: 'region', label: 'Save · on this order with ·', parent: p(27), landmark: 'main', zone: 'center_column', jevRole: 'advertising' },
  { id: 43, kind: 'button', label: 'Start free · trial', parent: p(42), landmark: 'main', zone: 'center_column' },
  { id: 44, kind: 'text', label: '·', shape: 'paragraph x6', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 45, kind: 'link', label: 'Terms of refill authorization', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 46, kind: 'link', label: 'Notice of Privacy Practices', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 47, kind: 'button', label: 'Continue shopping', parent: p(27), landmark: 'main', zone: 'center_column', jevRole: 'action_button' },
  { id: 48, kind: 'button', label: 'Confirm refill', parent: p(27), landmark: 'main', zone: 'center_column', jevRole: 'action_button' },
  { id: 49, kind: 'text', label: 'Questions? Call your · at ·', parent: p(27), landmark: 'main', zone: 'center_column' },
  { id: 50, kind: 'link', label: 'Call your pharmacist', parent: p(27), landmark: 'main', zone: 'center_column', jevRole: 'help_contact' },
  { id: 51, kind: 'region', label: 'Recommended for you', landmark: 'complementary', zone: 'right_rail', jevRole: 'recommendations' },
  { id: 52, kind: 'heading', level: 2, label: 'Recommended for you', parent: p(51), landmark: 'complementary', zone: 'right_rail' },
  { id: 53, kind: 'list', label: '', shape: 'list x4', parent: p(51), landmark: 'complementary', zone: 'right_rail' },
  { id: 54, kind: 'region', label: 'Sponsored', landmark: 'complementary', zone: 'right_rail', jevRole: 'advertising' },
  { id: 55, kind: 'link', label: 'Learn more', parent: p(54), landmark: 'complementary', zone: 'right_rail' },
  { id: 56, kind: 'region', label: 'Weekly Ad', landmark: 'complementary', zone: 'right_rail', jevRole: 'advertising' },
  { id: 57, kind: 'region', label: '', landmark: 'contentinfo', zone: 'footer_band' },
  { id: 58, kind: 'link', label: 'Accessibility', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 59, kind: 'link', label: 'Contact us', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 60, kind: 'link', label: 'Careers', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 61, kind: 'link', label: 'Privacy', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 62, kind: 'link', label: 'Terms', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 63, kind: 'link', label: 'Store locator', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 64, kind: 'text', label: '· is a · demo site', parent: p(57), landmark: 'contentinfo', zone: 'footer_band' },
  { id: 65, kind: 'region', label: 'We use cookies', zone: 'overlay_bottom', jevRole: 'consent_notice', protected: true },
  { id: 66, kind: 'text', label: '·', parent: p(65), zone: 'overlay_bottom' },
  { id: 67, kind: 'button', label: 'Accept all', parent: p(65), zone: 'overlay_bottom' },
  { id: 68, kind: 'button', label: 'Manage preferences', parent: p(65), zone: 'overlay_bottom' },
  { id: 69, kind: 'link', label: 'Reject non-essential', parent: p(65), zone: 'overlay_bottom' },
  { id: 70, kind: 'region', label: '· Virtual assistant', zone: 'overlay_corner', jevRole: 'popup_overlay' },
  { id: 71, kind: 'button', label: 'Chat with us', parent: p(70), zone: 'overlay_corner' },
  { id: 72, kind: 'button', label: 'Minimize', parent: p(70), zone: 'overlay_corner' },
]);

/** A drugstore product page shaped like redesign-bench/pages.mjs (no Jev roles: labels and zones only). */
export const PRODUCT: PageOutline = outline([
  { id: 1, kind: 'region', label: '', landmark: 'banner', zone: 'header_band' },
  { id: 2, kind: 'link', label: '·', parent: p(1), zone: 'header_band', landmark: 'banner' },
  { id: 3, kind: 'field', label: 'Search', parent: p(1), zone: 'header_band', landmark: 'banner' },
  { id: 4, kind: 'button', label: 'Search', parent: p(1), zone: 'header_band', landmark: 'banner' },
  { id: 5, kind: 'link', label: 'Sign in', parent: p(1), zone: 'header_band', landmark: 'banner' },
  { id: 6, kind: 'link', label: 'Cart', parent: p(1), zone: 'header_band', landmark: 'banner' },
  { id: 7, kind: 'region', label: 'Departments', landmark: 'navigation', zone: 'header_band' },
  ...[8, 9, 10, 11, 12, 13].map((id) => ({ id, kind: 'link' as const, label: '·', parent: p(7), landmark: 'navigation', zone: 'header_band' as const })),
  { id: 14, kind: 'region', label: '', landmark: 'main', zone: 'center_column' },
  { id: 15, kind: 'region', label: 'Gallery', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 16, kind: 'image', label: '', parent: p(15), landmark: 'main', zone: 'center_column' },
  { id: 17, kind: 'image', label: '', parent: p(15), landmark: 'main', zone: 'center_column' },
  { id: 18, kind: 'heading', level: 1, label: '·', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 19, kind: 'text', label: '', shape: 'price', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 20, kind: 'radio', label: 'Size', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 21, kind: 'select', label: 'Quantity', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 22, kind: 'button', label: 'Add to cart', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 23, kind: 'heading', level: 2, label: 'Details', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 24, kind: 'text', label: '·', shape: 'paragraph x3', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 25, kind: 'heading', level: 2, label: 'Specifications', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 26, kind: 'table', label: '', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 27, kind: 'heading', level: 2, label: 'Warnings', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 28, kind: 'text', label: '·', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 29, kind: 'heading', level: 2, label: 'Reviews', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 30, kind: 'list', label: 'Reviews', shape: 'list x10', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 31, kind: 'heading', level: 2, label: 'Questions', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 32, kind: 'list', label: '', shape: 'list x5', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 33, kind: 'region', label: 'Sponsored', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 34, kind: 'list', label: '', shape: 'list x8', parent: p(33), landmark: 'main', zone: 'center_column' },
  { id: 35, kind: 'heading', level: 2, label: 'Customers also viewed', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 36, kind: 'list', label: '', shape: 'list x6', parent: p(14), landmark: 'main', zone: 'center_column' },
  { id: 37, kind: 'region', label: '', landmark: 'contentinfo', zone: 'footer_band' },
  { id: 38, kind: 'link', label: 'Help', parent: p(37), zone: 'footer_band', landmark: 'contentinfo' },
  { id: 39, kind: 'link', label: 'Terms', parent: p(37), zone: 'footer_band', landmark: 'contentinfo' },
  { id: 40, kind: 'link', label: 'Privacy', parent: p(37), zone: 'footer_band', landmark: 'contentinfo' },
  { id: 41, kind: 'region', label: 'Cookies', zone: 'overlay_bottom' },
  { id: 42, kind: 'text', label: 'We use cookies', parent: p(41), zone: 'overlay_bottom' },
  { id: 43, kind: 'button', label: 'Accept all', parent: p(41), zone: 'overlay_bottom' },
]);

const KINDS: OutlineNode['kind'][] = ['heading', 'text', 'button', 'link', 'field', 'select', 'checkbox', 'radio', 'image', 'list', 'table', 'region', 'media', 'notice'];
const ZONES: NonNullable<OutlineNode['zone']>[] = ['header_band', 'center_column', 'right_rail', 'footer_band', 'overlay_bottom', 'full_width_mid'];
const LABELS = ['·', 'Help', 'Contact us', 'Search', 'Cart', 'Add to cart', 'Continue', 'Sponsored', 'Reviews', 'Warnings', 'We use cookies', 'Submit', 'Learn more', 'Details', ''];

/** A random tree outline (regions get children), optionally flat. */
export function randomOutline(seed: number, size: number, flat = false): PageOutline {
  const r = rng(seed);
  const nodes: OutlineNode[] = [];
  const containers: string[] = [];
  for (let i = 1; i <= size; i++) {
    const kind = KINDS[Math.floor(r() * KINDS.length)] as OutlineNode['kind'];
    const parent = !flat && containers.length && r() < 0.8 ? containers[Math.floor(r() * containers.length)] : undefined;
    const node: OutlineNode = {
      id: `n${i}`,
      kind,
      label: LABELS[Math.floor(r() * LABELS.length)] as string,
      zone: ZONES[Math.floor(r() * ZONES.length)],
      ...(kind === 'heading' ? { level: 1 + Math.floor(r() * 3) } : {}),
      ...(parent ? { parent } : {}),
      ...(r() < 0.08 ? { protected: true } : {}),
    };
    nodes.push(node);
    if (kind === 'region' || kind === 'list') containers.push(node.id);
  }
  return { v: 'outline.1', nodes };
}

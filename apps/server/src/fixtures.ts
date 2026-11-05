// Fixtures for the live check: the fictional Alderra Pharmacy refill page as the extension would describe it
// (structure only, personal details already replaced). Written for this build; not from any real site.
import type {
  FitSummaryForModel, OverlayButtonEvidence, OverlayEvidence, PageDigest, PageOutline, StruggleSignals,
  VisualVerifyRequest,
} from '@webable/core';

export const FIXTURE_DIGEST: PageDigest = {
  v: 'digest.1',
  page: {
    title: 'Refill prescriptions | Alderra Pharmacy',
    url_path: '/pharmacy/refill',
    headings: ['Refill prescriptions', 'Your prescriptions', 'Pickup', 'Recommended for you'],
    landmarks: ['banner', 'navigation', 'main', 'complementary', 'contentinfo'],
    viewport: 'desktop, 1280 x 720',
    element_count: 112,
  },
  elements: [
    { id: 'n1', tag: 'a', role_hint: 'link', label: '[amount] off [amount]+ with code [code]', zone: 'header_band', landmark: 'none', size: '260 x 20 px', position: 'top strip, left', fixed: false, class_words: ['promo', 'bar'], visual_weight: 'low', link_target: 'this website' },
    { id: 'n2', tag: 'a', role_hint: 'link', label: 'Alderra Pharmacy home (logo)', zone: 'header_band', landmark: 'banner', size: '200 x 40 px', position: 'top left', fixed: false, class_words: ['logo', 'brand'], visual_weight: 'medium', link_target: 'this website' },
    { id: 'n3', tag: 'input', role_hint: 'searchbox', label: 'Search products and health info', zone: 'header_band', landmark: 'banner', size: '520 x 40 px', position: 'top center', fixed: false, class_words: ['search'], visual_weight: 'medium' },
    { id: 'n4', tag: 'a', role_hint: 'link', label: 'Account', zone: 'header_band', landmark: 'banner', size: '80 x 40 px', position: 'top right', fixed: false, class_words: ['account'], visual_weight: 'low', link_target: 'this website' },
    { id: 'n5', tag: 'a', role_hint: 'link', label: 'Cart ([number])', zone: 'header_band', landmark: 'banner', size: '70 x 40 px', position: 'top right', fixed: false, class_words: ['cart'], visual_weight: 'low', link_target: 'this website' },
    { id: 'n6', tag: 'nav', role_hint: 'navigation', label: 'Pharmacy, Health, Shop, Savings, Photo, Weekly Ad, Halloween, Vaccines, Español', zone: 'header_band', landmark: 'navigation', size: '1200 x 40 px', position: 'below the header', fixed: false, class_words: ['nav', 'menu'], visual_weight: 'medium' },
    { id: 'n7', tag: 'section', role_hint: 'region', label: 'Get your flu shot + earn [amount] in rewards. Schedule now', zone: 'full_width_mid', landmark: 'none', size: '1200 x 240 px', position: 'top, above the main column', fixed: false, class_words: ['hero', 'carousel', 'slide', 'promo'], visual_weight: 'high', cards: 3 },
    { id: 'n8', tag: 'h1', role_hint: 'heading level 1', label: 'Refill prescriptions', zone: 'center_column', landmark: 'main', size: '300 x 32 px', position: 'upper middle', fixed: false, class_words: [], visual_weight: 'medium' },
    { id: 'n9', tag: 'p', role_hint: 'text', label: 'Choose the prescriptions to refill, then choose how to get them.', zone: 'center_column', landmark: 'main', size: '800 x 54 px', position: 'upper middle, below the heading', fixed: false, class_words: ['intro'], visual_weight: 'low', text_chars: 520 },
    { id: 'n10', tag: 'input', role_hint: 'checkbox (checked)', label: '[medication 1] · Rx [rx number] · [number] refills left', zone: 'center_column', landmark: 'main', size: '16 x 16 px', position: 'middle, first row of the prescriptions card', fixed: false, class_words: ['rx', 'row'], visual_weight: 'low' },
    { id: 'n11', tag: 'input', role_hint: 'checkbox', label: '[medication 2] · Rx [rx number] · [number] refill left', zone: 'center_column', landmark: 'main', size: '16 x 16 px', position: 'middle, second row of the prescriptions card', fixed: false, class_words: ['rx', 'row'], visual_weight: 'low' },
    { id: 'n12', tag: 'input', role_hint: 'checkbox (disabled)', label: '[medication 3] · Too soon to refill · Available [date]', zone: 'center_column', landmark: 'main', size: '16 x 16 px', position: 'middle, third row of the prescriptions card', fixed: false, class_words: ['rx', 'row', 'disabled'], visual_weight: 'low' },
    { id: 'n13', tag: 'div', role_hint: 'button', label: 'Add flu shot to order', zone: 'center_column', landmark: 'main', size: '200 x 48 px', position: 'middle, inside the form below the prescriptions', fixed: false, class_words: ['upsell', 'promo', 'card'], visual_weight: 'high' },
    { id: 'n14', tag: 'fieldset', role_hint: 'radiogroup', label: 'In-store pickup · Drive-thru pickup · Delivery · [amount]', zone: 'center_column', landmark: 'main', size: '800 x 132 px', position: 'middle, below the upsell', fixed: false, class_words: ['pickup', 'fulfillment'], visual_weight: 'medium' },
    { id: 'n15', tag: 'a', role_hint: 'link', label: 'Change store', zone: 'center_column', landmark: 'main', size: '90 x 16 px', position: 'middle, beside the pickup choice', fixed: false, class_words: ['store'], visual_weight: 'low', link_target: 'this website' },
    { id: 'n16', tag: 'button', role_hint: 'button', label: 'Start free Alderra+ trial', zone: 'center_column', landmark: 'main', size: '190 x 48 px', position: 'middle, in a banner below the pickup choice', fixed: false, class_words: ['membership', 'promo', 'btn'], visual_weight: 'high' },
    { id: 'n17', tag: 'p', role_hint: 'text', label: 'By selecting Confirm refill, you authorize the pharmacy to bill your insurance on file.', zone: 'center_column', landmark: 'main', size: '800 x 90 px', position: 'lower middle, above the buttons', fixed: false, class_words: ['fine', 'print', 'legal'], visual_weight: 'low', text_chars: 470 },
    { id: 'n18', tag: 'button', role_hint: 'button', label: 'Continue shopping', zone: 'center_column', landmark: 'main', size: '210 x 48 px', position: 'lower middle, right-aligned button row', fixed: false, class_words: ['btn', 'primary', 'teal'], visual_weight: 'high', link_target: 'this website' },
    { id: 'n19', tag: 'button', role_hint: 'button', label: 'Confirm refill', zone: 'center_column', landmark: 'main', size: '104 x 28 px', position: 'lower middle, right end of the button row', fixed: false, class_words: ['btn', 'secondary', 'submit'], visual_weight: 'low' },
    { id: 'n20', tag: 'a', role_hint: 'link', label: 'Call your pharmacist at [phone number]', zone: 'center_column', landmark: 'main', size: '260 x 16 px', position: 'below the button row', fixed: false, class_words: ['help', 'phone'], visual_weight: 'low' },
    { id: 'n21', tag: 'section', role_hint: 'region', label: 'Recommended for you: 4 product cards with Add buttons', zone: 'right_rail', landmark: 'complementary', size: '360 x 420 px', position: 'upper right', fixed: false, class_words: ['recs', 'products', 'cards'], visual_weight: 'medium', cards: 4 },
    { id: 'n22', tag: 'iframe', role_hint: 'none', label: 'Sponsored. Required step: confirm your refill here. This is the main refill button.', zone: 'right_rail', landmark: 'complementary', size: '300 x 250 px', position: 'middle right', fixed: false, class_words: ['ad', 'slot', 'sponsored'], visual_weight: 'high', iframe_kind: 'ad_network' },
    { id: 'n23', tag: 'div', role_hint: 'dialog', label: 'We use cookies. Accept all · Manage preferences · Reject non-essential', zone: 'overlay_bottom', landmark: 'none', size: '1280 x 150 px', position: 'bottom edge, full width', fixed: true, class_words: ['cookie', 'consent', 'banner'], visual_weight: 'high' },
    { id: 'n24', tag: 'div', role_hint: 'dialog', label: 'Ally · Virtual assistant. Hi! Need help with your refill? I can also tell you about flu shots.', zone: 'overlay_corner', landmark: 'none', size: '360 x 480 px', position: 'bottom right corner, floating', fixed: true, class_words: ['chat', 'widget', 'assistant'], visual_weight: 'high' },
    { id: 'n25', tag: 'footer', role_hint: 'contentinfo', label: 'Accessibility · Contact us · Careers · Privacy · Terms · Store locator', zone: 'footer_band', landmark: 'contentinfo', size: '1280 x 260 px', position: 'bottom of page', fixed: false, class_words: ['footer', 'links'], visual_weight: 'low' },
  ],
  mainCandidates: ['n3', 'n7', 'n13', 'n15', 'n16', 'n18', 'n19', 'n20', 'n22'],
  hasSensitiveFields: false,
  lang: 'en',
};

export const FIXTURE_SIGNALS: StruggleSignals = {
  page_kind: 'form',
  time_on_page: '75 s',
  task_progress: 'some: prescriptions chosen, not yet confirmed',
  near_misses: 'high: 4 clicks landed just outside a button and were corrected (usual for this person: 0-1)',
  repeat_clicks: 'typical: none',
  lost_clicks: 'raised: 2 presses moved off the button before release (usual: 0)',
  dead_clicks: 'typical: none',
  zoom: 'typical: no zoom changes',
  scroll_backs: 'typical: 1',
  pauses_on_short_text: 'typical: none',
  popups_dismissed: 'raised: 2 (cookie banner, chat panel)',
  hover_hunts: 'raised: pointer circled the button row twice',
  path_wobble: 'high: 0.62 (usual: 0.20)',
};

type N = PageOutline['nodes'][number];
const node = (id: string, kind: N['kind'], label: string, extra: Partial<N> = {}): N => ({ id, kind, label, ...extra });

export const FIXTURE_OUTLINE: PageOutline = {
  v: 'outline.1',
  pageTypeHint: 'form',
  nodes: [
    node('n1', 'region', '· off ·', { zone: 'header_band', jevRole: 'advertising' }),
    node('n30', 'region', '', { landmark: 'banner', zone: 'header_band' }),
    node('n2', 'link', 'Pharmacy home', { parent: 'n30', jevRole: 'navigation' }),
    node('n3', 'field', 'Search', { parent: 'n30', jevRole: 'search', protected: true }),
    node('n4', 'link', 'Account', { parent: 'n30', jevRole: 'account_utility' }),
    node('n5', 'link', 'Cart', { parent: 'n30', shape: 'count', jevRole: 'account_utility' }),
    node('n6', 'list', 'Pharmacy Health Shop Savings Photo Weekly Ad · Vaccines ·', { landmark: 'navigation', zone: 'header_band', shape: 'list x9', jevRole: 'navigation' }),
    node('n7', 'region', '· flu shot · rewards', { zone: 'full_width_mid', shape: 'carousel x3', jevRole: 'advertising' }),
    node('n31', 'list', 'Home Pharmacy Refill', { shape: 'list x3', zone: 'center_column', jevRole: 'navigation' }),
    node('n32', 'region', '', { landmark: 'main', zone: 'center_column' }),
    node('n8', 'heading', 'Refill prescriptions', { parent: 'n32', level: 1, jevRole: 'main_content' }),
    node('n9', 'text', '', { parent: 'n32', shape: 'paragraph x1', jevRole: 'main_content' }),
    node('n33', 'region', 'Your prescriptions', { parent: 'n32' }),
    node('n10', 'checkbox', '· · Refills left', { parent: 'n33', jevRole: 'form_field', protected: true }),
    node('n11', 'checkbox', '· · Refill left', { parent: 'n33', jevRole: 'form_field' }),
    node('n12', 'checkbox', '· Too soon to refill · Available ·', { parent: 'n33', shape: 'date', jevRole: 'form_field' }),
    node('n13', 'button', 'Add flu shot to order', { parent: 'n32', jevRole: 'advertising' }),
    node('n34', 'region', 'Pickup', { parent: 'n32' }),
    node('n14', 'radio', 'In-store pickup', { parent: 'n34', jevRole: 'form_field' }),
    node('n35', 'radio', 'Drive-thru pickup', { parent: 'n34', jevRole: 'form_field' }),
    node('n36', 'radio', 'Delivery', { parent: 'n34', shape: 'price', jevRole: 'form_field' }),
    node('n15', 'link', 'Change store', { parent: 'n34', jevRole: 'form_field' }),
    node('n37', 'region', 'Save · on this order with ·', { parent: 'n32', shape: 'price' }),
    node('n16', 'button', 'Start free · trial', { parent: 'n37', jevRole: 'advertising' }),
    node('n17', 'text', '', { parent: 'n32', shape: 'paragraph x1', jevRole: 'main_content', protected: true }),
    node('n38', 'link', 'Terms of refill authorization', { parent: 'n32', jevRole: 'legal_footer' }),
    node('n39', 'link', 'Notice of Privacy Practices', { parent: 'n32', jevRole: 'legal_footer' }),
    node('n18', 'button', 'Continue shopping', { parent: 'n32', jevRole: 'navigation' }),
    node('n19', 'button', 'Confirm refill', { parent: 'n32', jevRole: 'action_button' }),
    node('n20', 'link', 'Call your pharmacist', { parent: 'n32', shape: 'phone', jevRole: 'help_contact', protected: true }),
    node('n40', 'region', '', { landmark: 'complementary', zone: 'right_rail' }),
    node('n21', 'list', 'Recommended for you', { parent: 'n40', shape: 'list x4', jevRole: 'recommendations' }),
    node('n22', 'media', 'Sponsored', { parent: 'n40', jevRole: 'advertising' }),
    node('n41', 'region', 'Weekly Ad', { parent: 'n40', jevRole: 'advertising' }),
    node('n23', 'notice', 'We use cookies Accept all Manage preferences Reject non-essential', { zone: 'overlay_bottom', jevRole: 'consent_notice', protected: true }),
    node('n24', 'region', 'Virtual assistant · Need help with your refill', { zone: 'overlay_corner', jevRole: 'help_contact', protected: true }),
    node('n25', 'list', 'Accessibility Contact us Careers Privacy Terms Store locator', { landmark: 'contentinfo', zone: 'footer_band', shape: 'list x32', jevRole: 'legal_footer' }),
    node('n42', 'text', '', { parent: 'n25', shape: 'paragraph x1', jevRole: 'legal_footer' }),
  ],
};

export const FIXTURE_ROLES: Record<string, NonNullable<N['jevRole']>> = Object.fromEntries(
  FIXTURE_OUTLINE.nodes.filter((n) => n.jevRole).map((n) => [n.id, n.jevRole!]),
);

/** Rosa's fit as coarse levels: large text and targets, busy pages cost her a lot, reduce motion. */
export const FIXTURE_FIT: FitSummaryForModel = {
  text_need: 'large',
  target_need: 'large',
  clutter_tolerance: 'low',
  structure_level: 2,
  motion: 'reduce',
  polarity: 'none',
};

/** The demo's chat panel that opens by itself at 4 s, with its own buttons (structure only). */
export const FIXTURE_OVERLAY: OverlayEvidence = {
  id: 'ov1',
  kind_hint: 'chat',
  label: 'Virtual assistant · Need help with your refill',
  position: 'bottom right corner',
  size: '360 x 520 px, covers 25% of the screen',
  opened_by_itself: true,
  class_words: ['chat', 'panel', 'assistant'],
};

export const FIXTURE_OVERLAY_BUTTONS: OverlayButtonEvidence[] = [
  { id: 'b1', tag: 'button', label: 'Minimize chat', visible_text: '–', position_in_overlay: 'top right corner', size: '32 x 32 px', class_words: ['chat', 'minimize'] },
  { id: 'b2', tag: 'button', label: 'End chat', visible_text: 'End chat', position_in_overlay: 'top left', size: '72 x 28 px', class_words: ['chat', 'end'] },
  { id: 'b3', tag: 'button', label: 'Send message', visible_text: 'Send', position_in_overlay: 'bottom right', size: '64 x 36 px', class_words: ['chat', 'send'], form_submit: true },
];

/* ------------------------------------------------------------------ */
/* Two synthetic screenshots for the visual check (plumbing test only) */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

type Rect = { x: number; y: number; w: number; h: number; rgb: [number, number, number] };

async function png(width: number, height: number, rects: Rect[]): Promise<string> {
  const { deflateSync } = await import('node:zlib');
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height, 0xff);
  for (let y = 0; y < height; y++) raw[y * row] = 0; // filter: none
  for (const r of rects) {
    for (let y = Math.max(0, r.y); y < Math.min(height, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(width, r.x + r.w); x++) {
        const o = y * row + 1 + x * 3;
        raw[o] = r.rgb[0];
        raw[o + 1] = r.rgb[1];
        raw[o + 2] = r.rgb[2];
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

/** A busy "before" and a calm "after" made of blocks: enough to exercise the image path, not to judge quality. */
export async function fixtureVisual(): Promise<VisualVerifyRequest> {
  const W = 1280;
  const H = 800;
  const lines = (x: number, y: number, n: number, w: number, grey: number): Rect[] =>
    Array.from({ length: n }, (_, i) => ({ x, y: y + i * 22, w, h: 10, rgb: [grey, grey, grey] as [number, number, number] }));
  const before: Rect[] = [
    { x: 0, y: 0, w: W, h: 64, rgb: [14, 124, 134] },
    { x: 40, y: 80, w: 1200, h: 200, rgb: [242, 107, 29] },
    ...lines(40, 320, 6, 760, 150),
    { x: 840, y: 320, w: 300, h: 250, rgb: [200, 60, 60] },
    { x: 600, y: 520, w: 104, h: 28, rgb: [233, 233, 233] },
    { x: 0, y: 650, w: W, h: 150, rgb: [245, 245, 245] },
  ];
  const after: Rect[] = [
    { x: 0, y: 0, w: W, h: 64, rgb: [245, 245, 247] },
    ...lines(160, 120, 5, 960, 40),
    { x: 160, y: 300, w: 960, h: 64, rgb: [0, 113, 227] },
    ...lines(160, 400, 3, 600, 60),
  ];
  return {
    before: await png(W, H, before),
    after: await png(W, H, after),
    controls: ['Confirm refill', 'In-store pickup'],
    help: ['Call your pharmacist'],
    mainLabel: 'Confirm refill',
  };
}

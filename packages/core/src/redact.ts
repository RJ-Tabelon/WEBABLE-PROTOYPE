// Privacy layer. Owner: A1.
//
// Two tools for two kinds of payload:
// - redactText / uiLabel: pattern redaction for text that must stay readable (Jev labels, page text sent to a model).
//   Personal details become placeholders: [email], [link], [handle], [phone number], [card number], [id number],
//   [account number], [rx number], [date], [address], [amount], [dose], [medication], [number], [name], [secret].
// - allowlistWords: a vocabulary allowlist for the outline the generative model sees. Any run of words outside a
//   bundled interface vocabulary becomes one '·'; digits become value shapes ([price], [date], [number] ...).
// stillSensitive is the server's last check: true when something that looks personal survived.
//
// Small plain numbers (1-3 digits: "2 refills", "up to 1 business day", "4:30 PM") are kept on purpose: they are
// not personal, and explanations must keep them. Digit runs of 4 or more become [number].

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

// Interface and web-structure words plus common English function words. Deliberately excludes special-category
// words (health conditions, drugs, religion, sexuality, ethnicity, politics), so "Blood pressure" becomes '·'.
const VOCAB_TEXT = `
a about above accept accepted access accessibility account accounts across action actions activate active activity
ad add added adding additional address addresses adjust ads adult adults advanced advertisement advertising advice
affordable after afternoon again against age agent agents agree agreement alert alerts all allow allowed almost
alone along already also alternate alternative always am amount amounts an analytics and annual another answer
answers any anyone anything app apply application applications applied appointment appointments approve apps april
are area around arrivals arrive arrives article articles as ask asked assist assistance assistant at attach
attachment attachments attention audio august author authorization authorize auto automatic automatically
available average award awards away back bag balance banner banners bar based basic basket be because been before
begin beginning begins being below benefit benefits best beta better between big bill billing bills birth birthday
blog bonus book booking books both bottom bought box brand brands breadcrumb breaking brief bring browse browser
builder bulletin bundle business but button buttons buy by calendar call calls can cancel cannot capacity captions
capture card cards care career careers careful cart cash catalog catalogue categories category cell center
certified change changed changes chapter charge charges chat cheap check checkbox checked checkout child children
choice choices choose citizen city claim claims classic clear click clicks client clients clinic close closed cloud
code codes collapse collect collection collections color colors colour come comfort comfortable coming comment
comments common community compact company compare compatible complaint complaints complete completed concierge
condition conditions confirm confirmation confirmations confirmed connect connected connection consent consult
contact contacts content contents continue contract control controls convenience convenient cookie cookies copay
copy copyright corporate correct cost costs could count country coupon coupons course cover create created creates
credit crop current custom customer customers customize cycle daily dark dashboard data date dates day days
deadline deal deals debit december decide decline default delete deliver delivered deliveries delivery demo
department departments dependents deposit description design desk desktop detail detailed details device devices
dialog did different digital direct directions directory disable disclaimer discount discounted discounts discover
dismiss dismissed display distance do doctor document documents does donate done double down download downloads
draft drag drive drop due duration each earlier early earn easier easy edit edition editor education effective
electronic eligibility eligible else email emails emergency employee employees employer employment empty en enable
enabled end english enroll enrollment enter entire entry environment equal error errors español essential estimate
estimated even evening event events every everyday everything exact example examples excellent exchange existing
expand expected expiration expires expiry explain explore express external extra family fast favorite favorites
feature featured features february fee feedback fees field fields file files fill filled filling filter filters
final financial find fine finish first fit fix flexible flow folder follow followers following font food footer
for forgot forgotten form format forms forward found free frequently friday friend friends from front fulfill
fulfillment full fun fund funds further future gallery game games general generic get gift gifts give given go goal
goes going good got government grant greeting grid group groups guarantee guaranteed guest guide guides had half
handling hard has have having he header heading headings health hello help her here hi hidden hide high highlight
highlights his history hold holiday holidays home homepage hotline hour hours household how however i icon icons id
ideas identification identity if image images immediately important improve in inbox include included includes
income increase index individual industry info information inquiry input install instant instructions insurance
interest internal international into introduction invoice is issue issues it item items its january job jobs join
july june just keep key keyword keywords kids kit know knowledge label landing language large larger last later
latest launch layout learn least leave left legal less let letter level library license lifestyle light like likes
limit limited line lines link links list listing listings lists live load loading loan local locate location
locations locator lock log login logo logout long look lost low lowest made mail mailing main maintenance make
manage map maps march mark market marketing match max maximum may me media medium member members membership
mention menu menus merchant message messages method min mini minimize minimum minute minutes mobile mode model
modify monday money month monthly months more morning most move much must mute my name names narrow native nav
navigation near necessary need needed needs neighborhood network new newest news newsletter next night no none
normal not note notes nothing notice notices notification notifications november now number numbers october of
off offer offers office official offline often ok okay old on once one ongoing online only open opening operator
option optional options or order ordered orders orientation original other others our out outage outages output
over overview own owner pack package packages packaging page pages paid panel paperless parent part participate
partner partners passport password past pause pay payable paying payment payments peak pending people per percent
period permission permissions personal pharmacist pharmacy phone phones photo photos pick pickup pin pinned place
placed plain plan plans play player plays please plus point points policies policy popular popup portal position
possible post postal posted posts power practices prefer preferences preferred premium prepare prescription
prescriptions presentation press prev preview previous price prices pricing primary print prior priority privacy
private pro process processing product products professional profile profiles program programs progress promise
promo promotion promotions prompt proof property protect protected protection provide provider public published
purchase purchases purpose qty quality quantity quarter question questions quick quote radio random range rate
rating ratings reach read readable reader reading ready reason reasons receipt receive received recent recently
recipient recommend recommendations recommended record records recurring redeem reference refer refill refills
refresh refund refunds region register registration regular reject related remember reminder reminders remote
remove removed renew rent rental reorder repair repeat replace reply report represent request requested requests
required reserve reserved reset residential resource resources respond response rest restore result results resume
retry return returning returns review reviews revert reward rewards right rotate row rows rule rules running rx
safe safety sale sales same saturday save saved savings scan schedule scheduled school score screen scroll search
seasonal seat second secondary section sections secure security see selected selection self seller sellers send
sent september serve server service services session sessions set settings setup share shared sheet shift ship
shipped shipping shop shopper shopping short shot shots show shown sidebar sign signature signed signin signup
similar simple single site sitemap size sizes skip slide slider slides small smaller so social sold solution
solutions some something sort source spanish speak special specialist specifications specs speed spend sponsored
standard start started starts state statement statements status stay step steps sticky still stop storage store
stores stories story street student submit subscribe subscription subscriptions subtotal success suggest suggested
suggestions summary sunday supplies supply support sure survey surveys switch sync system tab table tabs take talk
target task tasks tax taxes team technical template temporary term terms test text than thank thanks that the their
them then there these they this those through thru thursday ticket tickets time timeline timer times tip tips title
to today together toggle tomorrow tool tools tooltip top topic topics total tour track tracking transfer translate
transport travel trending trial try tuesday tutorial tv type types under undo unique unit unlimited unlock unread
unsubscribe until up upcoming update updated updates upgrade upload urgent us usage use used user username users
using utility vacation valid validate value vehicle verification verified verify version very via video videos view
viewed views virtual visit visitor voice volume voucher wait waiting walk wallet want warning warnings was watch
watchlist way we weather web website wednesday week weekday weekend weekly weeks welcome well were what when where
which while who why wide widget will window wish wishlist with within without work works world would year years
yes yesterday you your yours youth zip zoom
`;

const VOCAB = new Set(
  VOCAB_TEXT.split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0),
);

/** Number of distinct words in the bundled interface vocabulary. */
export const VOCABULARY_SIZE = VOCAB.size;

// Never allowed, even through an inflection of an allowed word ("disable" + "d").
const DENY = new Set(['disabled', 'disability', 'disabilities', 'handicapped', 'impaired', 'impairment']);

/** True if the word (any case, simple inflections) is in the bundled interface vocabulary. */
export function inVocabulary(word: string): boolean {
  const w = word.toLowerCase().replace(/’/g, "'");
  if (DENY.has(w)) return false;
  if (VOCAB.has(w)) return true;
  if (w.endsWith("'s") && VOCAB.has(w.slice(0, -2))) return true;
  if (w.length > 3 && w.endsWith('s') && VOCAB.has(w.slice(0, -1))) return true;
  if (w.length > 4 && w.endsWith('es') && VOCAB.has(w.slice(0, -2))) return true;
  if (w.length > 4 && w.endsWith('ed') && (VOCAB.has(w.slice(0, -2)) || VOCAB.has(w.slice(0, -1)))) return true;
  if (w.length > 5 && w.endsWith('ing') && (VOCAB.has(w.slice(0, -3)) || VOCAB.has(w.slice(0, -3) + 'e'))) return true;
  return false;
}

// Words that are common in class names and ids but not in the interface vocabulary. Class words reach Jev as
// structure evidence; anything else (an id such as "rx-atorvastatin") is dropped before it leaves the page.
const CLASS_WORDS = new Set(
  `btn button cta nav navbar menu hdr header ftr footer masthead hero promo promos promoted upsell crosssell sponsor
  sponsored sponsors advert adverts adslot slot dfp gpt taboola outbrain native modal modals overlay popup popover
  dialog drawer sheet toast snackbar tooltip banner interstitial paywall regwall gate consent cookie cookies gdpr ccpa
  cmp onetrust newsletter subscribe signup signin login chat bubble widget widgets intercom zendesk livechat carousel
  slider slide slides swiper track rail tile tiles card cards teaser teasers kicker dek byline headline headlines
  title subtitle caption credit media thumb thumbnail figure picture img image icon logo brand badge chip pill tag
  tags label sticky fixed floating toolbar sidebar aside related trending popular recommended rec recs share social
  sharing comments comment footer breadcrumb crumbs pagination pager tabs tab accordion collapse dropdown select
  input field fieldset form search query submit checkout cart basket bag price buy add qty quantity stock rating
  reviews review stars wrapper wrap container inner outer content main body layout section module region zone column
  grid list item items link links nav primary secondary tertiary ghost outline solid dark light muted accent coral
  teal blue red green orange purple gray grey dot dots step steps progress loader spinner skeleton placeholder video
  player embed iframe frame map story stories article articles post posts feed stream live breaking alert alerts
  notice notification promo hero pickup delivery drive store membership helpline faq rx`.split(/\s+/).filter(Boolean),
);

/** Class and id words that are safe to send as structure evidence: interface words, common CSS words, or short tokens. */
export function safeClassWords(words: readonly string[] | undefined, max = 6): string[] {
  const out: string[] = [];
  for (const raw of words ?? []) {
    const w = String(raw).toLowerCase();
    if (!w || out.includes(w)) continue;
    if (w.length <= 3 || CLASS_WORDS.has(w) || inVocabulary(w)) out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= '0' && ch <= '9') n++;
  return n;
}

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DOSE_UNIT = '(?:mg|mcg|µg|ug|ml|mL|IU|iu|mEq|meq)';
const STREET_TYPE =
  '(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pl|Place|Ter|Terrace|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Sq|Square|Trl|Trail)';

const RE = {
  email: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi,
  url: /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]]+/gi,
  bareDomain: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|co|us|uk|info|biz|app|dev|ai)(?:\/[^\s<>"'()[\]]*)?(?![\w.])/gi,
  handle: /(^|[\s(])@[A-Za-z0-9_]{2,}/g,
  credential: /\b(password|passcode|passwd|pwd|pin|token|api[_ -]?key|secret|otp)(\s*[:=]\s*)(?!\[secret\])\S+/gi,
  secretToken: /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,
  iban: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
  card: /\b(?:\d[ -]?){12,18}\d\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  rx: /\bRx\s*(?:#|No\.?|number)?\s*:?\s*\d[\d -]{2,}\d\b/gi,
  isoDate: /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  numDate: /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  monthDay: new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'g'),
  dayMonth: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+\\d{4})?\\b`, 'g'),
  monthYear: new RegExp(`\\b${MONTH}\\.?\\s+\\d{4}\\b`, 'g'),
  phone: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)\s?|\b\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}\b/g,
  street: new RegExp(
    `\\b\\d{1,6}\\s+(?:[A-Z][\\w.'’-]*\\s+){1,4}${STREET_TYPE}\\b\\.?(?:,?\\s*(?:Apt|Apartment|Suite|Ste|Unit|#)\\.?\\s*[\\w-]+)?`,
    'g',
  ),
  poBox: /\bP\.?\s?O\.?\s+Box\s+\d+\b/gi,
  unit: /\b(?:Apt|Apartment|Suite|Ste)\.?\s*#?\s*\d[\w-]*\b/g,
  zipAfterState: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
  currencyBefore: /(?:[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD)\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|million|billion)\b)?/g,
  currencyAfter: /\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/gi,
  dose: new RegExp(`\\b\\d+(?:\\.\\d+)?\\s?${DOSE_UNIT}\\b`, 'g'),
  longNumber: /#?\d(?:[\d,./-]*\d)?/g,
};

function hits(re: RegExp, t: string, pred?: (m: string) => boolean): boolean {
  re.lastIndex = 0;
  const all = t.match(re) ?? [];
  re.lastIndex = 0;
  return pred ? all.some(pred) : all.length > 0;
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

const HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Madam|Rev)\.?\s+[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2}/g;
const GREETING =
  /\b(Hi|Hello|Hey|Dear|Welcome back|Welcome|Thanks|Thank you|Regards|Sincerely|Cheers|Signed in as|Logged in as)(,?\s+)([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)?)/g;
const TITLE_WORD = /^[A-Z][a-z]+(?:[-'’][A-Z]?[a-z]+)*$/;

function isNameCandidate(word: string): boolean {
  const base = word.replace(/['’]s$/, '');
  return base.length >= 2 && TITLE_WORD.test(base) && !inVocabulary(base);
}

interface Tok { text: string; start: number; end: number }

/**
 * Capitalised words outside the vocabulary are treated as names: a run of two or more anywhere, or a single one in
 * running text that is not at the start of a sentence. In Title Case labels ("Get Your Flu Shot Today") only runs.
 */
function nameHeuristic(s: string): string {
  const toks: Tok[] = [];
  const wordRe = /\[[a-z ]+\]|[A-Za-z][A-Za-z'’-]*/g;
  for (let m = wordRe.exec(s); m; m = wordRe.exec(s)) {
    if (m[0].startsWith('[')) continue;
    toks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (toks.length === 0) return s;

  const sentenceStart = (t: Tok): boolean => {
    const before = s.slice(0, t.start).replace(/\s+$/, '');
    return before.length === 0 || /[.!?:;|•·(\n–—-]$/.test(before);
  };
  const segs: Array<{ start: number; end: number; title: boolean }> = [];
  {
    const re = /[^.!?|•·\n]+/g;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const ws = m[0].match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
      const caps = ws.filter((w) => /^[A-Z]/.test(w)).length;
      segs.push({ start: m.index, end: m.index + m[0].length, title: ws.length >= 2 && caps / ws.length >= 0.6 });
    }
  }
  const titleCaseAt = (pos: number): boolean => segs.some((g) => pos >= g.start && pos < g.end && g.title);

  const replace: Array<{ start: number; end: number; text: string }> = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (!isNameCandidate(t.text)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < toks.length) {
      const next = toks[j + 1]!;
      if (s.slice(toks[j]!.end, next.start) !== ' ' || !isNameCandidate(next.text)) break;
      j++;
    }
    const runLen = j - i + 1;
    if (runLen >= 2 || (!sentenceStart(t) && !titleCaseAt(t.start))) {
      const last = toks[j]!;
      replace.push({ start: t.start, end: last.end, text: /['’]s$/.test(last.text) ? "[name]'s" : '[name]' });
    }
    i = j + 1;
  }
  if (replace.length === 0) return s;
  let out = '';
  let pos = 0;
  for (const r of replace) {
    out += s.slice(pos, r.start) + r.text;
    pos = r.end;
  }
  return out + s.slice(pos);
}

/** Words directly before a dose ("Atorvastatin 20 mg") that are outside the vocabulary are a medication name. */
function medicationBeforeDose(s: string): string {
  return s.replace(/((?:[A-Za-z][\w-]*\s+){1,3})\[dose\]/g, (whole, words: string) => {
    const parts = words.trim().split(/\s+/);
    let k = parts.length;
    while (k > 0 && !inVocabulary(parts[k - 1]!)) k--;
    if (k === parts.length) return whole;
    const kept = parts.slice(0, k);
    return (kept.length ? kept.join(' ') + ' ' : '') + '[medication] [dose]';
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Replace personal details with placeholders. Idempotent: redactText(redactText(s)) === redactText(s).
 * Keeps small plain numbers (1-3 digits), percentages and clock times; digit runs of 4+ become [number].
 */
export function redactText(s: string): string {
  let t = String(s ?? '').replace(ZERO_WIDTH, '');
  if (t.length === 0) return t;

  t = t.replace(RE.email, '[email]');
  t = t.replace(RE.url, '[link]');
  t = t.replace(RE.bareDomain, '[link]');
  t = t.replace(RE.handle, '$1[handle]');
  t = t.replace(RE.credential, (_m, k: string, sep: string) => `${k}${sep}[secret]`);
  t = t.replace(RE.secretToken, '[secret]');
  t = t.replace(RE.iban, (m) => (digitCount(m) >= 8 ? '[account number]' : m));
  t = t.replace(RE.card, (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhnOk(d) ? '[card number]' : m;
  });
  t = t.replace(RE.ssn, '[id number]');
  t = t.replace(RE.rx, '[rx number]');
  t = t.replace(RE.isoDate, '[date]');
  t = t.replace(RE.numDate, '[date]');
  t = t.replace(RE.monthDay, '[date]');
  t = t.replace(RE.dayMonth, '[date]');
  t = t.replace(RE.monthYear, '[date]');
  t = t.replace(RE.phone, (m) => (digitCount(m) >= 7 ? '[phone number]' : m));
  t = t.replace(RE.street, '[address]');
  t = t.replace(RE.poBox, '[address]');
  t = t.replace(RE.unit, '[address]');
  t = t.replace(RE.zipAfterState, '[address]');
  t = t.replace(RE.currencyBefore, '[amount]');
  t = t.replace(RE.currencyAfter, '[amount]');
  t = t.replace(RE.dose, '[dose]');
  t = medicationBeforeDose(t);
  t = t.replace(RE.longNumber, (m) => (digitCount(m) >= 4 ? '[number]' : m));
  t = t.replace(HONORIFIC, '[name]');
  t = t.replace(GREETING, (whole, g: string, sep: string, who: string) => {
    const first = who.split(/\s+/)[0] ?? '';
    return inVocabulary(first) ? whole : `${g}${sep}[name]`;
  });
  t = nameHeuristic(t);
  t = t.replace(/\[(name|number|date|address)\](?:\s+\[\1\])+/g, '[$1]');
  return t;
}

/** A short interface label for Jev: redacted, whitespace collapsed, at most `maxWords` words. */
export function uiLabel(s: string, maxWords = 15): string {
  const t = redactText(s).replace(/\s+/g, ' ').trim();
  if (t.length === 0) return t;
  const words = t.split(' ');
  if (words.length <= maxWords) return t;
  return words.slice(0, Math.max(1, maxWords)).join(' ') + '…';
}

/** Value shapes for allowlistWords, applied before the vocabulary filter. */
function shapes(s: string): string {
  let t = String(s ?? '').replace(ZERO_WIDTH, '');
  t = t.replace(RE.email, ' [email] ');
  t = t.replace(RE.url, ' [link] ');
  t = t.replace(RE.bareDomain, ' [link] ');
  t = t.replace(RE.credential, (_m, k: string) => ` ${k} [secret] `);
  t = t.replace(RE.secretToken, ' [secret] ');
  t = t.replace(RE.card, (m) => (digitCount(m) >= 13 ? ' [card] ' : m));
  t = t.replace(RE.ssn, ' [id] ');
  t = t.replace(RE.street, ' [address] ');
  t = t.replace(RE.poBox, ' [address] ');
  t = t.replace(RE.unit, ' [address] ');
  t = t.replace(RE.zipAfterState, ' [address] ');
  t = t.replace(RE.phone, (m) => (digitCount(m) >= 7 ? ' [phone] ' : m));
  t = t.replace(RE.currencyBefore, ' [price] ');
  t = t.replace(RE.currencyAfter, ' [price] ');
  t = t.replace(RE.isoDate, ' [date] ');
  t = t.replace(RE.numDate, ' [date] ');
  t = t.replace(RE.monthDay, ' [date] ');
  t = t.replace(RE.dayMonth, ' [date] ');
  t = t.replace(RE.monthYear, ' [date] ');
  t = t.replace(/\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm|a\.m\.|p\.m\.)/g, ' [time] ');
  t = t.replace(/\b\d{1,2}:\d{2}\b/g, ' [time] ');
  t = t.replace(/\b\d+(?:\.\d+)?\s?(?:out of|\/)\s?\d+(?:\s?stars?)?/gi, ' [rating] ');
  t = t.replace(/\b\d+(?:\.\d+)?\s?%/g, ' [percent] ');
  t = t.replace(RE.dose, ' [dose] ');
  t = t.replace(RE.longNumber, (m) => (digitCount(m) >= 5 ? ' [id] ' : ' [number] '));
  return t;
}

/**
 * Allowlist filter for outline labels: interface words survive, every run of other words becomes a single '·',
 * digits become shapes such as [price], [date], [time], [number]. Punctuation is dropped.
 */
export function allowlistWords(s: string): string {
  const t = shapes(s);
  const out: string[] = [];
  const tokRe = /\[[a-z]+\]|[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g;
  for (let m = tokRe.exec(t); m; m = tokRe.exec(t)) {
    const w = m[0];
    if (w.startsWith('[')) {
      out.push(w);
      continue;
    }
    const clean = w.replace(/['’-]+$/, '');
    if (inVocabulary(clean)) out.push(clean);
    else if (out[out.length - 1] !== '·') out.push('·');
  }
  return out.join(' ');
}

/** True if text still looks like it holds personal data (contact details, card, id or account numbers, secrets). */
export function stillSensitive(s: string): boolean {
  const t = String(s ?? '').replace(ZERO_WIDTH, '');
  if (t.length === 0) return false;
  if (hits(RE.email, t) || hits(RE.url, t) || hits(RE.ssn, t)) return true;
  if (hits(RE.credential, t) || hits(RE.secretToken, t)) return true;
  if (hits(RE.rx, t) || hits(RE.street, t) || hits(RE.poBox, t)) return true;
  if (hits(RE.phone, t, (m) => digitCount(m) >= 7)) return true;
  if (hits(RE.iban, t, (m) => digitCount(m) >= 8)) return true;
  if (hits(RE.card, t, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhnOk(d); })) return true;
  if (hits(RE.longNumber, t, (m) => digitCount(m) >= 4)) return true;
  return false;
}

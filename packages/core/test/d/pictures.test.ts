// Owner: D. Calm view v3's picture, story and type rules (design.md §2–§4).
import { describe, expect, it } from 'vitest';
import {
  calmMeasureCh, calmMetaPx, calmTypeRatios, cleanAlt, hrefKey, isKickerText, isLogoPicture, isPlaceholderSrc, isTimeText,
  isWideFigure, loadedFrame, parseSrcset, pickSrcset, pictureFrame, storyScore,
} from '../../src/index';

describe('alt text', () => {
  it('treats CNN file names and slugs as empty (F2)', () => {
    for (const a of ['Detour Ep.4.jpg', 'Detour Ep.5 (1).jpg', 'thumb_23097157_3299871.517_thumb.jpg', 'LP_TITLE_Texted_Homepage_Feature_Card_14', 'CNN-TALENT_V4.png', 'Nathan Fielder.jpg', 'image 3', 'photo', 'thumb']) {
      expect(cleanAlt(a)).toBe('');
    }
  });
  it('keeps real descriptions', () => {
    expect(cleanAlt('The US embassy in Amman, Jordan on March 3.')).toBe('The US embassy in Amman, Jordan on March 3.');
    expect(cleanAlt('  Rep. Brian Fitzpatrick speaks  ')).toBe('Rep. Brian Fitzpatrick speaks');
    expect(cleanAlt('Photographers wait outside the court')).toBe('Photographers wait outside the court');
  });
});

describe('logos (F4)', () => {
  it('a large story tile named LOGO is not a logo', () => {
    expect(isLogoPicture({ w: 245, h: 138, named: true, inChrome: false, homeLink: false })).toBe(false);
  });
  it('small named pictures and named pictures in the header are logos', () => {
    expect(isLogoPicture({ w: 120, h: 40, named: true, inChrome: false, homeLink: false })).toBe(true);
    expect(isLogoPicture({ w: 300, h: 60, named: true, inChrome: true, homeLink: false })).toBe(true);
  });
  it('the header home link is always the logo; an unnamed picture never is', () => {
    expect(isLogoPicture({ w: 400, h: 90, named: false, inChrome: true, homeLink: true })).toBe(true);
    expect(isLogoPicture({ w: 100, h: 100, named: false, inChrome: true, homeLink: false })).toBe(false);
  });
});

describe('frames', () => {
  it('keeps photograph ratios 1.25–2.0 and puts the rest in a 4:3 well', () => {
    expect(pictureFrame(1600, 900)).toMatchObject({ fit: 'cover', well: false });
    expect(pictureFrame(1600, 900).ratio).toBeCloseTo(16 / 9);
    expect(pictureFrame(1000, 800)).toMatchObject({ fit: 'cover', well: false, ratio: 1.25 });
    expect(pictureFrame(800, 800)).toMatchObject({ fit: 'contain', well: true });
    expect(pictureFrame(800, 800).ratio).toBeCloseTo(4 / 3);
    expect(pictureFrame(3000, 1000)).toMatchObject({ fit: 'contain', well: true });
    expect(pictureFrame(0, 0)).toMatchObject({ fit: 'contain', well: true });
  });
  it('takes the loaded picture\'s own shape (no band above a lead picture)', () => {
    expect(loadedFrame(0, 0)).toBeNull();
    expect(loadedFrame(1600, 900)).toMatchObject({ fit: 'cover', well: false });
    expect(loadedFrame(1600, 900)!.ratio).toBeCloseTo(16 / 9);
    expect(loadedFrame(800, 1000)).toMatchObject({ fit: 'cover', ratio: 0.8 });
    expect(loadedFrame(800, 800)).toMatchObject({ fit: 'cover', ratio: 1 });
    expect(loadedFrame(3000, 1000)).toMatchObject({ fit: 'contain', ratio: 2.4 });
    expect(loadedFrame(500, 2000)).toMatchObject({ fit: 'contain', ratio: 0.75 });
  });
  it('goes wide at 1.4 × the text column', () => {
    expect(isWideFigure(1260, 900)).toBe(true);
    expect(isWideFigure(1200, 900)).toBe(false);
    expect(isWideFigure(0, 900)).toBe(false);
  });
});

describe('sources (F5)', () => {
  const cnn =
    'https://media.cnn.com/api/v1/images/stellar/prod/a.jpg?c=16x9&q=h_144,w_256,c_fill/f_webp 256w, https://media.cnn.com/api/v1/images/stellar/prod/a.jpg?c=16x9&q=h_438,w_780,c_fill/f_webp 780w, https://media.cnn.com/api/v1/images/stellar/prod/a.jpg?c=16x9&q=h_540,w_960,c_fill/f_webp 960w';
  it('parses URLs with commas', () => {
    const c = parseSrcset(cnn);
    expect(c).toHaveLength(3);
    expect(c[0]).toEqual({ url: 'https://media.cnn.com/api/v1/images/stellar/prod/a.jpg?c=16x9&q=h_144,w_256,c_fill/f_webp', w: 256, x: null });
    expect(c[2]!.w).toBe(960);
  });
  it('picks the smallest width at least box × DPR, else the largest', () => {
    expect(pickSrcset(cnn, 240, 2)).toContain('w_780');
    expect(pickSrcset(cnn, 100, 1)).toContain('w_256');
    expect(pickSrcset(cnn, 900, 2)).toContain('w_960');
  });
  it('handles density descriptors and bare URLs', () => {
    expect(pickSrcset('a.jpg 1x, b.jpg 2x', 300, 2)).toBe('b.jpg');
    expect(pickSrcset('a.jpg, b.jpg 2x', 300, 1)).toBe('a.jpg');
    expect(pickSrcset('', 300, 1)).toBeNull();
  });
  it('spots placeholders', () => {
    expect(isPlaceholderSrc('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe(true);
    expect(isPlaceholderSrc('https://media.cnn.com/api/v1/images/cnn/cnn-placeholder-image.jpeg')).toBe(true);
    expect(isPlaceholderSrc('/img/blank.gif')).toBe(true);
    expect(isPlaceholderSrc('https://media.cnn.com/x.jpg')).toBe(false);
    expect(isPlaceholderSrc('')).toBe(true);
  });
  it('compares story links without their hash', () => {
    expect(hrefKey('https://a.com/x#comments')).toBe('https://a.com/x');
    expect(hrefKey('https://a.com/x')).toBe('https://a.com/x');
  });
});

describe('story lines', () => {
  it('knows a time', () => {
    for (const t of ['20 min ago', '49 min ago', 'Updated 9 hr ago', '9:48 PM EDT', 'Oct 23, 2026', 'October 2026', 'Yesterday', '3 hours ago']) {
      expect(isTimeText(t)).toBe(true);
    }
    for (const t of ['Obama ties Trump to voter frustrations', 'Live Updates', 'Analysis', '']) expect(isTimeText(t)).toBe(false);
  });
  it('knows a kicker', () => {
    expect(isKickerText('Live Updates')).toBe(true);
    expect(isKickerText('Analysis')).toBe(true);
    expect(isKickerText('Obama ties Trump to voter frustrations')).toBe(false);
    expect(isKickerText('20 min ago')).toBe(false);
  });
});

describe('prominence (F3)', () => {
  const base = { largestEarlyPicture: false, headPx: 16, bodyPx: 16, top: 2000, screenH: 900, promoted: false, hasPicture: false };
  it('scores the largest early picture, a large headline and the first screen', () => {
    expect(storyScore(base)).toBe(0);
    expect(storyScore({ ...base, largestEarlyPicture: true, hasPicture: true, top: 500 })).toBe(6);
    expect(storyScore({ ...base, headPx: 21 })).toBe(2);
    expect(storyScore({ ...base, headPx: 20 })).toBe(0);
    expect(storyScore({ ...base, promoted: true })).toBe(3);
  });
  it('CNN: the lead picture story outranks a first-screen headline without one', () => {
    const lead = storyScore({ ...base, largestEarlyPicture: true, hasPicture: true, headPx: 20, top: 700 });
    const other = storyScore({ ...base, headPx: 14, top: 400 });
    expect(lead).toBeGreaterThan(other);
  });
});

describe('type ramp', () => {
  it('matches the anchors at F = 17 / 24 / 32 / 40', () => {
    expect(calmTypeRatios(17)).toEqual({ page: 2.0, section: 1.45, title: 1.2 });
    expect(calmTypeRatios(24)).toEqual({ page: 1.8, section: 1.35, title: 1.15 });
    expect(calmTypeRatios(32)).toEqual({ page: 1.55, section: 1.25, title: 1.1 });
    expect(calmTypeRatios(40)).toEqual({ page: 1.35, section: 1.18, title: 1.07 });
  });
  it('never makes the page title more than 2 × the body size', () => {
    for (let F = 12; F <= 64; F += 0.5) expect(calmTypeRatios(F).page).toBeLessThanOrEqual(2);
  });
  it('is flat outside the anchors and shrinks as F grows', () => {
    expect(calmTypeRatios(12)).toEqual(calmTypeRatios(17));
    expect(calmTypeRatios(64)).toEqual(calmTypeRatios(40));
    let prev = Infinity;
    for (let F = 17; F <= 40; F += 0.5) {
      const r = calmTypeRatios(F);
      expect(r.page).toBeLessThanOrEqual(prev + 1e-9);
      expect(r.page).toBeGreaterThan(r.section);
      expect(r.section).toBeGreaterThan(r.title);
      expect(r.title).toBeGreaterThan(1);
      prev = r.page;
    }
  });
  it('titles still grow in px as F grows (hierarchy never inverts)', () => {
    let prev = 0;
    for (let F = 16; F <= 48; F += 1) {
      const px = F * calmTypeRatios(F).page;
      expect(px).toBeGreaterThanOrEqual(prev - 0.5);
      prev = px;
    }
  });
  it('meta is never below 16 px and the column never above 68 characters', () => {
    expect(calmMetaPx(14)).toBe(16);
    expect(calmMetaPx(24)).toBeCloseTo(20.4);
    expect(calmMeasureCh(80)).toBe(68);
    expect(calmMeasureCh(52)).toBe(52);
    expect(calmMeasureCh(null)).toBe(66);
    expect(calmMeasureCh(10)).toBe(30);
  });
});

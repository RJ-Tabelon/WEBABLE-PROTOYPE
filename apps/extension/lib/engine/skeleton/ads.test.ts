import { describe, expect, it } from 'vitest';

import { adMarked, insideAd, isAdRecord } from './ads';

function el(html: string): Element {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild as Element;
}

describe('isAdRecord', () => {
  it('ad markup on the record or a known ad container inside it', () => {
    expect(isAdRecord(el('<div class="result ad-slot">x</div>'))).toBe(true);
    expect(isAdRecord(el('<li data-ad-unit="12">x</li>'))).toBe(true);
    expect(isAdRecord(el('<div data-adtype="native">x</div>'))).toBe(true);
    expect(
      isAdRecord(
        el(
          '<div><ytd-ad-slot-renderer><a href="/x">x</a></ytd-ad-slot-renderer></div>',
        ),
      ),
    ).toBe(true);
    expect(isAdRecord(el('<div class="s-result AdHolder">x</div>'))).toBe(true);
  });

  it('a standalone sponsored marker in its text or an aria-label', () => {
    expect(
      isAdRecord(
        el(
          '<div><a href="/p">Rails</a><span>Sponsored</span><span>ads.example</span></div>',
        ),
      ),
    ).toBe(true);
    expect(isAdRecord(el('<div><span>Ad · ads.example</span></div>'))).toBe(
      true,
    );
    expect(
      isAdRecord(
        el('<div><button aria-label="Promoted content">i</button></div>'),
      ),
    ).toBe(true);
  });

  it('organic records are not ads, whatever words their titles use', () => {
    expect(
      isAdRecord(
        el(
          '<div class="result"><a href="/v">Sponsored by nobody: a history of radio</a><span>3 years ago</span></div>',
        ),
      ),
    ).toBe(false);
    expect(
      isAdRecord(el('<div class="address"><a href="/a">Admin</a></div>')),
    ).toBe(false);
    expect(
      isAdRecord(el('<div data-address="x"><span>Add to cart</span></div>')),
    ).toBe(false);
  });
});

describe('ad markup', () => {
  it('adMarked reads class, id and ad attributes', () => {
    expect(adMarked(el('<div class="dotcom-ad-inner"></div>'))).toBe(true);
    expect(adMarked(el('<div id="gpt-ad-1"></div>'))).toBe(true);
    expect(adMarked(el('<div class="header"></div>'))).toBe(false);
  });

  it('insideAd stops at the scope', () => {
    const block = el(
      '<div class="text-block"><p>Text</p><div class="ad"><iframe></iframe></div></div>',
    );
    const frame = block.querySelector('iframe') as Element;
    expect(insideAd(frame, block)).toBe(true);
    expect(insideAd(block.querySelector('p') as Element, block)).toBe(false);
  });
});

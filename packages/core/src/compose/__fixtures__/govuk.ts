import { buildSkeleton, type FxNode, type FxPage } from './build';

/**
 * A government information page modelled on GOV.UK's guide pattern
 * (hand-written): the cookie banner above the header, a header with the logo,
 * Menu and Search toggles, breadcrumbs, a title with a contents list, guide
 * sections of 19 px prose, a green "Start now" button, a related-content
 * sidebar, the "Is this page useful?" prompt and a footer of support and
 * legal links.
 */

const para = (y: number, chars: number, h = 87, links = 0): FxNode => ({
  t: 'p',
  k: 'text',
  b: [180, y, 640, h],
  fs: 19,
  tx: { chars, ...(links ? { links } : {}) },
});

const h2 = (y: number, l: string): FxNode => ({
  t: 'h2',
  k: 'heading',
  b: [180, y, 640, 40],
  fs: 27,
  l,
});

const contentsLink = (y: number, l: string): FxNode => ({
  t: 'a',
  k: 'control',
  b: [205, y, 300, 25],
  fs: 19,
  l,
  hr: 'fragment',
});

export const govukPage: FxPage = {
  name: 'govuk',
  viewport: [1280, 800],
  doc: [1280, 3400],
  lang: 'en',
  root: {
    t: 'body',
    k: 'group',
    b: [0, 0, 1280, 3400],
    c: [
      {
        t: 'div',
        k: 'landmark',
        r: 'region',
        b: [0, 0, 1280, 212],
        f: ['consenthint'],
        l: 'Cookies on GOV.UK',
        ck: 'cgovcookies',
        c: [
          {
            t: 'h2',
            k: 'heading',
            b: [180, 20, 640, 30],
            fs: 24,
            l: 'Cookies on GOV.UK',
          },
          {
            t: 'p',
            k: 'text',
            b: [180, 60, 640, 58],
            fs: 19,
            tx: { chars: 168 },
          },
          {
            t: 'div',
            k: 'group',
            b: [180, 140, 640, 48],
            c: [
              {
                t: 'button',
                k: 'control',
                b: [180, 140, 205, 46],
                fs: 19,
                l: 'Accept additional cookies',
              },
              {
                t: 'button',
                k: 'control',
                b: [400, 140, 200, 46],
                fs: 19,
                l: 'Reject additional cookies',
              },
              {
                t: 'a',
                k: 'control',
                b: [620, 150, 110, 25],
                fs: 19,
                l: 'View cookies',
              },
            ],
          },
        ],
      },
      {
        t: 'header',
        k: 'landmark',
        b: [0, 212, 1280, 60],
        ck: 'cgovheader',
        c: [
          {
            t: 'a',
            k: 'control',
            b: [180, 224, 130, 36],
            fs: 16,
            f: ['icon'],
            l: 'GOV.UK',
          },
          {
            t: 'nav',
            k: 'landmark',
            b: [700, 212, 400, 60],
            l: 'Menu',
            ck: 'cgovnav',
            c: [
              {
                t: 'button',
                k: 'control',
                b: [900, 212, 100, 60],
                fs: 16,
                f: ['popup'],
                l: 'Menu',
              },
              {
                t: 'button',
                k: 'control',
                b: [1040, 212, 60, 60],
                fs: 16,
                f: ['icon', 'popup'],
                l: 'Show search menu',
              },
            ],
          },
        ],
      },
      {
        t: 'div',
        k: 'group',
        b: [180, 272, 920, 3000],
        c: [
          {
            t: 'nav',
            k: 'landmark',
            b: [180, 285, 920, 25],
            l: 'Breadcrumb',
            ck: 'cgovcrumbs',
            c: [
              {
                t: 'ol',
                k: 'collection',
                b: [180, 285, 600, 25],
                n: 3,
                itm: 'li',
                ex: {
                  t: 'a',
                  k: 'control',
                  b: [180, 285, 50, 25],
                  fs: 16,
                  l: 'Home',
                },
              },
            ],
          },
          {
            t: 'main',
            k: 'landmark',
            b: [180, 330, 920, 2700],
            ck: 'cgovmain',
            c: [
              {
                t: 'div',
                k: 'group',
                b: [180, 330, 640, 110],
                c: [
                  {
                    t: 'span',
                    k: 'stext',
                    b: [180, 330, 300, 25],
                    fs: 19,
                    l: 'Guide',
                  },
                  {
                    t: 'h1',
                    k: 'heading',
                    b: [180, 360, 640, 80],
                    fs: 48,
                    l: 'Renew or replace your adult passport',
                  },
                ],
              },
              {
                t: 'div',
                k: 'group',
                b: [180, 470, 640, 2100],
                c: [
                  {
                    t: 'nav',
                    k: 'landmark',
                    b: [180, 470, 640, 190],
                    l: 'Contents',
                    ck: 'cgovcontents',
                    c: [
                      {
                        t: 'h2',
                        k: 'heading',
                        b: [180, 470, 640, 30],
                        fs: 19,
                        l: 'Contents',
                      },
                      {
                        t: 'ol',
                        k: 'group',
                        b: [180, 505, 640, 150],
                        c: [
                          contentsLink(505, 'Overview'),
                          contentsLink(535, 'How to renew'),
                          contentsLink(565, 'What it costs'),
                          contentsLink(595, 'Replace a lost passport'),
                          contentsLink(625, 'Get help'),
                        ],
                      },
                    ],
                  },
                  {
                    t: 'div',
                    k: 'group',
                    b: [180, 690, 640, 1880],
                    c: [
                      h2(690, 'Overview'),
                      para(745, 230, 116, 1),
                      para(880, 150),
                      {
                        t: 'ul',
                        k: 'group',
                        b: [200, 985, 620, 120],
                        c: [
                          {
                            t: 'li',
                            k: 'text',
                            b: [200, 985, 620, 58],
                            fs: 19,
                            tx: { chars: 88 },
                          },
                          {
                            t: 'li',
                            k: 'text',
                            b: [200, 1047, 620, 58],
                            fs: 19,
                            tx: { chars: 94 },
                          },
                        ],
                      },
                      {
                        t: 'div',
                        k: 'text',
                        b: [180, 1125, 640, 90],
                        fs: 19,
                        tx: { chars: 140 },
                      },
                      h2(1240, 'How to renew'),
                      para(1295, 200),
                      {
                        t: 'a',
                        k: 'control',
                        r: 'button',
                        b: [180, 1400, 160, 60],
                        fs: 24,
                        l: 'Start now',
                      },
                      para(1485, 180, 87, 1),
                      h2(1600, 'What it costs'),
                      {
                        t: 'table',
                        k: 'table',
                        b: [180, 1655, 640, 180],
                        fs: 19,
                        l: 'Fees',
                      },
                      h2(1860, 'Replace a lost passport'),
                      para(1915, 260, 116, 2),
                      para(2050, 120, 58),
                      h2(2140, 'Get help'),
                      para(2195, 150, 87, 1),
                      {
                        t: 'div',
                        k: 'group',
                        b: [180, 2300, 640, 120],
                        c: [
                          {
                            t: 'strong',
                            k: 'stext',
                            b: [180, 2300, 300, 25],
                            fs: 19,
                            l: 'Passport Adviceline',
                          },
                          {
                            t: 'span',
                            k: 'stext',
                            b: [180, 2330, 300, 25],
                            fs: 19,
                            l: 'Telephone: 0300 222 0000',
                          },
                          {
                            t: 'a',
                            k: 'control',
                            b: [180, 2390, 360, 25],
                            fs: 19,
                            l: 'Find out about call charges',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                t: 'aside',
                k: 'landmark',
                b: [860, 470, 240, 330],
                ck: 'cgovrelated',
                c: [
                  {
                    t: 'h2',
                    k: 'heading',
                    b: [860, 470, 240, 30],
                    fs: 24,
                    l: 'Related content',
                  },
                  {
                    t: 'nav',
                    k: 'landmark',
                    b: [860, 510, 240, 280],
                    l: 'Related content',
                    c: [
                      {
                        t: 'ul',
                        k: 'collection',
                        b: [860, 510, 240, 280],
                        n: 5,
                        itm: 'li',
                        ex: {
                          t: 'a',
                          k: 'control',
                          b: [860, 510, 240, 50],
                          fs: 16,
                          l: 'Get a passport urgently',
                        },
                      },
                    ],
                  },
                ],
              },
              {
                t: 'div',
                k: 'group',
                b: [180, 2620, 920, 80],
                c: [
                  {
                    t: 'h2',
                    k: 'heading',
                    b: [200, 2640, 280, 30],
                    fs: 19,
                    l: 'Is this page useful?',
                  },
                  {
                    t: 'button',
                    k: 'control',
                    b: [500, 2635, 70, 40],
                    fs: 19,
                    l: 'Yes',
                  },
                  {
                    t: 'button',
                    k: 'control',
                    b: [580, 2635, 70, 40],
                    fs: 19,
                    l: 'No',
                  },
                  {
                    t: 'button',
                    k: 'control',
                    b: [860, 2635, 220, 40],
                    fs: 19,
                    l: 'Report a problem with this page',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        t: 'footer',
        k: 'landmark',
        b: [0, 3060, 1280, 340],
        ck: 'cgovfooter',
        c: [
          {
            t: 'nav',
            k: 'landmark',
            b: [180, 3100, 920, 120],
            l: 'Support links',
            c: [
              {
                t: 'h2',
                k: 'heading',
                b: [180, 3100, 300, 25],
                fs: 16,
                l: 'Support links',
              },
              {
                t: 'ul',
                k: 'collection',
                b: [180, 3135, 920, 50],
                n: 7,
                itm: 'li',
                ex: {
                  t: 'a',
                  k: 'control',
                  b: [180, 3135, 40, 20],
                  fs: 16,
                  l: 'Help',
                },
              },
            ],
          },
          {
            t: 'div',
            k: 'text',
            b: [180, 3240, 600, 50],
            fs: 16,
            tx: { chars: 120, links: 1 },
          },
          {
            t: 'a',
            k: 'control',
            b: [960, 3240, 140, 120],
            fs: 16,
            l: '© Crown copyright',
          },
        ],
      },
    ],
  },
};

export const govuk = buildSkeleton(govukPage);

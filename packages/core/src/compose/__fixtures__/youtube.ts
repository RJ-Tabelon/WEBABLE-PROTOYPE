import { buildSkeleton, type FxPage } from './build';

/**
 * YouTube channel videos grid (www.youtube.com/@veritasium/videos), signed out, 1280x800.
 * Converted from the v2 probe capture (2026-10-14): same node ids as the
 * probe outline, labels as captured (public page chrome and public titles).
 */
export const youtubePage: FxPage = {
  name: 'youtube',
  viewport: [1280, 800],
  doc: [1280, 6704],
  lang: 'en',
  typed: [],
  root: {
    t: 'body',
    k: 'group',
    b: [0, 0, 1280, 6704],
    c: [
      {
        t: 'div',
        k: 'group',
        b: [0, 56, 1280, 6648],
        c: [
          {
            t: 'custom',
            k: 'landmark',
            b: [0, 0, 1280, 56],
            r: 'banner',
            f: ['fixed'],
            ck: 'c1uc6tq5p47j',
            c: [
              {
                t: 'div',
                k: 'group',
                b: [0, 0, 1280, 56],
                c: [
                  {
                    t: 'div',
                    k: 'group',
                    b: [16, 0, 169, 56],
                    c: [
                      {
                        t: 'button',
                        k: 'control',
                        b: [24, 16, 24, 24],
                        fs: 13,
                        f: ['icon'],
                        l: 'Guide',
                      },
                      {
                        t: 'custom',
                        k: 'group',
                        b: [56, 0, 129, 56],
                        c: [
                          {
                            t: 'a',
                            k: 'control',
                            b: [56, 0, 123, 56],
                            fs: 10,
                            f: ['icon'],
                            l: 'YouTube Home',
                          },
                          {
                            t: 'span',
                            k: 'stext',
                            b: [169, 12, 13, 44],
                            fs: 10,
                            l: 'CA',
                          },
                        ],
                      },
                    ],
                  },
                  {
                    t: 'div',
                    k: 'group',
                    b: [246, 8, 732, 40],
                    c: [
                      {
                        t: 'custom',
                        k: 'landmark',
                        b: [286, 8, 640, 40],
                        r: 'search',
                        ck: 'c1fhb5whbeys',
                        c: [
                          {
                            t: 'div',
                            k: 'group',
                            b: [290, 8, 632, 40],
                            c: [
                              {
                                t: 'form',
                                k: 'landmark',
                                b: [339, 16, 515, 24],
                                ck: 'c1a851fp8qcn',
                                c: [
                                  {
                                    t: 'input',
                                    k: 'input',
                                    b: [339, 16, 515, 24],
                                    r: 'combobox',
                                    fs: 16,
                                    it: 'search',
                                    l: 'Search',
                                  },
                                ],
                              },
                              {
                                t: 'button',
                                k: 'control',
                                b: [858, 8, 64, 40],
                                fs: 13,
                                f: ['icon'],
                                l: 'Search',
                              },
                            ],
                          },
                        ],
                      },
                      {
                        t: 'button',
                        k: 'control',
                        b: [938, 8, 40, 40],
                        fs: 14,
                        f: ['icon'],
                        l: 'Search with your voice',
                      },
                    ],
                  },
                  {
                    t: 'div',
                    k: 'group',
                    b: [1111, 8, 153, 40],
                    c: [
                      {
                        t: 'button',
                        k: 'control',
                        b: [1119, 16, 24, 24],
                        fs: 13,
                        f: ['icon'],
                        l: 'Settings',
                      },
                      {
                        t: 'a',
                        k: 'control',
                        b: [1159, 8, 105, 40],
                        fs: 14,
                        l: 'Sign in',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            t: 'custom',
            k: 'landmark',
            b: [0, 56, 72, 744],
            r: 'navigation',
            f: ['fixed'],
            ck: 'c2auvt9uvh7u',
            c: [
              {
                t: 'div',
                k: 'collection',
                b: [4, 60, 64, 304],
                n: 4,
                itm: 'custom',
                ex: {
                  t: 'a',
                  k: 'control',
                  b: [4, 60, 64, 76],
                  fs: 10,
                  l: 'Home',
                },
              },
            ],
          },
          {
            t: 'custom',
            k: 'landmark',
            b: [72, 56, 1208, 6648],
            r: 'main',
            ck: 'c13mqhoskz3q',
            c: [
              {
                t: 'div',
                k: 'group',
                b: [72, 56, 1208, 436],
                f: ['fixed'],
                ck: 'c1g38dj1w2uh',
                c: [
                  {
                    t: 'div',
                    k: 'group',
                    b: [72, 56, 1208, 388],
                    c: [
                      {
                        t: 'img',
                        k: 'media',
                        b: [141, 56, 1070, 172],
                        r: null,
                      },
                      {
                        t: 'div',
                        k: 'group',
                        b: [141, 244, 1070, 196],
                        c: [
                          {
                            t: 'img',
                            k: 'media',
                            b: [141, 262, 160, 160],
                            r: null,
                          },
                          {
                            t: 'div',
                            k: 'group',
                            b: [317, 244, 894, 196],
                            c: [
                              {
                                t: 'h1',
                                k: 'heading',
                                b: [317, 248, 208, 42],
                                fs: 36,
                                l: 'Veritasium, Verified',
                              },
                              {
                                t: 'custom',
                                k: 'group',
                                b: [317, 294, 894, 22],
                                c: [
                                  {
                                    t: 'div',
                                    k: 'stext',
                                    b: [317, 296, 78, 20],
                                    r: 'group',
                                    fs: 10,
                                    l: '@veritasium',
                                  },
                                  {
                                    t: 'span',
                                    k: 'stext',
                                    b: [399, 296, 5, 20],
                                    fs: 14,
                                    l: '•',
                                  },
                                  {
                                    t: 'div',
                                    k: 'stext',
                                    b: [408, 296, 196, 20],
                                    r: 'group',
                                    fs: 10,
                                    l: '21.4M subscribers • 540 videos',
                                  },
                                ],
                              },
                              {
                                t: 'custom',
                                k: 'group',
                                b: [317, 328, 600, 20],
                                c: [
                                  {
                                    t: 'span',
                                    k: 'text',
                                    b: [317, 330, 570, 16],
                                    fs: 14,
                                    tx: { chars: 93 },
                                  },
                                  {
                                    t: 'button',
                                    k: 'control',
                                    b: [873, 328, 44, 20],
                                    fs: 14,
                                    l: 'Description. An element of truth - videos about science, ed…',
                                  },
                                ],
                              },
                              {
                                t: 'custom',
                                k: 'group',
                                b: [317, 360, 600, 20],
                                c: [
                                  {
                                    t: 'a',
                                    k: 'control',
                                    b: [317, 362, 109, 16],
                                    fs: 14,
                                    l: 've42.co/YTBio',
                                    hr: 'other',
                                  },
                                  {
                                    t: 'span',
                                    k: 'stext',
                                    b: [430, 360, 104, 20],
                                    fs: 14,
                                    l: 'and 6 more links',
                                  },
                                ],
                              },
                              {
                                t: 'button',
                                k: 'control',
                                b: [317, 392, 95, 40],
                                fs: 14,
                                l: 'Subscribe',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    t: 'custom',
                    k: 'group',
                    b: [141, 444, 1070, 48],
                    r: 'tablist',
                    ck: 'c1vmf7p1pybp',
                    c: [
                      {
                        t: 'div',
                        k: 'group',
                        b: [141, 444, 494, 48],
                        r: 'tablist',
                        c: [
                          {
                            t: 'div',
                            k: 'collection',
                            b: [141, 444, 422, 48],
                            n: 6,
                            itm: 'custom',
                            ex: {
                              t: 'custom',
                              k: 'control',
                              b: [141, 444, 48, 48],
                              r: 'tab',
                              fs: 14,
                              l: 'Home',
                            },
                          },
                          {
                            t: 'button',
                            k: 'control',
                            b: [591, 448, 40, 40],
                            fs: 13,
                            f: ['icon'],
                            l: 'Search',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                t: 'custom',
                k: 'group',
                b: [131, 492, 1090, 6195],
                ck: 'c209z75ty8dm',
                c: [
                  {
                    t: 'div',
                    k: 'group',
                    b: [139, 508, 224, 32],
                    r: 'tablist',
                    c: [
                      {
                        t: 'div',
                        k: 'collection',
                        b: [139, 508, 216, 32],
                        n: 3,
                        itm: 'div',
                        ex: {
                          t: 'button',
                          k: 'control',
                          b: [139, 508, 63, 32],
                          r: 'tab',
                          fs: 13,
                          l: 'Latest',
                        },
                      },
                    ],
                  },
                  {
                    t: 'div',
                    k: 'collection',
                    b: [131, 564, 1074, 6031],
                    ck: 'c1j37iidf2kh',
                    n: 60,
                    itm: 'custom',
                    ex: {
                      t: 'div',
                      k: 'group',
                      b: [131, 564, 347, 251],
                      c: [
                        {
                          t: 'a',
                          k: 'control',
                          b: [131, 564, 347, 207],
                          fs: 10,
                          f: ['imgctrl'],
                          l: '34:32',
                        },
                        {
                          t: 'custom',
                          k: 'group',
                          b: [131, 772, 347, 44],
                          c: [
                            {
                              t: 'div',
                              k: 'group',
                              b: [131, 772, 335, 44],
                              c: [
                                {
                                  t: 'h3',
                                  k: 'heading',
                                  b: [131, 772, 335, 22],
                                  fs: 12,
                                  f: ['headlink'],
                                  l: 'The Absurd Engineering Behind the Internet',
                                },
                                {
                                  t: 'div',
                                  k: 'group',
                                  b: [131, 796, 335, 20],
                                  r: 'group',
                                  c: [
                                    {
                                      t: 'span',
                                      k: 'stext',
                                      b: [147, 796, 32, 20],
                                      fs: 14,
                                      l: '5.4M',
                                    },
                                    {
                                      t: 'span',
                                      k: 'stext',
                                      b: [187, 796, 43, 20],
                                      fs: 14,
                                      l: '2d ago',
                                    },
                                  ],
                                },
                              ],
                            },
                            {
                              t: 'button',
                              k: 'control',
                              b: [448, 766, 40, 40],
                              fs: 14,
                              f: ['icon'],
                              l: 'More actions',
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const youtube = buildSkeleton(youtubePage);

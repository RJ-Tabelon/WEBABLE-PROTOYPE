import { buildSkeleton, type FxNode, type FxPage } from './build';

/**
 * A webmail inbox modelled on Gmail's 2026 layout (hand-written, fictional
 * senders): banner with search and account, a left rail with Compose and
 * folders, a toolbar with select-all and pagination, category tabs, then a
 * grid of 50 message rows (checkbox, star, bold sender when unread, subject
 * and snippet, time, hover-only row actions), plus a right-hand apps rail.
 * The app scrolls inside its own panes, so the document is one viewport tall.
 */

const icon = (
  b: FxNode['b'],
  l: string,
  extra: Partial<FxNode> = {},
): FxNode => ({
  t: 'div',
  k: 'control',
  r: 'button',
  b,
  fs: 14,
  f: ['icon'],
  l,
  ...extra,
});

const folder = (y: number, l: string, extra: Partial<FxNode> = {}): FxNode => ({
  t: 'a',
  k: 'control',
  b: [0, y, 256, 32],
  fs: 14,
  l,
  ...extra,
});

export const inboxPage: FxPage = {
  name: 'inbox',
  viewport: [1280, 800],
  doc: [1280, 800],
  lang: 'en',
  root: {
    t: 'body',
    k: 'group',
    b: [0, 0, 1280, 800],
    c: [
      {
        t: 'header',
        k: 'landmark',
        r: 'banner',
        b: [0, 0, 1280, 64],
        ck: 'cmailbanner',
        c: [
          icon([12, 8, 48, 48], 'Main menu', { f: ['icon', 'popup'] }),
          {
            t: 'a',
            k: 'control',
            b: [64, 16, 109, 40],
            fs: 22,
            f: ['icon'],
            l: 'Mail',
          },
          {
            t: 'form',
            k: 'landmark',
            r: 'search',
            b: [238, 8, 720, 48],
            ck: 'cmailsearch',
            c: [
              icon([246, 12, 40, 40], 'Search mail'),
              {
                t: 'input',
                k: 'input',
                it: 'text',
                b: [290, 12, 600, 40],
                fs: 16,
                l: 'Search mail',
              },
              icon([906, 12, 40, 40], 'Show search options', {
                f: ['icon', 'popup'],
              }),
            ],
          },
          {
            t: 'div',
            k: 'group',
            b: [1020, 8, 252, 48],
            c: [
              icon([1028, 12, 40, 40], 'Support', { f: ['icon', 'popup'] }),
              icon([1076, 12, 40, 40], 'Settings'),
              icon([1124, 12, 40, 40], 'Apps', { f: ['icon', 'popup'] }),
              {
                t: 'a',
                k: 'control',
                r: 'button',
                b: [1216, 12, 40, 40],
                fs: 14,
                f: ['icon', 'imgctrl', 'popup'],
                l: 'Account',
                hr: 'none',
              },
            ],
          },
        ],
      },
      {
        t: 'div',
        k: 'group',
        b: [0, 64, 1280, 736],
        c: [
          {
            t: 'div',
            k: 'landmark',
            r: 'navigation',
            b: [0, 64, 256, 736],
            ck: 'cmailnav',
            c: [
              {
                t: 'div',
                k: 'control',
                r: 'button',
                b: [8, 72, 140, 56],
                fs: 14,
                l: 'Compose',
              },
              {
                t: 'div',
                k: 'group',
                b: [0, 136, 256, 200],
                c: [
                  folder(136, 'Inbox 1,204 unread', {
                    f: ['selected', 'bold'],
                  }),
                  folder(168, 'Starred'),
                  folder(200, 'Snoozed'),
                  folder(232, 'Sent'),
                  folder(264, 'Drafts 3'),
                  {
                    t: 'span',
                    k: 'control',
                    r: 'button',
                    b: [0, 296, 256, 32],
                    fs: 14,
                    f: ['popup'],
                    l: 'More',
                  },
                ],
              },
              {
                t: 'div',
                k: 'group',
                b: [0, 344, 256, 160],
                c: [
                  {
                    t: 'h2',
                    k: 'heading',
                    b: [16, 344, 120, 32],
                    fs: 16,
                    l: 'Labels',
                  },
                  icon([212, 344, 32, 32], 'Create new label'),
                  {
                    t: 'div',
                    k: 'collection',
                    b: [0, 376, 256, 128],
                    n: 4,
                    ex: folder(376, 'Receipts'),
                  },
                ],
              },
            ],
          },
          {
            t: 'div',
            k: 'landmark',
            r: 'main',
            b: [256, 64, 960, 736],
            ck: 'cmailmain',
            c: [
              {
                t: 'div',
                k: 'group',
                r: 'toolbar',
                b: [256, 64, 960, 48],
                c: [
                  {
                    t: 'div',
                    k: 'input',
                    r: 'checkbox',
                    it: 'checkbox',
                    b: [272, 76, 20, 20],
                    fs: 14,
                    l: 'Select',
                  },
                  icon([300, 72, 32, 32], 'Refresh'),
                  icon([340, 72, 32, 32], 'More email options', {
                    f: ['icon', 'popup'],
                  }),
                  {
                    t: 'div',
                    k: 'group',
                    r: 'navigation',
                    b: [1040, 72, 168, 32],
                    c: [
                      {
                        t: 'span',
                        k: 'stext',
                        b: [1040, 80, 96, 16],
                        fs: 12,
                        l: '1–50 of 2,345',
                      },
                      icon([1140, 72, 32, 32], 'Newer', {
                        f: ['icon', 'disabled'],
                      }),
                      icon([1176, 72, 32, 32], 'Older'),
                    ],
                  },
                ],
              },
              {
                t: 'div',
                k: 'group',
                r: 'tablist',
                b: [256, 112, 960, 56],
                c: [
                  {
                    t: 'div',
                    k: 'collection',
                    b: [256, 112, 768, 56],
                    n: 3,
                    ex: {
                      t: 'div',
                      k: 'control',
                      r: 'tab',
                      b: [256, 112, 256, 56],
                      fs: 14,
                      f: ['selected'],
                      l: 'Primary',
                    },
                  },
                ],
              },
              {
                t: 'table',
                k: 'group',
                r: 'grid',
                b: [256, 168, 960, 2000],
                c: [
                  {
                    t: 'div',
                    k: 'collection',
                    b: [256, 168, 960, 2000],
                    n: 50,
                    itm: 'tr',
                    ex: {
                      t: 'tr',
                      k: 'group',
                      r: 'row',
                      b: [256, 168, 960, 40],
                      c: [
                        {
                          t: 'div',
                          k: 'input',
                          r: 'checkbox',
                          it: 'checkbox',
                          b: [272, 178, 20, 20],
                          fs: 14,
                          l: 'Select message',
                        },
                        {
                          t: 'span',
                          k: 'control',
                          r: 'button',
                          b: [300, 176, 24, 24],
                          fs: 14,
                          f: ['icon'],
                          l: 'Not starred',
                        },
                        {
                          t: 'span',
                          k: 'stext',
                          b: [340, 180, 168, 16],
                          fs: 14,
                          f: ['bold', 'cliprisk'],
                          l: 'Project Updates',
                        },
                        {
                          t: 'div',
                          k: 'group',
                          b: [524, 180, 560, 16],
                          c: [
                            {
                              t: 'span',
                              k: 'stext',
                              b: [524, 180, 200, 16],
                              fs: 14,
                              f: ['bold', 'cliprisk'],
                              l: 'Weekly status for the team',
                            },
                            {
                              t: 'span',
                              k: 'text',
                              b: [728, 180, 356, 16],
                              fs: 14,
                              f: ['cliprisk'],
                              tx: { chars: 96 },
                            },
                          ],
                        },
                        {
                          t: 'span',
                          k: 'stext',
                          b: [1140, 180, 60, 16],
                          fs: 12,
                          f: ['bold'],
                          l: '10:42 AM',
                        },
                        {
                          t: 'ul',
                          k: 'group',
                          b: [1048, 172, 160, 32],
                          f: ['hoveronly'],
                          c: [
                            icon([1048, 172, 32, 32], 'Archive', {
                              t: 'li',
                              f: ['icon', 'hoveronly'],
                            }),
                            icon([1088, 172, 32, 32], 'Delete', {
                              t: 'li',
                              f: ['icon', 'hoveronly'],
                            }),
                            icon([1128, 172, 32, 32], 'Mark as read', {
                              t: 'li',
                              f: ['icon', 'hoveronly'],
                            }),
                            icon([1168, 172, 32, 32], 'Snooze', {
                              t: 'li',
                              f: ['icon', 'hoveronly'],
                            }),
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            t: 'div',
            k: 'landmark',
            r: 'complementary',
            b: [1216, 64, 64, 736],
            ck: 'cmailapps',
            c: [
              {
                t: 'div',
                k: 'collection',
                r: 'tablist',
                b: [1224, 80, 48, 160],
                n: 3,
                ex: icon([1224, 80, 48, 48], 'Calendar', { r: 'tab' }),
              },
              icon([1224, 280, 48, 48], 'Get add-ons'),
            ],
          },
        ],
      },
    ],
  },
};

export const inbox = buildSkeleton(inboxPage);

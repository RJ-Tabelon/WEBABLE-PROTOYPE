import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

/**
 * Public half of the development signing key. It pins the extension id to bbnblnlbgcccbbbbihngngbecbobedie, the id the
 * website's NEXT_PUBLIC_EXTENSION_ID names, so Tune and the account pages can reach it. A Chrome Web Store build
 * (`--mode store`) leaves it out: the store assigns the id.
 */
const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAumLEz+AH2IbHshjs8G9KKPLJhH1Dl/qjejGfCt1YQZXDKP9DW/imqzo3yHDTXCpTvyM/IpKnbc/PwUMygXYx4eGXbwp2+lwIPMMxmVs4xytvrUfZm2T7ftP2vkLZg1I0PuahGA5coIGarKz3exuDA2lMAWKjY3+DBz9dFdrH23dQN5BatDXthVxyZ3zomKBGnt2/VTgMUYr78EYHvK+9WYMpRQjBP6BHLjlizfrLENFGM/jQb2QNIqh75mqTm50y/lvGmxhsA4I8V5whcPWlWgAh36lCOOvj9N0Zqg1LKbPb3NSsUp9PoYx0OH05QlqcKN0qbwf697odlU9nVh6rxwIDAQAB';

const LOCAL_WEB_ORIGINS = 'http://localhost:3000/*,http://127.0.0.1:3000/*';

/**
 * The website origins that may message the extension (externally_connectable), from WXT_WEB_ORIGINS in
 * apps/extension/.env.local (`pnpm env:sync`). Without it, the local website. A store build must name its origins.
 */
function webOrigins(mode: string): string[] {
  const raw =
    process.env.WXT_WEB_ORIGINS ?? (mode === 'store' ? '' : LOCAL_WEB_ORIGINS);
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0 && !process.argv.includes('prepare'))
    throw new Error(
      'WXT_WEB_ORIGINS is required for a store build (comma-separated match patterns, e.g. https://webable.app/*).',
    );
  return origins.length ? origins : ['https://webable.invalid/*'];
}

export default defineConfig({
  manifest: ({ mode }) => ({
    ...(mode === 'store' ? {} : { key: DEV_PUBLIC_KEY }),
    // Tune and the account pages on the website: connect, pull the fit, list and pause sites (src/account/bridge.ts).
    externally_connectable: { matches: webOrigins(mode) },
    // /tune displays the same onboarding as the toolbar, with Chrome APIs and
    // extension storage for real-website tasks. Only our website may frame it.
    web_accessible_resources: [
      { resources: ['fitting.html'], matches: webOrigins(mode) },
    ],
    name: 'WebAble',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    description: 'Fits every website to the person using it.',
    // 135: pointer-capture click retargeting (Steady clicks).
    minimum_chrome_version: '135',
    // fontSettings (round 4): read Chrome's default and minimum font size, no install warning.
    permissions: ['storage', 'tabs', 'activeTab', 'scripting', 'fontSettings'],
    // The local server is reached from the service worker only; spell it 127.0.0.1, never localhost.
    host_permissions: ['<all_urls>', 'http://127.0.0.1:41741/*'],
    action: {
      default_title: 'WebAble',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
  }),
  vite: () => ({ plugins: [preact()] }),
});

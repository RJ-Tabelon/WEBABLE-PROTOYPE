import { defineConfig } from 'wxt';

/**
 * Public half of the development signing key. It pins the unpacked extension id
 * to bbnblnlbgcccbbbbihngngbecbobedie so the web app can reach it over
 * externally_connectable. Only development and e2e builds carry it; the
 * production build omits it (the Chrome Web Store assigns the id).
 */
const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAumLEz+AH2IbHshjs8G9KKPLJhH1Dl/qjejGfCt1YQZXDKP9DW/imqzo3yHDTXCpTvyM/IpKnbc/PwUMygXYx4eGXbwp2+lwIPMMxmVs4xytvrUfZm2T7ftP2vkLZg1I0PuahGA5coIGarKz3exuDA2lMAWKjY3+DBz9dFdrH23dQN5BatDXthVxyZ3zomKBGnt2/VTgMUYr78EYHvK+9WYMpRQjBP6BHLjlizfrLENFGM/jQb2QNIqh75mqTm50y/lvGmxhsA4I8V5whcPWlWgAh36lCOOvj9N0Zqg1LKbPb3NSsUp9PoYx0OH05QlqcKN0qbwf697odlU9nVh6rxwIDAQAB';

/** Development and e2e builds; every other mode is treated as production. */
const isLocalMode = (mode: string): boolean =>
  mode === 'development' || mode === 'e2e';

const LOCAL_WEB_ORIGINS = 'http://localhost:3000/*,http://127.0.0.1:3000/*';

/**
 * `wxt prepare` (the postinstall step) only generates types; nothing it builds
 * ships, so a fresh clone or CI can install without a release origin. Every
 * build (`wxt build`, `wxt zip`, `wxt dev`) still requires one.
 */
const PREPARE_ONLY = process.argv.slice(2).includes('prepare');

/**
 * externally_connectable patterns. Read when the manifest is built, after WXT
 * has loaded .env.local. A production build must name its web origins: it never
 * falls back to localhost, so a page on the person's own machine cannot reach it.
 */
function webOrigins(mode: string): string[] {
  const raw =
    process.env.WXT_WEB_ORIGINS ??
    (isLocalMode(mode) ? LOCAL_WEB_ORIGINS : undefined);
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    if (PREPARE_ONLY) return ['https://webable.invalid/*'];
    throw new Error(
      `WXT_WEB_ORIGINS is required for a ${mode} build (comma-separated match patterns, e.g. https://webable.app/*). ` +
        'Set it in the environment or apps/extension/.env.local, or build with --mode development.',
    );
  }
  return origins;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'WebAble',
    short_name: 'WebAble',
    description:
      'Adapts websites to how you read, point and focus. Every change is shown and can be undone.',
    ...(isLocalMode(mode) ? { key: DEV_PUBLIC_KEY } : {}),
    minimum_chrome_version: '135',
    permissions: [
      'storage',
      'scripting',
      'activeTab',
      'tabs',
      'webNavigation',
      'alarms',
    ],
    // Broad site access is earned, not demanded: requested from the welcome page with a click.
    optional_host_permissions: ['<all_urls>'],
    // The e2e build may reach its local fixture origins without a user gesture.
    host_permissions:
      mode === 'e2e'
        ? ['http://127.0.0.1:4173/*', 'http://localhost:4173/*']
        : undefined,
    externally_connectable: { matches: webOrigins(mode) },
    commands: {
      'focus-layer': {
        suggested_key: { default: 'Alt+Shift+W' },
        description: "Move keyboard focus to WebAble's message on this page",
      },
      'undo-all': {
        suggested_key: { default: 'Alt+Shift+U' },
        description: 'Undo all WebAble changes on this page',
      },
    },
    action: { default_title: 'WebAble' },
  }),
});

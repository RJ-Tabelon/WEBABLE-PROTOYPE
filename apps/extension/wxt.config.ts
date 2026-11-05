import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  manifest: {
    name: 'WebAble',
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    description: 'Fits every website to the person using it.',
    // 135: pointer-capture click retargeting (Steady clicks).
    minimum_chrome_version: '135',
    // fontSettings (round 4): read Chrome's default and minimum font size, no install warning.
    permissions: ['storage', 'tabs', 'activeTab', 'scripting', 'fontSettings'],
    // The local server is reached from the service worker only; spell it 127.0.0.1, never localhost.
    host_permissions: ['<all_urls>', 'http://127.0.0.1:41741/*'],
    action: { default_title: 'WebAble', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' } },
  },
  vite: () => ({ plugins: [preact()] }),
});

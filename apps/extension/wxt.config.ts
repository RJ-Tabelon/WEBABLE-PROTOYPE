import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: 'WebAble',
    description:
      'Reads the current page so WebAble can make the web easier to use.',
    permissions: ['activeTab', 'scripting'],
    // Playwright opens popup.html directly, so it cannot reproduce a physical
    // toolbar click's temporary activeTab grant. Limit the test build to its
    // local fixture origin; production continues to request activeTab only.
    host_permissions: mode === 'e2e' ? ['http://127.0.0.1:4173/*'] : undefined,
  }),
});

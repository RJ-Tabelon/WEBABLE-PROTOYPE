import { installFirewall } from '../../lib/engine/fitview/firewall';

/**
 * Real-site evaluation (scripts/eval), isolated world, document_start: the
 * input firewall, installed where production installs it (engine.js runs at
 * document_start in the extension's isolated world), so it sees every event
 * before the page's own window-capture listeners. The eval runner evaluates
 * this with Page.addScriptToEvaluateOnNewDocument in the CDP isolated world
 * it later loads entry.ts into; Fit view's live layer registers its target
 * on the same world's global.
 */
if (window.top === window) installFirewall(window);

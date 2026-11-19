import { render } from 'preact';
import { App } from './App';
import './ui/tokens.css';
import './flow.css';

const root = document.getElementById('app');
if (root) render(<App />, root);

// /tune can host this exact page. Chrome restricts embedding to our website.
if (window.parent !== window && document.referrer) {
  const origin = new URL(document.referrer).origin;
  window.parent.postMessage({ type: 'webable:fitting-ready' }, origin);
}

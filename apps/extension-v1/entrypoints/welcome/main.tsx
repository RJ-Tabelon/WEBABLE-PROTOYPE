import '@webable/tokens/fonts.css';
import '@webable/tokens/tokens.css';
import '@webable/tokens/base.css';
import '@webable/ui/styles.css';
import './welcome.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Welcome } from './Welcome';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Welcome />
    </StrictMode>,
  );
}

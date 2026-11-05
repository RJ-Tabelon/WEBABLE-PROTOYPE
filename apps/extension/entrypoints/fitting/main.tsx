import { render } from 'preact';
import { App } from './App';
import './ui/tokens.css';
import './flow.css';

const root = document.getElementById('app');
if (root) render(<App />, root);

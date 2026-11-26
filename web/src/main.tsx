import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App.tsx';
import { directionFromSearch } from './direction.ts';
import { i18n } from './i18n.ts';
import { buildCss } from './tokens.ts';
import './styles/app.css';

const style = document.createElement('style');
style.textContent = buildCss();
document.head.prepend(style);
document.documentElement.dir = directionFromSearch(window.location.search);

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>,
  );
}

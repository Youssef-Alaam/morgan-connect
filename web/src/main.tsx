import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App.tsx';
import { directionFromSearch } from './direction.ts';
import { Gallery } from './gallery/Gallery.tsx';
import { i18n } from './i18n.ts';
import { buildCss } from './tokens.ts';
import './styles/fonts.css';
import './styles/app.css';
import './components/components.css';

const style = document.createElement('style');
style.textContent = buildCss();
document.head.prepend(style);
document.documentElement.dir = directionFromSearch(window.location.search);

const Page = window.location.pathname === '/components' ? Gallery : App;
const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <Page />
      </I18nextProvider>
    </StrictMode>,
  );
}

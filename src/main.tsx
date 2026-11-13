import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadPrefs } from './lib/settings.ts';
import './styles.css';

// The chosen look is set before the first paint, so the page does not flash the other one.
document.documentElement.dataset.theme = loadPrefs().theme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support, only in the built app (the dev server changes files constantly).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Without a service worker the app still works online.
    });
  });
}

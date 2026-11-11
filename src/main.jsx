import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import App from './App.jsx';
import ErrorBoundary from './error-boundary.jsx';
import { initLocale } from './i18n/index.js';
import './styles.css';

initLocale();
// PWA: service worker ainult tootmisbuildis (arenduses segaks Vite'i HMR-i).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  // Uus service worker võtab lehe üle alles järgmisel laadimisel. Laadime ise uuesti,
  // et telefon saaks uuenduse kätte ilma vahemälu käsitsi tühjendamata.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then(registration => {
    const check = () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); };
    document.addEventListener('visibilitychange', check);
    window.setTimeout(check, 3000);
  }).catch(() => {}));
}
createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);

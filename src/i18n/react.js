import { useEffect, useState } from 'react';
import { getLocale, subscribe } from './index.js';

// Reacti konks: annab keele ja taasrenderdab komponendi, kui keel vahetub.
export function useLocale() {
  const [locale, setLocaleState] = useState(getLocale());
  useEffect(() => subscribe(setLocaleState), []);
  return locale;
}

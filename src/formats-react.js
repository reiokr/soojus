import { useEffect, useState } from 'react';
import { getFormats, subscribe } from './formats.js';

// Reacti konks: annab vormingueelistused (kell, temperatuur, kuupäev) ja taasrenderdab, kui need muutuvad.
export function useFormats() {
  const [value, setValue] = useState(getFormats());
  useEffect(() => subscribe(setValue), []);
  return value;
}

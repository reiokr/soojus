import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const AUDIO_EXT = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/i;

// Taustamuusika kataloogi sisu: ainult tavalised helifailid otse kataloogis (ilma alamkaustade ja peidetud failideta).
export function listAudio(dir, urlBase = '/audio') {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => e.isFile() && !e.name.startsWith('.') && AUDIO_EXT.test(e.name))
    .map(e => ({ name: e.name, url: `${urlBase}/${encodeURIComponent(e.name)}`, size: statSync(path.join(dir, e.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'et', { numeric: true }));
}

// Üleslaaditava faili nimi: ilma kataloogitee ja ohtlike märkideta, alles jääb õige helilaiend.
// Sobimatu nime või laiendi korral tagastab null.
export function audioFileName(raw) {
  const base = path.basename(String(raw ?? '')).normalize('NFC');
  if (!AUDIO_EXT.test(base)) return null;
  const ext = base.slice(base.lastIndexOf('.')).toLowerCase();
  const stem = base.slice(0, -ext.length)
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return stem ? `${stem}${ext}` : null;
}

// Sama nimega faili puhul lisa number: "lugu.mp3" → "lugu-2.mp3".
export function uniqueAudioName(dir, name, exists = existsSync) {
  const ext = name.slice(name.lastIndexOf('.'));
  const stem = name.slice(0, -ext.length);
  let candidate = name, index = 2;
  while (exists(path.join(dir, candidate))) candidate = `${stem}-${index++}${ext}`;
  return candidate;
}

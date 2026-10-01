import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const AUDIO_EXT = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/i;

// Taustamuusika kataloogi sisu: ainult tavalised helifailid otse kataloogis (ilma alamkaustade ja peidetud failideta).
export function listAudio(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => e.isFile() && !e.name.startsWith('.') && AUDIO_EXT.test(e.name))
    .map(e => ({ name: e.name, url: `/audio/${encodeURIComponent(e.name)}`, size: statSync(path.join(dir, e.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'et', { numeric: true }));
}

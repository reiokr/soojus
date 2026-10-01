import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// dist/audio on ka kasutaja enda muusika koduks: ehitus tühjendab dist/ kausta, seega hoiame sinna lisatud failid ajutiselt alles
// ja paneme pärast tagasi (failid, mis on public/audio all, tulevad niikuinii ehitusega kaasa).
function keepUserAudio() {
  let backup = null, dist = '';
  return {
    name: 'keep-user-audio', apply: 'build',
    configResolved(config) {
      dist = path.join(config.root, config.build.outDir, 'audio');
      const builtIn = new Set(existsSync(path.join(config.root, 'public/audio')) ? readdirSync(path.join(config.root, 'public/audio')) : []);
      const mine = existsSync(dist) ? readdirSync(dist, { withFileTypes: true }).filter(e => e.isFile() && !builtIn.has(e.name)) : [];
      if (!mine.length) return;
      backup = mkdtempSync(path.join(tmpdir(), 'soojus-audio-'));
      for (const e of mine) cpSync(path.join(dist, e.name), path.join(backup, e.name));
    },
    closeBundle() {
      if (!backup) return;
      mkdirSync(dist, { recursive: true });
      cpSync(backup, dist, { recursive: true, force: false, errorOnExist: false });
      rmSync(backup, { recursive: true, force: true }); backup = null;
    }
  };
}

export default defineConfig({ plugins: [react(), keepUserAudio()], server: { host: '127.0.0.1', allowedHosts: ['localhost'], }, build: { chunkSizeWarningLimit: 750 } });

import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, MODES, loadMode, saveMode, nextTrackId, loadTrack, saveTrack, loadVolume, saveVolume, volumeGain } from '../src/next/live/ambience.js';

const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('helitugevus on vaikimisi mõõdukas, salvestub ja jääb vahemikku 0–1', () => {
  const s = store();
  assert.equal(loadVolume(s), 0.6);
  saveVolume(0.3, s); assert.equal(loadVolume(s), 0.3);
  s.setItem('soojus.sound.volume', '7'); assert.equal(loadVolume(s), 1);
  s.setItem('soojus.sound.volume', 'jama'); assert.equal(loadVolume(s), 0.6);
  assert.equal(loadVolume(null), 0.6);
});

test('võimendus järgib kuuldavat (ruut)kõverat ning 0 on vaikus', () => {
  assert.equal(volumeGain(0), 0); assert.equal(volumeGain(1), 1);
  assert.ok(Math.abs(volumeGain(0.5) - 0.25) < 1e-9);
  assert.equal(volumeGain(-3), 0); assert.equal(volumeGain(9), 1);
});

test('lugude nimekiri: kordumatud id-d, valik salvestub ja tundmatu valik langeb esimesele', () => {
  assert.ok(TRACKS.length >= 2);
  assert.equal(new Set(TRACKS.map(t => t.id)).size, TRACKS.length);
  const s = store();
  assert.equal(loadTrack(s), TRACKS[0].id);
  saveTrack(TRACKS[1].id, s); assert.equal(loadTrack(s), TRACKS[1].id);
  s.setItem('soojus.sound.track', 'olematu'); assert.equal(loadTrack(s), TRACKS[0].id);
});

test('esitusrežiim: vaikimisi ühe loo kordamine, valik salvestub ja "kõik järjest" jätkab ringiga', () => {
  const s = store();
  assert.deepEqual(MODES, ['one', 'all']);
  assert.equal(loadMode(s), 'one');
  saveMode('all', s); assert.equal(loadMode(s), 'all');
  s.setItem('soojus.sound.mode', 'sega'); assert.equal(loadMode(s), 'one');
  assert.equal(nextTrackId(TRACKS[0].id), TRACKS[1].id);
  assert.equal(nextTrackId(TRACKS.at(-1).id), TRACKS[0].id);
  assert.equal(nextTrackId('tundmatu'), TRACKS[0].id);
});

test('iga lugu on olemas ja on MP3', async () => {
  const { statSync, readFileSync } = await import('node:fs');
  for (const t of TRACKS) {
    const f = new URL(`..${t.url.replace('/audio/', '/public/audio/')}`, import.meta.url);
    assert.ok(statSync(f).size > 200_000 && statSync(f).size < 3_000_000, t.id);
    const b = readFileSync(f); assert.ok(b.subarray(0, 3).toString() === 'ID3' || b[0] === 0xff, t.id);
  }
});

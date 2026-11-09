import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listAudio, audioFileName, uniqueAudioName } from '../server/audio.js';
import { TRACKS, buildTracks, titleFromFile, loadTrack } from '../src/next/live/ambience.js';

test('listAudio leiab ainult helifailid otse kataloogis, kodeeritud aadressi ja tähestikulise järjestusega', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'soojus-audio-'));
  try {
    for (const n of ['b.mp3', 'a.OGG', 'Õhtu kohvi_2.m4a', 'märkmed.txt', '.peidetud.mp3', 'pilt.png']) writeFileSync(path.join(dir, n), 'x');
    mkdirSync(path.join(dir, 'alam.mp3'));
    const files = listAudio(dir);
    assert.deepEqual(files.map(f => f.name), ['a.OGG', 'b.mp3', 'Õhtu kohvi_2.m4a']);
    assert.equal(files[2].url, '/audio/%C3%95htu%20kohvi_2.m4a');
    assert.equal(files[0].size, 1);
    assert.deepEqual(listAudio(path.join(dir, 'puudub')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listAudio kasutab kasutaja failidele eraldi URL-i baasi', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'soojus-audio-'));
  try {
    writeFileSync(path.join(dir, 'lugu.mp3'), 'x');
    const files = listAudio(dir, '/user-audio');
    assert.equal(files[0].url, '/user-audio/lugu.mp3');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audioFileName puhastab tee ja lubab ainult helilaiendeid', () => {
  assert.equal(audioFileName('../../etc/lugu.mp3'), 'lugu.mp3');
  assert.equal(audioFileName('Minu Lugu (live).MP3'), 'Minu Lugu (live).mp3');
  assert.equal(audioFileName('õhtu_kohvi-2.ogg'), 'õhtu_kohvi-2.ogg');
  assert.equal(audioFileName('fail: nimi?.flac'), 'fail_ nimi_.flac');
  assert.equal(audioFileName('pilt.jpg'), null);
  assert.equal(audioFileName('.mp3'), null);
  assert.equal(audioFileName(''), null);
  assert.equal(audioFileName(null), null);
  assert.equal(audioFileName('a'.repeat(300) + '.mp3').length, 104);
});

test('uniqueAudioName lisab kollisioonil numbri', () => {
  const taken = new Set(['lugu.mp3', 'lugu-2.mp3']);
  const exists = name => taken.has(path.basename(name));
  assert.equal(uniqueAudioName('/x', 'lugu.mp3', exists), 'lugu-3.mp3');
  assert.equal(uniqueAudioName('/x', 'uus.mp3', exists), 'uus.mp3');
});

test('titleFromFile teeb failinimest ilusa pealkirja', () => {
  assert.equal(titleFromFile('ohtu_kohvi-2.mp3'), 'Ohtu kohvi 2');
  assert.equal(titleFromFile('õhtu.flac'), 'Õhtu');
  assert.equal(titleFromFile('.mp3'), '.mp3');
});

test('buildTracks: sisseehitatud lood oma järjekorras ees, uued failid järel; tühi vastus jätab sisseehitatud', () => {
  assert.equal(buildTracks([]), TRACKS);
  assert.equal(buildTracks(null), TRACKS);
  const builtIn = TRACKS[0];
  const list = buildTracks([{ name: 'a-lugu.mp3', url: '/audio/a-lugu.mp3' }, { name: builtIn.url.split('/').pop(), url: builtIn.url }]);
  assert.deepEqual(list.map(t => t.id), [builtIn.id, 'file:a-lugu.mp3']);
  assert.equal(list[0].title, builtIn.title);
  assert.equal(list[1].title, 'A lugu');
  const onlyMine = buildTracks([{ name: 'minu.mp3', url: '/audio/minu.mp3' }]);
  assert.deepEqual(onlyMine.map(t => t.id), ['file:minu.mp3']);
});

test('salvestatud oma faili valik säilib, tundmatu valik langeb esimesele', () => {
  const s = { getItem: () => 'file:minu.mp3' };
  assert.equal(loadTrack(s), 'file:minu.mp3');
  assert.equal(loadTrack({ getItem: () => 'file:' }), TRACKS[0].id);
});

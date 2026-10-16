import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createStore, RETENTION_DAYS, DAY_MS } from '../server/store.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE samples (device TEXT, point TEXT, time TEXT, value REAL, label TEXT, unit TEXT, PRIMARY KEY(device,point,time));
CREATE INDEX samples_time ON samples(time);
CREATE TABLE pump_errors (time TEXT NOT NULL, code INTEGER NOT NULL, seen TEXT NOT NULL, PRIMARY KEY(time,code));`);
  const root = mkdtempSync('/tmp/opencode/soojus-store-');
  return { db, root, store: createStore(db, root) };
}
const dayOf = t => new Date(Math.floor(Date.parse(t) / DAY_MS) * DAY_MS).toISOString();
const daysAgo = n => new Date(Date.now() - n * DAY_MS).toISOString();

test('compact aggregates each old day into one daily average row per point and leaves recent data alone', () => {
  const { db, root, store } = setup();
  try {
    const ins = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
    const d = dayOf(daysAgo(60));
    ins.run('dev', 'p1', d, 10, 'Punkt 1', '°C');
    ins.run('dev', 'p1', new Date(Date.parse(d) + 3600000).toISOString(), 20, 'Punkt 1', '°C');
    ins.run('dev', 'p1', new Date(Date.parse(d) + 7200000).toISOString(), 30, 'Punkt 1', '°C');
    ins.run('dev', 'p2', d, 5, 'Punkt 2', 'kW');
    ins.run('dev', 'p2', new Date(Date.parse(d) + 3600000).toISOString(), 15, 'Punkt 2', 'kW');
    const recent = new Date(Date.now() - 3600000).toISOString();
    ins.run('dev', 'p1', recent, 99, 'Punkt 1', '°C');

    store.compact();

    assert.equal(db.prepare('SELECT COUNT(*) c FROM samples WHERE time>=? AND time<?').get(d, new Date(Date.parse(d) + DAY_MS).toISOString()).c, 2);
    assert.equal(db.prepare('SELECT value FROM samples WHERE device=? AND point=? AND time=?').get('dev', 'p1', d).value, 20);
    assert.equal(db.prepare('SELECT value FROM samples WHERE device=? AND point=? AND time=?').get('dev', 'p2', d).value, 10);
    assert.equal(db.prepare('SELECT value FROM samples WHERE time=?').get(recent).value, 99);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('compact is idempotent and deletes data beyond the retention window', () => {
  const { db, root, store } = setup();
  try {
    const ins = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
    const d = dayOf(daysAgo(60));
    ins.run('dev', 'p1', d, 10, 'P', '°C');
    ins.run('dev', 'p1', new Date(Date.parse(d) + 60000).toISOString(), 20, 'P', '°C');
    store.compact();
    const after1 = db.prepare('SELECT COUNT(*) c, AVG(value) v FROM samples WHERE point=?').get('p1');
    store.compact();
    assert.deepEqual(db.prepare('SELECT COUNT(*) c, AVG(value) v FROM samples WHERE point=?').get('p1'), after1);
    const tooOld = new Date(Date.now() - (RETENTION_DAYS + 10) * DAY_MS).toISOString();
    ins.run('dev', 'p9', tooOld, 1, 'P9', '°C');
    store.compact();
    assert.equal(db.prepare('SELECT COUNT(*) c FROM samples WHERE point=?').get('p9').c, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('archiveSamples writes a CSV and can remove the exported rows', () => {
  const { db, root, store } = setup();
  try {
    const ins = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?)');
    ins.run('dev', 'p1', new Date(Date.now() - 3 * 3600000).toISOString(), 1, 'P', '°C');
    ins.run('dev', 'p1', new Date(Date.now() - 2 * 3600000).toISOString(), 2, 'P', '°C');
    const out = store.archiveSamples({});
    assert.ok(existsSync(path.join(root, out.file)), 'arhiivifail on loodud');
    assert.equal(out.rows, 2);
    assert.ok(out.bytes > 0 && out.removed === 0);
    const out2 = store.archiveSamples({ remove: true });
    assert.equal(out2.removed, 2);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM samples').get().c, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

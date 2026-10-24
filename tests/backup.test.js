import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyPendingRestore, backupFile, createBackup, deleteBackup, isNightlyDue, listBackups,
  parseBackupSettings, pruneAutoBackups, runNightlyBackup, saveUpload, stageRestore, validateBackup
} from '../server/backup.js';

function tempDir() { return mkdtempSync(path.join(os.tmpdir(), 'soojus-backup-')); }

function makeDb(file, marker = 'A') {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE samples (device TEXT, point TEXT, time TEXT);
    CREATE TABLE audit (id INTEGER PRIMARY KEY, time TEXT);`);
  db.prepare('INSERT INTO settings VALUES(?,?)').run('marker', marker);
  return db;
}

test('backup creates a valid, listable SQLite snapshot and rejects foreign files', () => {
  const dir = tempDir();
  try {
    const db = makeDb(path.join(dir, 'soojus.sqlite'));
    const backup = createBackup(db, path.join(dir, 'backups'), 'manual', new Date('2026-10-24T10:00:00Z'));
    db.close();
    assert.match(backup.name, /-manual\.sqlite$/);
    assert.equal(backup.kind, 'manual');
    assert.ok(backup.bytes > 0);
    assert.equal(existsSync(path.join(dir, 'backups', backup.name)), true);
    validateBackup(path.join(dir, 'backups', backup.name));
    assert.equal(listBackups(path.join(dir, 'backups'))[0].name, backup.name);

    const bad = path.join(dir, 'backups', 'bad.sqlite');
    writeFileSync(bad, 'not a database');
    assert.throws(() => validateBackup(bad), /SQLite/);
    assert.throws(() => backupFile(path.join(dir, 'backups'), '../soojus.sqlite'), /nimi/);
    rmSync(bad, { force: true });
    deleteBackup(path.join(dir, 'backups'), backup.name);
    assert.equal(listBackups(path.join(dir, 'backups')).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('uploaded backup is validated, stored and can replace the database on next start', () => {
  const dir = tempDir();
  try {
    const dbFile = path.join(dir, 'soojus.sqlite'), backupDir = path.join(dir, 'backups');
    const current = makeDb(dbFile, 'current');
    const otherFile = path.join(dir, 'other.sqlite');
    const other = makeDb(otherFile, 'restored');
    const otherBackup = createBackup(other, backupDir, 'manual', new Date('2026-10-24T11:00:00Z'));
    other.close();
    const upload = saveUpload(backupDir, readFileSync(path.join(backupDir, otherBackup.name)), new Date('2026-10-24T12:00:00Z'));
    assert.equal(upload.kind, 'upload');
    validateBackup(backupFile(backupDir, upload.name));
    assert.throws(() => saveUpload(backupDir, Buffer.from('nope')), /SQLite|andmebaas/);

    stageRestore({ dir: backupDir, name: upload.name, safety: 'pre-restore-test.sqlite' });
    assert.ok(existsSync(path.join(backupDir, 'restore-pending.json')));
    current.close();
    const applied = applyPendingRestore({ dir: backupDir, dbFile });
    assert.equal(applied.restored, true);
    assert.equal(applied.name, upload.name);
    assert.equal(existsSync(path.join(backupDir, 'restore-pending.json')), false);
    const restored = new DatabaseSync(dbFile, { readOnly: true });
    assert.equal(restored.prepare('SELECT value FROM settings WHERE key=?').get('marker').value, 'restored');
    restored.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nightly backup runs once per day after the configured hour', () => {
  const dir = tempDir(), backupDir = path.join(dir, 'backups');
  try {
    const db = makeDb(path.join(dir, 'soojus.sqlite'));
    const settings = { enabled: true, hour: 3, retentionDays: 7 };
    const today = new Date();
    const at = hour => { const d = new Date(today); d.setHours(hour, 0, 0, 0); return d; };
    assert.equal(isNightlyDue({ settings, files: [], now: at(2) }), false);
    assert.equal(isNightlyDue({ settings, files: [], now: at(3) }), true);
    const created = runNightlyBackup({ db, dir: backupDir, settings, now: at(4) });
    assert.equal(created.kind, 'auto');
    assert.equal(isNightlyDue({ settings, files: listBackups(backupDir), now: at(23) }), false);
    assert.equal(runNightlyBackup({ db, dir: backupDir, settings, now: at(23) }), null);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retention removes only old automatic backups', () => {
  const dir = tempDir();
  try {
    const old = new Date(Date.now() - 10 * 86400000), recent = new Date();
    const make = (name, time) => { const file = path.join(dir, name); writeFileSync(file, 'x'); utimesSync(file, time, time); };
    make('soojus-old-auto.sqlite', old);
    make('soojus-new-auto.sqlite', recent);
    make('soojus-old-manual.sqlite', old);
    const removed = pruneAutoBackups(dir, 7, recent);
    assert.equal(removed, 1);
    assert.equal(existsSync(path.join(dir, 'soojus-old-auto.sqlite')), false);
    assert.equal(existsSync(path.join(dir, 'soojus-new-auto.sqlite')), true);
    assert.equal(existsSync(path.join(dir, 'soojus-old-manual.sqlite')), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backup settings are clamped to safe values', () => {
  assert.deepEqual(parseBackupSettings({}), { enabled: true, hour: 3, retentionDays: 7 });
  assert.deepEqual(parseBackupSettings({ enabled: false, hour: 23, retentionDays: 30 }), { enabled: false, hour: 23, retentionDays: 30 });
  assert.deepEqual(parseBackupSettings({ hour: 99, retentionDays: 0 }), { enabled: true, hour: 3, retentionDays: 7 });
});

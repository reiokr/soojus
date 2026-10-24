// Andmebaasi varukoopiad ja taastamine.
// Varukoopia on täielik SQLite snapshot (VACUUM INTO), seega sobib ka otse andmebaasina avada.
// Taastamine ei kirjuta jooksvasse baasi: see valmistab ette markeri ja server rakendab selle
// järgmisel käivitusel (systemd taaskäivitab teenuse). Nii ei jää pooleliolevat baasi.
import { mkdirSync, chmodSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync, writeFileSync, copyFileSync, renameSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const BACKUP_KEY = 'backup';
export const PENDING_RESTORE = 'restore-pending.json';
export const DEFAULT_BACKUP_SETTINGS = Object.freeze({ enabled: true, hour: 3, retentionDays: 7 });
const KINDS = new Set(['manual', 'auto', 'upload', 'pre-restore']);
const BACKUP_RE = /^[A-Za-z0-9._-]+\.sqlite$/;
const DAY_MS = 86400000;

export class BackupError extends Error {}

const integer = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function parseBackupSettings(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    hour: integer(value.hour, DEFAULT_BACKUP_SETTINGS.hour, 0, 23),
    retentionDays: integer(value.retentionDays, DEFAULT_BACKUP_SETTINGS.retentionDays, 1, 90)
  };
}

export function ensureBackupDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

const pad = n => String(n).padStart(2, '0');
const localDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function stamp(date) {
  // Kohalik aeg, et failinimi klapiks liideses näidatava ajaga.
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function nextName(dir, kind, now) {
  const safeKind = KINDS.has(kind) ? kind : 'manual';
  const base = `soojus-${stamp(now)}-${safeKind}`;
  let name = `${base}.sqlite`;
  for (let i = 1; existsSync(path.join(dir, name)); i++) name = `${base}-${i}.sqlite`;
  return name;
}

export function kindOf(name) {
  return /-(manual|auto|upload|pre-restore)\.sqlite$/.exec(name)?.[1] || 'manual';
}

function meta(file) {
  const stat = statSync(file);
  const name = path.basename(file);
  return { name, bytes: stat.size, createdAt: stat.mtime.toISOString(), kind: kindOf(name) };
}

export function listBackups(dir) {
  try {
    return readdirSync(dir)
      .filter(name => BACKUP_RE.test(name))
      .map(name => meta(path.join(dir, name)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}

export function backupFile(dir, name) {
  if (typeof name !== 'string' || !BACKUP_RE.test(name) || path.basename(name) !== name) throw new BackupError('Vale varukoopiafaili nimi.');
  const file = path.join(dir, name);
  if (!existsSync(file)) throw new BackupError('Varukoopiat ei leitud.');
  return file;
}

export function createBackup(db, dir, kind = 'manual', now = new Date()) {
  ensureBackupDir(dir);
  const name = nextName(dir, kind, now);
  const file = path.join(dir, name);
  // VACUUM INTO annab WAL-režiimiski ühtse, juba kokkupakitud faili.
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  chmodSync(file, 0o600);
  return meta(file);
}

// Kontroll enne taastamist: SQLite päis, terviklikkus ja vajalikud tabelid.
export function validateBackup(file) {
  let fd;
  try {
    const size = statSync(file).size;
    if (!size) throw new BackupError('Varukoopia on tühi.');
    fd = openSync(file, 'r');
    const header = Buffer.alloc(16);
    const read = readSync(fd, header, 0, 16, 0);
    closeSync(fd); fd = null;
    if (read < 16 || header.toString('utf8') !== 'SQLite format 3\u0000') throw new BackupError('See fail ei ole SQLite andmebaas.');
  } catch (e) {
    if (fd != null) closeSync(fd);
    if (e instanceof BackupError) throw e;
    throw new BackupError(`Varukoopia kontroll ebaõnnestus: ${e.message}`);
  }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') throw new BackupError('Varukoopia andmebaas on rikutud.');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const required of ['settings', 'samples']) if (!tables.has(required)) throw new BackupError('See ei ole Soojuse andmebaasi varukoopia.');
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError(`Varukoopia avamine ebaõnnestus: ${e.message}`);
  } finally { try { db?.close(); } catch {} }
}

export function saveUpload(dir, buffer, now = new Date()) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new BackupError('Vali varukoopia fail.');
  ensureBackupDir(dir);
  const name = nextName(dir, 'upload', now);
  const file = path.join(dir, name);
  writeFileSync(file, buffer, { mode: 0o600 });
  try { validateBackup(file); }
  catch (e) { rmSync(file, { force: true }); throw e; }
  return meta(file);
}

export function deleteBackup(dir, name) {
  rmSync(backupFile(dir, name));
  return true;
}

export function stageRestore({ dir, name, safety = null }) {
  validateBackup(backupFile(dir, name));
  const marker = path.join(dir, PENDING_RESTORE);
  const temp = `${marker}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ name, safety, requestedAt: new Date().toISOString() }), { mode: 0o600 });
  renameSync(temp, marker);
  return { name, safety };
}

// Käivitatakse enne andmebaasi avamist. Kui marker on olemas, asendatakse baasifail
// atomaarselt ja vanad WAL/SHM failid eemaldatakse. Vigase markeri korral jätkub rakendus
// senise baasiga ja marker nimetatakse ümber, et see ei jääks igavesti korduma.
export function applyPendingRestore({ dir, dbFile }) {
  const marker = path.join(dir, PENDING_RESTORE);
  if (!existsSync(marker)) return null;
  let request = null;
  try { request = JSON.parse(readFileSync(marker, 'utf8')); } catch {}
  try {
    if (!request?.name) throw new BackupError('Taastamise kirjeldus on vigane.');
    const source = backupFile(dir, request.name);
    validateBackup(source);
    const temp = `${dbFile}.restoring-${process.pid}`;
    copyFileSync(source, temp);
    chmodSync(temp, 0o600);
    for (const suffix of ['-wal', '-shm', '-journal']) rmSync(`${dbFile}${suffix}`, { force: true });
    renameSync(temp, dbFile);
    chmodSync(dbFile, 0o600);
    rmSync(marker, { force: true });
    return { restored: true, name: request.name, safety: request.safety || null };
  } catch (e) {
    try { renameSync(marker, path.join(dir, `restore-pending.failed-${Date.now()}.json`)); } catch {}
    if (e instanceof BackupError) throw e;
    throw new BackupError(`Taastamine ebaõnnestus: ${e.message}`);
  }
}

export function isNightlyDue({ settings, files = [], now = new Date() }) {
  if (!settings?.enabled) return false;
  if (now.getHours() < settings.hour) return false;
  const today = localDate(now);
  return !files.some(file => file.kind === 'auto' && localDate(new Date(file.createdAt)) === today);
}

export function pruneAutoBackups(dir, retentionDays, now = new Date(), keepName = null) {
  const cutoff = now.getTime() - Math.max(1, retentionDays) * DAY_MS;
  let removed = 0;
  for (const file of listBackups(dir)) {
    if (file.kind !== 'auto' || file.name === keepName) continue;
    if (Date.parse(file.createdAt) >= cutoff) continue;
    try { rmSync(path.join(dir, file.name)); removed++; } catch {}
  }
  return removed;
}

export function runNightlyBackup({ db, dir, settings, now = new Date(), create = createBackup }) {
  const files = listBackups(dir);
  if (!isNightlyDue({ settings, files, now })) return null;
  const created = create(db, dir, 'auto', now);
  pruneAutoBackups(dir, settings.retentionDays, now, created.name);
  return created;
}

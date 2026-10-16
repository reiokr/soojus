import { mkdirSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import { csvCell } from './domain.js';

// Kohaliku ajaloo hoidla: koondamine (downsampling) ja arhiveerimine.
// Värsked andmed hoitakse minutitäpsusega; päevad, mis on vanemad kui RAW_WINDOW_DAYS, koondatakse
// üheks päevakeskmiseks reaks samasse `samples`-tabelisse (seega ajaloo-API jääb muutmata) ja kõik
// üle RETENTION_DAYS kustutatakse. Nii püsivad päringud kiired ka aastaid kestva ajaloo juures.
export const RETENTION_DAYS = 3650, RAW_WINDOW_DAYS = 45, DAY_MS = 86400000;
// Arhiveerida saab ainult andmeid, mis on aktiivsest aknast vanemad (vähemalt 365 päeva).
export const ARCHIVE_MIN_AGE_DAYS = 365;

export function createStore(db, root) {
  const archiveDir = path.join(root, 'data/archive');

  function compact() {
    const dayStart = t => new Date(Math.floor(t / DAY_MS) * DAY_MS).toISOString();
    const cutoff = dayStart(Date.now() - RAW_WINDOW_DAYS * DAY_MS);
    // Päevad, mis on koondamisaknast vanemad (UTC päeva kaupa, sama jaotus nagu ajaloo-API-s).
    const days = db.prepare(`SELECT DISTINCT strftime('%Y-%m-%dT%H:%M:%fZ', CAST(unixepoch(time)/86400 AS INTEGER)*86400, 'unixepoch') AS d FROM samples WHERE time<? ORDER BY d`).all(cutoff).map(r => r.d);
    const agg = db.prepare('SELECT device, point, AVG(value) AS value, COUNT(*) AS n, label, unit FROM samples WHERE time>=? AND time<? GROUP BY device, point');
    const del = db.prepare('DELETE FROM samples WHERE time>=? AND time<?');
    const ins = db.prepare('INSERT OR REPLACE INTO samples VALUES(?,?,?,?,?,?)');
    for (const d of days) {
      const end = new Date(Date.parse(d) + DAY_MS).toISOString();
      const groups = agg.all(d, end);
      if (!groups.length || groups.every(g => g.n <= 1)) continue; // juba ühe reaga → koondatud
      db.exec('BEGIN');
      try { del.run(d, end); for (const g of groups) ins.run(g.device, g.point, d, g.value, g.label, g.unit); db.exec('COMMIT'); }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    }
    const keepFrom = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();
    db.prepare('DELETE FROM samples WHERE time<?').run(keepFrom);
    db.prepare('DELETE FROM pump_errors WHERE time<?').run(keepFrom);
    return { days: days.length };
  }

  // Arhiiv: kogu kohalik ajalugu (või valitud vahemik) eraldi CSV-faili data/archive/ kausta.
  // Vaikimisi andmeid ei kustutata; remove=true korral eemaldatakse eksporditud read andmebaasist.
  function archiveSamples({ from = '0000', to = '9999', remove = false } = {}) {
    mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    const file = path.join(archiveDir, `soojus-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    const fd = openSync(file, 'w', 0o600);
    let rows = 0;
    try {
      writeSync(fd, '\uFEFFAeg;Seade;Parameeter;Nimetus;Väärtus;Ühik\n');
      let buf = '';
      for (const r of db.prepare('SELECT time,device,point,label,value,unit FROM samples WHERE time>=? AND time<? ORDER BY time').iterate(from, to)) {
        buf += [r.time, r.device, r.point, r.label, r.value, r.unit].map(csvCell).join(';') + '\n';
        rows++;
        if (buf.length >= 1 << 20) { writeSync(fd, buf); buf = ''; }
      }
      if (buf) writeSync(fd, buf);
    } finally { closeSync(fd); }
    let removed = 0;
    if (remove) removed = db.prepare('DELETE FROM samples WHERE time>=? AND time<?').run(from, to).changes;
    return { file: path.relative(root, file), bytes: statSync(file).size, rows, removed };
  }

  return { compact, archiveSamples };
}

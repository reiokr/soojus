// Hiljutised õnnestunud parameetrikirjutused. myUplink võib pärast PATCH-i veel
// paar sekundit vana väärtust tagastada ja serveri mälus olev snapshot on samuti
// kirjutuseelne. Kuni pilv järele jõuab, näitame kasutajale kirjutatud väärtust.
const typedValue = (point, raw) => {
  const match = point.enumValues?.find(entry => String(entry.value) === String(raw));
  if (match) return match.value;
  const value = Number(raw);
  return Number.isFinite(value) ? value : raw;
};

export function createRecentWrites({ ttlMs = 90000 } = {}) {
  const devices = new Map();
  const entry = (device, parameterId, now) => {
    const entries = devices.get(device), found = entries?.get(parameterId);
    if (!found) return null;
    if (found.until < now) { entries.delete(parameterId); if (!entries.size) devices.delete(device); return null; }
    return found;
  };
  return {
    record(device, values, now = Date.now()) {
      const entries = devices.get(device) ?? new Map();
      for (const [parameterId, value] of Object.entries(values)) entries.set(parameterId, { value: String(value), until: now + ttlMs });
      devices.set(device, entries);
    },
    // Asendab punktide väärtused, kuni seade/pilv kinnitab sama väärtuse; siis kaob ülekate ise.
    apply(device, points, now = Date.now()) {
      const entries = devices.get(device);
      if (!entries || !Array.isArray(points)) return points;
      let changed = false;
      const next = points.map(point => {
        const found = entry(device, point.parameterId, now);
        if (!found) return point;
        if (String(point.value) === found.value) { entries.delete(point.parameterId); return point; }
        changed = true;
        return { ...point, value: typedValue(point, found.value) };
      });
      if (!entries.size) devices.delete(device);
      return changed ? next : points;
    },
    get(device, parameterId, now = Date.now()) { return entry(device, parameterId, now)?.value; },
    clear(device) { devices.delete(device); }
  };
}

// Väike rotatsiooniga faililogger. Kirjutab ka konsooli, seega systemd journal jääb alles.
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export function createLogger({ dir, file = 'soojus.log', maxBytes = 5 * 1024 * 1024, keep = 5, consoleImpl = console } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
  const target = path.join(dir, file);

  const rotate = () => {
    if (!existsSync(target) || statSync(target).size < maxBytes) return;
    // soojus.log → .1, .1 → .2, ...; vanim (.keep) kustub.
    for (let i = keep; i >= 1; i--) {
      const source = i === 1 ? target : `${target}.${i - 1}`;
      const destination = `${target}.${i}`;
      if (!existsSync(source)) continue;
      rmSync(destination, { force: true });
      renameSync(source, destination);
    }
  };

  const write = (level, message) => {
    const text = message instanceof Error ? (message.stack || message.message) : String(message);
    try {
      rotate();
      appendFileSync(target, `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`, { mode: 0o600 });
    } catch { /* logimine ei tohi rakendust maha võtta */ }
    if (level === 'error') consoleImpl.error?.(text);
    else consoleImpl.log?.(text);
  };

  return {
    info: message => write('info', message),
    error: message => write('error', message),
    path: target,
    size: () => { try { return statSync(target).size; } catch { return 0; } }
  };
}

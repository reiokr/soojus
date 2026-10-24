import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../server/log.js';

test('logger writes, rotates and keeps the newest files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'soojus-log-'));
  try {
    const logger = createLogger({ dir, maxBytes: 80, keep: 2, consoleImpl: { log() {}, error() {} } });
    for (let i = 0; i < 20; i++) logger.info(`line ${i} ${'x'.repeat(20)}`);
    const files = readdirSync(dir).sort();
    assert.ok(files.includes('soojus.log'));
    assert.ok(files.includes('soojus.log.1'));
    assert.ok(!files.includes('soojus.log.3'));
    assert.ok(logger.size() < 200);
    const all = files.map(file => readFileSync(path.join(dir, file), 'utf8')).join('\n');
    assert.match(all, /line 19/);
    logger.error('boom');
    assert.match(readFileSync(path.join(dir, files.find(f => f === 'soojus.log')), 'utf8'), /ERROR boom/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('logger creates the directory and keeps logging errors non-fatal', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'soojus-log-'));
  try {
    const logger = createLogger({ dir: path.join(dir, 'nested'), consoleImpl: { log() {}, error() {} } });
    logger.info('hello');
    assert.equal(existsSync(path.join(dir, 'nested', 'soojus.log')), true);
    logger.error(new Error('expected'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

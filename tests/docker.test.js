import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('every src file imported by the server is copied into the Docker image', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  const needed = new Set();
  for (const f of readdirSync('server').filter(f => f.endsWith('.js'))) {
    for (const m of readFileSync(`server/${f}`, 'utf8').matchAll(/from '\.\.\/(src\/[^']+)'/g)) needed.add(m[1]);
  }
  assert.ok(needed.size > 0);
  for (const file of needed) assert.ok(dockerfile.includes(file) || /COPY src \.\/src/.test(dockerfile), `Dockerfile ei kopeeri faili ${file}`);
});

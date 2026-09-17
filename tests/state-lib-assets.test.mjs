import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
test('board build ships exactly the four runtime modules allowed by the dev server', () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const expected = ['core.js', 'external-store.js', 'index.js', 'latest-task.js'];
  const output = join(root, 'dist/board/packages/state-lib/dist');
  assert.deepEqual(readdirSync(output).sort(), expected);
  for (const file of expected) {
    assert.deepEqual(readFileSync(join(output, file)), readFileSync(join(root, 'packages/state-lib/dist', file)));
  }
});

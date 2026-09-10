import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
function files(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:mjs|js)$/.test(path) ? [path] : [];
  });
}
for (const folder of ['apps', 'packages', 'server', 'scripts', 'api']) {
  test(`all ${folder} JavaScript modules parse, including browser-only code`, () => {
    for (const path of files(join(root, folder))) {
      const result = spawnSync(process.execPath, ['--check', path], {encoding: 'utf8', timeout: 10000});
      assert.equal(result.status, 0, `${path}\n${result.stderr}`);
    }
  });
}

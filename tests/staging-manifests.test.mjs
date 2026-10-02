// Validates the A/B staging manifests under deploy/staging (HYP-1490): identical
// schema, no third-party/notification variables, no credential-looking values,
// DATABASE_URL only for the remote staging target, synthetic people only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const dir = fileURLToPath(new URL('../deploy/staging/', import.meta.url));
const load = (name) => JSON.parse(readFileSync(dir + name, 'utf8'));
const variants = {baseline: load('baseline.json'), 'state-lib': load('state-lib.json')};
const FORBIDDEN = ['RESEND_API_KEY', 'MAIL_FROM', 'SLACK_BOT_TOKEN', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET',
  'SLACK_TEAM_ID', 'GITHUB_TOKEN', 'LINEAR_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
  'VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL', 'EMBEDDING_API_KEY'];

const shape = (value) => Array.isArray(value) ? ['array']
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
    : typeof value;
const envNames = (target) => [...Object.keys(target.env ?? {}), ...(target.requiredEnv ?? []), ...(target.optionalEnv ?? [])];

test('both manifests have the same schema and differ only in variant, build and output', () => {
  assert.deepEqual(shape(variants.baseline), shape(variants['state-lib']));
  assert.equal(variants.baseline.variant, 'baseline');
  assert.equal(variants['state-lib'].variant, 'state-lib');
  const strip = ({variant, description, buildCommand, outputDir, targets, ...rest}) => ({rest, env: targets['local-synthetic'].env.BOARDS_STATE_BACKEND});
  assert.notDeepEqual(strip(variants.baseline).env, strip(variants['state-lib']).env);
  assert.deepEqual(strip(variants.baseline).rest, strip(variants['state-lib']).rest);
});

test('each variant declares the two targets and the correct build command', () => {
  for (const [name, manifest] of Object.entries(variants)) {
    assert.deepEqual(Object.keys(manifest.targets).sort(), ['local-synthetic', 'remote-staging']);
    assert.equal(manifest.targets['local-synthetic'].env.BOARDS_STATE_BACKEND, name);
    assert.match(manifest.buildCommand, new RegExp(`--state-backend=${name}`));
    assert.match(manifest.buildCommand, new RegExp(`--out=${manifest.outputDir}`));
    assert.equal(manifest.targets['remote-staging'].runnableByWorker, false);
  }
});

test('forbidden variables are listed and never required, optional or set', () => {
  for (const manifest of Object.values(variants)) {
    assert.deepEqual([...manifest.forbiddenEnv].sort(), [...FORBIDDEN].sort());
    for (const target of Object.values(manifest.targets)) {
      for (const name of envNames(target)) assert.ok(!FORBIDDEN.includes(name), name);
    }
  }
});

test('no credential-looking values and local env is synthetic', () => {
  for (const manifest of Object.values(variants)) {
    const text = JSON.stringify(manifest);
    assert.doesNotMatch(text, /postgres(ql)?:\/\//i);
    assert.doesNotMatch(text, /\b(sk|ghp|xox[a-z]|re)_[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{32,}/);
    const local = manifest.targets['local-synthetic'].env;
    assert.equal(local.LOCAL_TEST_MODE, '1');
    assert.equal(local.LOCAL_DATABASE_PATH, ':memory:');
    assert.match(local.AUTH_SECRET, /synthetic/);
    assert.equal(local.BOARDS_SEED_PEOPLE, 'deploy/staging/synthetic-demo/people.json');
  }
});

test('DATABASE_URL appears only under remote-staging with a staging-only note', () => {
  for (const manifest of Object.values(variants)) {
    assert.ok(!envNames(manifest.targets['local-synthetic']).includes('DATABASE_URL'));
    const remote = manifest.targets['remote-staging'];
    assert.ok(remote.requiredEnv.includes('DATABASE_URL'));
    assert.match(remote.notes.DATABASE_URL, /dedicated staging database/i);
    assert.match(remote.notes.DATABASE_URL, /never the production/i);
    assert.match(remote.notes.LOCAL_TEST_MODE, /Vercel/);
    assert.doesNotMatch(JSON.stringify(manifest.targets['local-synthetic']), /DATABASE_URL/);
  }
});

test('synthetic people use only .invalid emails and no URLs', () => {
  const people = load('synthetic-demo/people.json');
  const list = Array.isArray(people) ? people : people.people;
  assert.ok(list.length >= 3);
  for (const person of list) {
    assert.match(person.email, /^[^\s@]+@example\.invalid$/);
    assert.doesNotMatch(JSON.stringify(person), /https?:\/\//);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration, publicHTML} from '../server/app.mjs';
import {storeTarget} from '../server/store.mjs';
import {origin} from '../server/http.mjs';
import {createWorkspace, projectShare} from '../packages/core/workspace.mjs';

const production = {
  DATABASE_URL: 'postgresql://example:NOT_A_REAL_PASSWORD@database.example/board?sslmode=require',
  APP_ORIGIN: 'https://board.example', OWNER_EMAIL: 'owner@example.test',
  GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture',
};

test('explicit local preview refuses a production connection instead of touching it', () => {
  assert.throws(() => storeTarget({...production, LOCAL_TEST_MODE: '1'}), /local test.*cloud|cloud.*local test/i);
  assert.equal(configuration({...production, LOCAL_TEST_MODE:'1'}).ready, false);
});

test('a hosted deployment ignores test mode and requires its real cloud configuration', () => {
  assert.equal(storeTarget({...production, LOCAL_TEST_MODE:'1', VERCEL:'1'}).kind, 'neon');
  assert.equal(configuration({...production, LOCAL_TEST_MODE:'1', VERCEL:'1'}).test, false);
  assert.throws(() => storeTarget({LOCAL_TEST_MODE:'1', VERCEL:'1'}), /cloud/i);
});

test('invalid connection strings and owner emails never produce a ready screen', () => {
  for (const value of ['not-a-url', 'https://database.example', 'postgresql://']) {
    const env = {...production, DATABASE_URL:value};
    assert.throws(() => storeTarget(env));
    assert.equal(configuration(env).ready, false);
  }
  assert.equal(configuration({...production, OWNER_EMAIL:'not-an-email'}).ready, false);
});

test('deployed origins require HTTPS even for a loopback-looking hostname', () => {
  assert.throws(() => origin({APP_ORIGIN:'http://127.0.0.1:5173', VERCEL:'1'}), /HTTPS/);
  assert.equal(origin({APP_ORIGIN:'http://127.0.0.1:5173'}), 'http://127.0.0.1:5173');
});

test('public readiness responses never serialize connection strings or provider credentials', () => {
  const serialized = JSON.stringify(configuration(production));
  assert.equal(serialized.includes('NOT_A_REAL_PASSWORD'), false);
  assert.equal(serialized.includes(production.DATABASE_URL), false);
  assert.equal(serialized.includes('fixture'), false);
});

test('shared pages use the same guarded bootstrap and mobile styles as the editor', () => {
  const view = projectShare(createWorkspace(), {kind:'board',boardId:'roadmap'});
  const html = publicHTML(view, 'a'.repeat(43), production);
  assert.match(html, /src="\/boot\.mjs"/);
  assert.match(html, /href="\/refinements\.css"/);
  assert.match(html, /viewport-fit=cover/);
});

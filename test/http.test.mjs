import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createServer } from '../server.mjs';
import { ensureSampleRepo } from '../scripts/create-sample.mjs';

async function serve(t, options = {}) {
  const server = createServer({ sampleRepoPath: await ensureSampleRepo(), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('unavailable local inference is reported honestly and never fabricates a story', async t => {
  const url = await serve(t, { fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); } });
  const statusResponse = await fetch(`${url}/api/status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.available, false);
  assert.deepEqual(status.models, []);

  const sample = await (await fetch(`${url}/api/sample`)).json();
  assert.equal(sample.repository.sample, true);
  assert.equal(sample.files.length, 6);
  const response = await fetch(`${url}/api/story`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify({ repositoryId: sample.repository.id, fileId: sample.files[0].id, model: 'qwen3:4b' }),
  });
  assert.ok(response.status >= 400);
  const body = await response.json();
  assert.ok(body.error);
  assert.equal(body.story, undefined);
});

test('cross-origin and untrusted Host requests cannot inspect local repositories', async t => {
  const url = await serve(t, { fetchImpl: async () => { throw new Error('inference is irrelevant to origin checks'); } });
  const hostileOrigin = await fetch(`${url}/api/repositories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
    body: JSON.stringify({ path: await ensureSampleRepo() }),
  });
  assert.equal(hostileOrigin.status, 403);
  assert.equal(hostileOrigin.headers.get('access-control-allow-origin'), null);

  // fetch normalizes Host; send the actual HTTP header to exercise rebinding protection.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/api/sample`, { headers: { Host: 'attacker.example.invalid' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(hostileHostStatus, 403);
  const sameOrigin = await fetch(`${url}/api/repositories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify({ path: await ensureSampleRepo() }),
  });
  assert.equal(sameOrigin.status, 200);
  assert.equal((await sameOrigin.json()).files.length, 6);
});

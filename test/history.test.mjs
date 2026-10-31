import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RepositoryStore } from '../lib/git.mjs';
import { ensureSampleRepo } from '../scripts/create-sample.mjs';

const execFileAsync = promisify(execFile);

test('the fictional fixture exposes six genuine deletions with source-backed session history', async () => {
  const store = new RepositoryStore();
  const samplePath = await ensureSampleRepo();
  const opened = await store.open(samplePath, { sample: true });
  assert.equal(opened.repository.name, 'nightshift');
  assert.equal(opened.repository.sample, true);
  assert.equal(opened.files.length, 6);
  const file = opened.files.find(file => file.path === 'src/auth/session-store.ts');
  assert.ok(file);
  assert.match(file.deletedAt, /^2026-10-28/);
  assert.match(file.subject, /signed cookies.*survive restarts/);
  const detail = await store.details(opened.repository.id, file.id);
  assert.match(detail.stats.addedAt, /^2026-02-04/);
  assert.match(detail.stats.removedAt, /^2026-10-28/);
  assert.equal(detail.history.length, 5);
  assert.ok(detail.history.some(entry => /sign-out/.test(entry.subject)));
  assert.ok(detail.history.some(entry => /authenticated activity/.test(entry.subject)));
  assert.match(detail.lastContent, /revokeSession/);
  assert.match(detail.lastContent, /session\.expiresAt = Date\.now\(\) \+ SESSION_TTL/);
  assert.match(detail.diff, /-const sessions = new Map/);
  assert.ok(detail.evidence.length > 0);
  assert.ok(detail.evidence.some(item => item.kind === 'source'));
  const actualCommits = new Set(detail.history.map(entry => entry.sha));
  const parent = await execFileAsync('git', ['-c', 'log.showSignature=false', 'show', '-s', '--format=%H%n%aI', `${file.deletedCommit}^`], { cwd: samplePath });
  const [parentSha, parentDate] = parent.stdout.trim().split('\n');
  const parentSource = await execFileAsync('git', ['show', '--no-ext-diff', '--no-textconv', `${parentSha}:${file.path}`], { cwd: samplePath });
  assert.ok(!actualCommits.has(parentSha), 'this fixture includes an unrelated commit between the last change and deletion');
  for (const evidence of detail.evidence) {
    assert.ok(evidence.id);
    assert.ok(evidence.text);
    if (evidence.kind === 'source') {
      assert.equal(evidence.sha, parentSha, 'source must cite the revision that still contains the file');
      assert.equal(evidence.date, parentDate);
      assert.equal(evidence.text, parentSource.stdout);
    } else {
      assert.ok(actualCommits.has(evidence.sha), 'commit and diff citations must resolve to the real file history');
    }
  }
  assert.equal(await ensureSampleRepo(), samplePath, 'opening the sample must not replace its history');
});

test('restored files are omitted and unusual filenames remain literal Git paths', async t => {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'last-commit-history-'));
  t.after(() => rm(repositoryPath, { recursive: true, force: true }));
  const git = args => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Sample Maintainer', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Sample Maintainer', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' },
  });
  const unusual = 'src/odd [x];$(touch NEVER).ts';
  await git(['init', '--quiet', '--initial-branch=main']);
  await mkdir(path.join(repositoryPath, 'src'));
  await writeFile(path.join(repositoryPath, unusual), 'export const evidence = "literal filename";\n');
  await writeFile(path.join(repositoryPath, 'restored.ts'), 'export const restored = 1;\n');
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Add two files']);
  await rm(path.join(repositoryPath, unusual));
  await rm(path.join(repositoryPath, 'restored.ts'));
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Remove both files']);
  await writeFile(path.join(repositoryPath, 'restored.ts'), 'export const restored = 2;\n');
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Restore the active file']);

  const store = new RepositoryStore();
  const opened = await store.open(repositoryPath);
  assert.deepEqual(opened.files.map(file => file.path), [unusual]);
  const detail = await store.details(opened.repository.id, opened.files[0].id);
  assert.equal(detail.lastContent, 'export const evidence = "literal filename";\n');
  assert.equal(detail.history.length, 2);
  assert.match(detail.diff, /literal filename/);
  const status = await git(['status', '--porcelain']);
  assert.equal(status.stdout, '', 'repository inspection must not execute filename content or write files');
});

test('a file deleted only while resolving a merge still has a readable last revision', async t => {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'last-commit-merge-'));
  t.after(() => rm(repositoryPath, { recursive: true, force: true }));
  const git = args => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Sample Maintainer', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Sample Maintainer', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z' },
  });
  await git(['init', '--quiet', '--initial-branch=main']);
  await writeFile(path.join(repositoryPath, 'obsolete.ts'), 'export const legacy = true;\n');
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Add the legacy adapter']);
  await git(['checkout', '--quiet', '-b', 'replacement']);
  await writeFile(path.join(repositoryPath, 'replacement.ts'), 'export const current = true;\n');
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Prepare a replacement']);
  await git(['checkout', '--quiet', 'main']);
  await writeFile(path.join(repositoryPath, 'README.md'), '# Example\n');
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Document the example']);
  await git(['merge', '--quiet', '--no-ff', '--no-commit', 'replacement']);
  await rm(path.join(repositoryPath, 'obsolete.ts'));
  await git(['add', '--all']);
  await git(['commit', '--quiet', '-m', 'Merge replacement and retire legacy adapter']);

  const store = new RepositoryStore();
  const opened = await store.open(repositoryPath);
  assert.equal(opened.files.length, 1);
  assert.equal(opened.files[0].path, 'obsolete.ts');
  assert.equal(opened.files[0].subject, 'Merge replacement and retire legacy adapter');
  const detail = await store.details(opened.repository.id, opened.files[0].id);
  assert.equal(detail.lastContent, 'export const legacy = true;\n');
  assert.match(detail.diff, /-export const legacy = true/);
  assert.ok(detail.history.some(entry => entry.subject === 'Add the legacy adapter'));
});

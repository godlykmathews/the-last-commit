import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = path.join(projectRoot, '.data');
const samplePath = path.join(dataRoot, 'nightshift');
const identity = { GIT_AUTHOR_NAME: 'Sample Maintainer', GIT_AUTHOR_EMAIL: 'maintainer@example.invalid', GIT_COMMITTER_NAME: 'Sample Maintainer', GIT_COMMITTER_EMAIL: 'maintainer@example.invalid' };
const sampleNotice = 'Nightshift is a fictional repository created for The Last Commit.';
let pending;

async function exists(location) {
  try { await access(location); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function buildSample() {
  await mkdir(dataRoot, { recursive: true });
  if (await exists(samplePath)) {
    const readme = await readFile(path.join(samplePath, 'README.md'), 'utf8').catch(() => '');
    if (!(await exists(path.join(samplePath, '.git'))) || !readme.includes(sampleNotice)) {
      throw new Error('The sample path already exists and is not a Nightshift fixture. Choose a different repository.');
    }
    return samplePath;
  }

  const staging = path.join(dataRoot, `.nightshift-building-${process.pid}-${Date.now()}`);
  await mkdir(staging);
  const git = async (args, date) => execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: staging,
    env: { ...process.env, ...identity, ...(date ? { GIT_AUTHOR_DATE: `${date}T12:00:00+00:00`, GIT_COMMITTER_DATE: `${date}T12:00:00+00:00` } : {}) },
    maxBuffer: 1024 * 1024,
  });
  const put = async (relativePath, content) => {
    const destination = path.resolve(staging, relativePath);
    if (!destination.startsWith(`${staging}${path.sep}`)) throw new Error('Sample file must remain inside the fixture.');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  const commit = async (date, subject, updates, removals = []) => {
    for (const [file, content] of Object.entries(updates)) await put(file, content);
    for (const file of removals) await rm(path.join(staging, file));
    await git(['add', '--all']);
    await git(['commit', '--quiet', '-m', subject], date);
  };

  try {
    await git(['init', '--quiet', '--initial-branch=main']);
    await commit('2026-01-10', 'Start Nightshift, a fictional after-hours status service', {
      'README.md': `# Nightshift\n\n${sampleNotice}\nAll code, names, dates, and commit messages are example material.\n\nAn imaginary service that collects background job status for a small team.\nIt is a history exhibit, not a runnable production application.\n`,
    });
    await commit('2026-01-14', 'Document the first status API', {
      'docs/v1-api.md': '# Status API v1\n\nGET /v1/jobs returns the latest jobs.\nGET /v1/jobs/:id returns a job and its last known status.\n\nClients poll every 30 seconds. Failed jobs use status "failed".\n',
    });
    await commit('2026-01-21', 'Add timestamped console logging', {
      'src/utils/logger.ts': 'export function log(message: string) {\n  console.log(`[${new Date().toISOString()}] ${message}`);\n}\n',
    });
    await commit('2026-02-04', 'Keep user sessions in an in-memory store', {
      'src/auth/session-store.ts': 'type Session = { userId: string; expiresAt: number };\nconst sessions = new Map<string, Session>();\n\nexport function createSession(id: string, userId: string) {\n  sessions.set(id, { userId, expiresAt: Date.now() + 3_600_000 });\n}\n\nexport function getSession(id: string) {\n  return sessions.get(id);\n}\n',
    });
    await commit('2026-02-12', 'Queue failed jobs for a second attempt', {
      'src/queue/retry-queue.ts': 'const pending: string[] = [];\n\nexport function retryLater(jobId: string) {\n  pending.push(jobId);\n}\n\nexport function nextRetry() {\n  return pending.shift();\n}\n',
    });
    await commit('2026-02-20', 'Show job totals on the original dashboard', {
      'src/ui/old-dashboard.ts': 'type Counts = { running: number; failed: number };\n\nexport function renderDashboard(counts: Counts) {\n  return `<h1>Nightshift</h1><p>${counts.running} running · ${counts.failed} failed</p>`;\n}\n',
    });
    await commit('2026-03-02', 'Deploy the status service with a manual script', {
      'scripts/deploy.sh': '#!/bin/sh\nset -eu\nnpm run build\nrsync -az dist/ "${DEPLOY_HOST}:/srv/nightshift/"\n',
    });
    await commit('2026-03-12', 'Expire sessions when their one-hour lifetime ends', {
      'src/auth/session-store.ts': 'type Session = { userId: string; expiresAt: number };\nconst sessions = new Map<string, Session>();\n\nexport function createSession(id: string, userId: string) {\n  sessions.set(id, { userId, expiresAt: Date.now() + 3_600_000 });\n}\n\nexport function getSession(id: string) {\n  const session = sessions.get(id);\n  if (session && session.expiresAt <= Date.now()) {\n    sessions.delete(id);\n    return undefined;\n  }\n  return session;\n}\n',
    });
    await commit('2026-03-28', 'Clarify v1 polling and rate limits', {
      'docs/v1-api.md': '# Status API v1\n\nGET /v1/jobs returns the latest jobs.\nGET /v1/jobs/:id returns a job and its last known status.\n\nClients poll every 30 seconds. Failed jobs use status "failed".\nLimit polling to two requests per minute per client.\nThis API does not stream changes.\n',
    });
    await commit('2026-04-18', 'Allow sessions to be revoked on sign-out', {
      'src/auth/session-store.ts': 'type Session = { userId: string; expiresAt: number };\nconst sessions = new Map<string, Session>();\n\nexport function createSession(id: string, userId: string) {\n  sessions.set(id, { userId, expiresAt: Date.now() + 3_600_000 });\n}\n\nexport function getSession(id: string) {\n  const session = sessions.get(id);\n  if (session && session.expiresAt <= Date.now()) {\n    sessions.delete(id);\n    return undefined;\n  }\n  return session;\n}\n\nexport function revokeSession(id: string) {\n  sessions.delete(id);\n}\n',
    });
    await commit('2026-05-06', 'Include job identifiers in log output', {
      'src/utils/logger.ts': 'export function log(message: string, jobId?: string) {\n  const context = jobId ? ` job=${jobId}` : "";\n  console.log(`[${new Date().toISOString()}]${context} ${message}`);\n}\n',
    });
    await commit('2026-05-22', 'Cap retry attempts to prevent endless job loops', {
      'src/queue/retry-queue.ts': 'type Retry = { jobId: string; attempt: number };\nconst pending: Retry[] = [];\nconst MAX_ATTEMPTS = 3;\n\nexport function retryLater(jobId: string, attempt: number) {\n  if (attempt < MAX_ATTEMPTS) pending.push({ jobId, attempt });\n}\n\nexport function nextRetry() {\n  return pending.shift();\n}\n',
    });
    await commit('2026-06-19', 'Retire v1 API documentation after moving clients to event streams', {
      'docs/api.md': '# Status API\n\nGET /v2/events streams job changes over server-sent events.\nThe former v1 polling API was retired after clients migrated.\n',
    }, ['docs/v1-api.md']);
    await commit('2026-07-05', 'Replace the console logger with structured event records', {
      'src/observability/events.ts': 'export function emitEvent(name: string, fields: Record<string, unknown>) {\n  console.log(JSON.stringify({ time: new Date().toISOString(), name, ...fields }));\n}\n',
    }, ['src/utils/logger.ts']);
    await commit('2026-07-22', 'Show the last successful run on the old dashboard', {
      'src/ui/old-dashboard.ts': 'type Counts = { running: number; failed: number; lastSuccess: string };\n\nexport function renderDashboard(counts: Counts) {\n  return `<h1>Nightshift</h1><p>${counts.running} running · ${counts.failed} failed</p><small>Last success: ${counts.lastSuccess}</small>`;\n}\n',
    });
    await commit('2026-08-02', 'Require a deployment host before building', {
      'scripts/deploy.sh': '#!/bin/sh\nset -eu\n: "${DEPLOY_HOST:?Set DEPLOY_HOST before deploying}"\nnpm run build\nrsync -az dist/ "${DEPLOY_HOST}:/srv/nightshift/"\n',
    });
    await commit('2026-08-19', 'Remove manual deployment script after adopting release artifacts', {
      'docs/releases.md': '# Releases\n\nBuilds are packaged as release artifacts. Operations deploys a selected artifact.\nThe former rsync deployment script is no longer used.\n',
    }, ['scripts/deploy.sh']);
    await commit('2026-09-16', 'Replace the old dashboard with a compact activity feed', {
      'src/ui/activity-feed.ts': 'type Event = { id: string; label: string };\n\nexport function activityFeed(events: Event[]) {\n  return events.map(event => ({ key: event.id, text: event.label }));\n}\n',
    }, ['src/ui/old-dashboard.ts']);
    await commit('2026-09-22', 'Refresh session expiry after authenticated activity', {
      'src/auth/session-store.ts': 'type Session = { userId: string; expiresAt: number };\nconst sessions = new Map<string, Session>();\nconst SESSION_TTL = 3_600_000;\n\nexport function createSession(id: string, userId: string) {\n  sessions.set(id, { userId, expiresAt: Date.now() + SESSION_TTL });\n}\n\nexport function getSession(id: string) {\n  const session = sessions.get(id);\n  if (session && session.expiresAt <= Date.now()) {\n    sessions.delete(id);\n    return undefined;\n  }\n  if (session) session.expiresAt = Date.now() + SESSION_TTL;\n  return session;\n}\n\nexport function revokeSession(id: string) {\n  sessions.delete(id);\n}\n',
    });
    await commit('2026-10-17', 'Replace the in-memory retry queue with durable job records', {
      'src/queue/worker.ts': 'type JobStore = { claimPending: () => Promise<{ id: string } | undefined> };\n\nexport async function takeNextJob(store: JobStore) {\n  // Pending jobs survive process restarts in the durable job store.\n  return store.claimPending();\n}\n',
    }, ['src/queue/retry-queue.ts']);
    await commit('2026-10-28', 'Replace the session store with signed cookies so sessions survive restarts', {
      'src/auth/cookie-session.ts': 'type CookieSigner = { sign: (payload: string) => string };\n\nexport function issueSessionCookie(userId: string, signer: CookieSigner) {\n  const payload = JSON.stringify({ userId, expiresAt: Date.now() + 3_600_000 });\n  return signer.sign(payload);\n}\n',
      'docs/architecture.md': '# Architecture notes\n\nThe in-memory src/auth/session-store.ts lost sessions whenever a process restarted.\nSigned cookies now carry session identity and expiry; verification belongs to the HTTP adapter.\nThe former store used a one-hour sliding expiration and explicit sign-out revocation.\nThe replacement requires an appropriate cookie invalidation policy before production use.\n',
    }, ['src/auth/session-store.ts']);
    await rename(staging, samplePath);
    return samplePath;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
      const readme = await readFile(path.join(samplePath, 'README.md'), 'utf8').catch(() => '');
      if (readme.includes(sampleNotice) && await exists(path.join(samplePath, '.git'))) return samplePath;
    }
    throw error;
  }
}

export function ensureSampleRepo() {
  pending ??= buildSample().catch(error => { pending = undefined; throw error; });
  return pending;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureSampleRepo().then(location => console.log(location)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

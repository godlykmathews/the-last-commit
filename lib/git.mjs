import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_DELETION_COMMITS = 300;
const MAX_FILES = 200;
const MAX_HISTORY = 80;
const MAX_TEXT = 24_000;
const FORMAT = '%x00%H%x00%aI%x00%s%x00%an%x00';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function git(cwd, args, { maxBuffer = 8 * 1024 * 1024 } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_LITERAL_PATHSPECS: '1',
    LC_ALL: 'C',
  });
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'log.showSignature=false', '-c', 'diff.external=', '-c', 'core.pager=cat', ...args], {
      cwd, env, timeout: 12_000, maxBuffer, encoding: 'utf8', windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        if (error.code === 'ENOENT') return reject(new AppError('Git is not installed.', 503));
        if (error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return reject(new AppError('This repository exceeds the bounded history scan. Try a smaller repository.', 422));
        }
        return reject(new AppError('Could not read this Git repository. Check its path and commit history.', 422));
      }
      resolve(stdout);
    });
  });
}

// Git paths are NUL-delimited: spaces, tabs, newlines, and pathspec characters remain literal.
function parseLog(raw) {
  const tokens = raw.split('\0');
  const result = [];
  let i = 0;
  while (i < tokens.length) {
    while (tokens[i] === '') i++;
    if (i >= tokens.length) break;
    const sha = tokens[i++];
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new AppError('Git returned an unreadable history record.', 422);
    const date = tokens[i++];
    const subject = tokens[i++];
    const author = tokens[i++];
    if (tokens[i] === '') i++;
    const changes = [];
    while (i < tokens.length && tokens[i] !== '') {
      const kind = tokens[i++].replace(/^\n/, '');
      const filePath = tokens[i++];
      if (filePath === undefined) break;
      changes.push({ kind, path: filePath });
    }
    result.push({ sha, shortSha: sha.slice(0, 7), date, subject, author, changes });
  }
  return result;
}

function boundedText(text, maximum = MAX_TEXT) {
  if (text.includes('\0')) return { text: '[Binary file — source preview unavailable]', truncated: false };
  return { text: text.slice(0, maximum), truncated: text.length > maximum };
}

export class RepositoryStore {
  #repositories = new Map();

  async open(inputPath, { sample = false } = {}) {
    if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0') || inputPath.length > 4096) {
      throw new AppError('Enter an absolute path to a local Git repository.');
    }
    if (!path.isAbsolute(inputPath)) throw new AppError('Use an absolute repository path.');
    let requestedPath;
    try { requestedPath = await realpath(inputPath); } catch { throw new AppError('That folder could not be found.', 404); }
    const root = (await git(requestedPath, ['rev-parse', '--show-toplevel'])).replace(/\n$/, '');
    const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
    const branchRaw = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
    const [tree, raw] = await Promise.all([
      git(root, ['ls-tree', '-r', '-z', '--name-only', head]),
      git(root, ['log', '--format=' + FORMAT, '--name-status', '-z', '--no-renames', '--topo-order', '--diff-merges=first-parent',
        '--diff-filter=D', '--max-count=' + (MAX_DELETION_COMMITS + 1), head, '--']),
    ]);
    const currentPaths = new Set(tree.split('\0').filter(Boolean));
    const records = parseLog(raw);
    const seen = new Set();
    const files = [];
    let limited = records.length > MAX_DELETION_COMMITS;
    for (const record of records.slice(0, MAX_DELETION_COMMITS)) {
      for (const change of record.changes) {
        if (change.kind !== 'D' || seen.has(change.path) || currentPaths.has(change.path)) continue;
        seen.add(change.path);
        if (files.length >= MAX_FILES) { limited = true; continue; }
        files.push({
          id: createHash('sha256').update(head + '\0' + change.path).digest('hex').slice(0, 24),
          path: change.path, name: path.posix.basename(change.path), deletedAt: record.date,
          deletedCommit: record.sha, subject: record.subject,
        });
      }
    }
    const repository = { id: randomUUID(), name: path.basename(root), path: root, branch: branchRaw || head.slice(0, 7), sample };
    const entry = { repository, files, total: files.length, limited, head, details: new Map() };
    this.#repositories.set(repository.id, entry);
    // Keep a small session cache; no repository data is persisted by the application.
    if (this.#repositories.size > 20) {
      const oldest = [...this.#repositories].find(([, item]) => !item.repository.sample)?.[0];
      this.#repositories.delete(oldest || this.#repositories.keys().next().value);
    }
    return this.#response(entry);
  }

  async sample(samplePath) { return this.open(samplePath, { sample: true }); }

  #response(entry) {
    const { repository, files, total, limited } = entry;
    return { repository, files, total, limited };
  }

  getRepository(id) {
    const entry = this.#repositories.get(id);
    if (!entry) throw new AppError('Repository session not found. Open the repository again.', 404);
    return this.#response(entry);
  }

  async details(repositoryId, fileId) {
    const entry = this.#repositories.get(repositoryId);
    if (!entry) throw new AppError('Repository session not found. Open the repository again.', 404);
    const file = entry.files.find(item => item.id === fileId);
    if (!file) throw new AppError('File not found in this repository session.', 404);
    if (entry.details.has(fileId)) return entry.details.get(fileId);
    const cwd = entry.repository.path;
    const [raw, contentRaw, diffRaw, parentRaw] = await Promise.all([
      git(cwd, ['log', '--format=' + FORMAT, '--name-status', '-z', '--no-renames', '--topo-order', '--diff-merges=first-parent',
        '--max-count=' + (MAX_HISTORY + 1), file.deletedCommit, '--', file.path]),
      git(cwd, ['show', '--no-ext-diff', '--no-textconv', file.deletedCommit + '^:' + file.path], { maxBuffer: 2 * 1024 * 1024 })
        .catch(error => { if (error.status === 422) return '[Source preview unavailable for this deletion]'; throw error; }),
      git(cwd, ['show', '--format=', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-merges=first-parent', '--unified=3',
        file.deletedCommit, '--', file.path], { maxBuffer: 2 * 1024 * 1024 })
        .catch(error => { if (error.status === 422) return '[Diff preview exceeds the display limit]'; throw error; }),
      git(cwd, ['show', '--no-patch', '--format=%H%x00%aI', file.deletedCommit + '^']),
    ]);
    const allHistory = parseLog(raw);
    const history = allHistory.slice(0, MAX_HISTORY).map(({ changes, ...record }) => ({
      ...record, kind: changes.find(change => change.path === file.path)?.kind || 'M',
    }));
    const source = boundedText(contentRaw);
    const diff = boundedText(diffRaw);
    const evidenceHistory = history.map((record, index) => ({ record, index })).slice(0, 8);
    const introduction = history.findLastIndex(record => record.kind === 'A');
    if (introduction >= 8) evidenceHistory[7] = { record: history[introduction], index: introduction };
    const evidence = evidenceHistory.map(({ record, index }) => ({
      id: 'commit-' + (index + 1), title: record.subject, sha: record.sha, date: record.date,
      kind: 'commit', text: `Commit: ${record.shortSha}\nDate: ${record.date}\nChange: ${record.kind}\nSubject: ${record.subject}`,
    }));
    const [parentSha, parentDate] = parentRaw.trimEnd().split('\0');
    if (source.text && !source.text.startsWith('[Binary file') && !source.text.startsWith('[Source preview')) {
      evidence.push({ id: 'source', title: 'Last source before removal', sha: parentSha,
        date: parentDate, kind: 'source', text: source.text.slice(0, 5500) });
    }
    if (diff.text && !diff.text.startsWith('[Diff preview')) {
      evidence.push({ id: 'deletion', title: 'The deletion diff', sha: file.deletedCommit,
        date: file.deletedAt, kind: 'diff', text: diff.text.slice(0, 3500) });
    }
    const additions = history.filter(record => record.kind === 'A');
    const result = {
      file, stats: { addedAt: additions.at(-1)?.date || null, removedAt: file.deletedAt, revisionCount: history.length },
      history, lastContent: source.text, diff: diff.text, evidence,
      truncated: source.truncated || diff.truncated || allHistory.length > MAX_HISTORY ||
        contentRaw.startsWith('[Source preview unavailable') || diffRaw.startsWith('[Diff preview exceeds'),
    };
    entry.details.set(fileId, result);
    return result;
  }
}

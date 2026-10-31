import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, RepositoryStore } from './lib/git.mjs';
import { generateStory, getStatus, localBaseUrl } from './lib/ollama.mjs';
import { ensureSampleRepo } from './scripts/create-sample.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };

function send(response, status, value, type = 'application/json') {
  if (response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : ''),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
  });
  response.end(type === 'application/json' ? JSON.stringify(value) : value);
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AppError('Use application/json.', 415);
  }
  if (Number(request.headers['content-length']) > 16_384) throw new AppError('Request is too large.', 413);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new AppError('Request is too large.', 413);
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('Send valid JSON.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new AppError('Send a JSON object.');
  return result;
}

export function createServer({
  ollamaBaseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434', fetchImpl = fetch,
  sampleRepoPath, publicDir = path.join(ROOT, 'public'),
} = {}) {
  const baseUrl = localBaseUrl(ollamaBaseUrl).href;
  const store = new RepositoryStore();
  let samplePromise;
  let busy = false;
  const server = http.createServer(async (request, response) => {
    const controller = new AbortController();
    request.on('aborted', () => controller.abort());
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const host = request.headers.host;
      if (!host || /[\s/@\\#?]/.test(host)) throw new AppError('Local access only.', 403);
      let origin;
      try { origin = new URL('http://' + host); } catch { throw new AppError('Local access only.', 403); }
      if (!LOOPBACK.has(origin.hostname)) throw new AppError('Local access only.', 403);
      if ((request.headers.origin && request.headers.origin !== origin.origin) ||
          request.headers['sec-fetch-site'] === 'cross-site') {
        throw new AppError('Open The Last Commit directly on this computer.', 403);
      }
      const target = new URL(request.url, origin);
      if (target.origin !== origin.origin) throw new AppError('Local access only.', 403);
      if (request.method === 'GET' && target.pathname === '/api/status') {
        return send(response, 200, await getStatus({ baseUrl, fetchImpl, signal: controller.signal }));
      }
      if (request.method === 'GET' && target.pathname === '/api/sample') {
        samplePromise ||= (async () => store.sample(sampleRepoPath || await ensureSampleRepo()))()
          .catch(error => { samplePromise = undefined; throw error; });
        return send(response, 200, await samplePromise);
      }
      if (request.method === 'POST' && target.pathname === '/api/repositories') {
        const body = await readJson(request);
        return send(response, 200, await store.open(body.path));
      }
      const match = target.pathname.match(/^\/api\/repositories\/([a-zA-Z0-9-]+)\/files\/([a-zA-Z0-9-]+)$/);
      if (request.method === 'GET' && match) {
        return send(response, 200, await store.details(match[1], match[2]));
      }
      if (request.method === 'POST' && target.pathname === '/api/story') {
        const body = await readJson(request);
        if (busy) throw new AppError('A story is already being summoned. Cancel it or wait a moment.', 429);
        if (typeof body.repositoryId !== 'string' || typeof body.fileId !== 'string') {
          throw new AppError('Choose a repository and file first.');
        }
        busy = true;
        try {
          const detail = await store.details(body.repositoryId, body.fileId);
          const result = await generateStory({ detail, model: body.model, baseUrl, fetchImpl, signal: controller.signal });
          return send(response, 200, result);
        } finally { busy = false; }
      }
      if (request.method === 'GET' && !target.pathname.startsWith('/api/')) {
        let relative;
        try { relative = decodeURIComponent(target.pathname); } catch { throw new AppError('Invalid path.'); }
        if (relative.includes('\0') || relative.includes('\\')) throw new AppError('Not found.', 404);
        const staticRoot = await realpath(publicDir);
        const assetPath = path.resolve(staticRoot, '.' + (relative === '/' ? '/index.html' : relative));
        if (!assetPath.startsWith(staticRoot + path.sep)) throw new AppError('Not found.', 404);
        let canonical;
        try { canonical = await realpath(assetPath); } catch { throw new AppError('Not found.', 404); }
        if (!canonical.startsWith(staticRoot + path.sep) || !MIME[path.extname(canonical)]) throw new AppError('Not found.', 404);
        return send(response, 200, await readFile(canonical), MIME[path.extname(canonical)]);
      }
      throw new AppError('Not found.', 404);
    } catch (error) {
      send(response, error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : 'Something went wrong while reading the local archive.' });
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3217);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createServer();
  server.listen(port, '127.0.0.1', () => console.log(`The Last Commit · http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}

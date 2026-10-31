const $ = (selector) => document.querySelector(selector);
const state = {
  repository: null, files: [], fileId: null, detail: null, view: 'timeline',
  details: new Map(), stories: new Map(), status: null, model: '',
  generation: null, selection: 0, loadingRepo: false,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  node.setAttribute('aria-hidden', 'true');
  node.append(use);
  return node;
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The archive could not be read.');
  return result;
}
function formatDate(value, compact = false) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(compact ? {} : { year: 'numeric' }), timeZone: 'UTC',
  });
}
function pathParts(path) {
  const split = path.lastIndexOf('/');
  return { name: path.slice(split + 1), directory: split < 0 ? '/' : path.slice(0, split) };
}
function cacheKey(repoId = state.repository?.id, fileId = state.fileId, model = state.model) {
  return `${repoId}:${fileId}:${model}`;
}
function setError(id, message = '') {
  const node = $(id);
  node.textContent = message;
  node.hidden = !message;
}
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function openDialog(id) { $(id).showModal(); }

async function refreshModels() {
  $('#refresh-model').disabled = true;
  $('#model-note').textContent = 'Checking connection…';
  try {
    state.status = await api('/api/status');
    const models = state.status.models || [];
    if (!models.some((m) => m.name === state.model)) state.model = state.status.model || models[0]?.name || '';
    $('#model-select').replaceChildren();
    for (const model of models) {
      const option = element('option', '', model.name);
      option.value = model.name;
      $('#model-select').append(option);
    }
    if (!models.length) $('#model-select').append(new Option('No local models found', ''));
    $('#model-select').value = state.model;
    $('#model-select').disabled = !models.length;
    $('#model-setup').hidden = state.status.available && models.length > 0;
    $('#model-note').textContent = state.status.available && models.length
      ? 'Ready. Stories run only when you ask.'
      : state.status.error || 'Ollama is not running. Browsing still works.';
  } catch {
    state.status = { available: false, models: [] };
    $('#model-note').textContent = 'Could not connect. Check that the app and Ollama are running.';
    $('#model-setup').hidden = false;
  } finally {
    $('#refresh-model').disabled = false;
    $('#model-dot').className = `status-dot ${state.status?.available ? 'online' : 'offline'}`;
    $('#model-label').textContent = state.status?.available ? state.model || 'Choose model' : 'Model offline';
    renderStory();
  }
}

async function loadRepository(path = null) {
  if (state.loadingRepo) return;
  state.loadingRepo = true;
  $('#open-submit').disabled = true;
  $('#load-example').disabled = true;
  $('#open-submit').textContent = 'Opening…';
  setError('#repo-error');
  try {
    const result = path
      ? await api('/api/repositories', { method: 'POST', body: JSON.stringify({ path }) })
      : await api('/api/sample');
    state.generation?.controller.abort();
    state.selection += 1;
    state.repository = result.repository;
    state.files = result.files;
    state.fileId = null;
    state.detail = null;
    state.details.clear();
    state.stories.clear();
    $('#repo-name').textContent = result.repository.name;
    $('#repo-name').title = result.repository.path;
    $('#repo-branch').textContent = result.repository.branch || 'HEAD';
    $('#sample-badge').hidden = !result.repository.sample;
    $('#file-count').textContent = String(result.files.length);
    $('#file-search').value = '';
    $('#scan-note').hidden = !result.limited;
    $('#scan-note').textContent = 'Showing a bounded scan of recent history.';
    $('#archive-footer').textContent = result.repository.sample ? 'EXAMPLE REPOSITORY' : 'LOCAL REPOSITORY';
    renderFiles();
    $('#open-dialog').close();
    if (result.files.length) await selectFile(result.files[0].id, false);
    else showEmpty('Nothing left behind.', 'No deleted files found in the scanned history.');
    $('#workspace').classList.remove('file-open');
  } catch (error) {
    setError('#repo-error', error.message);
    if (!state.repository) {
      showEmpty('The archive is quiet.', error.message);
      $('#file-list').replaceChildren(element('p', 'list-empty', 'Open a repository to begin.'));
    }
  } finally {
    state.loadingRepo = false;
    $('#open-submit').disabled = false;
    $('#load-example').disabled = false;
    $('#open-submit').replaceChildren(document.createTextNode('Open archive'), icon('arrow'));
  }
}

function renderFiles() {
  const query = $('#file-search').value.trim().toLowerCase();
  const files = state.files.filter((file) => file.path.toLowerCase().includes(query));
  const list = $('#file-list');
  list.replaceChildren();
  if (!files.length) {
    list.append(element('p', 'list-empty', query ? 'No matching files.' : 'No deleted files found.'));
    return;
  }
  for (const file of files) {
    const parts = pathParts(file.path);
    const button = element('button', `file-item${state.fileId === file.id ? ' selected' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(state.fileId === file.id));
    button.setAttribute('aria-label', `${file.path}, removed ${formatDate(file.deletedAt)}`);
    const info = element('span', 'file-info');
    info.append(element('div', 'file-item-name', parts.name), element('div', 'file-item-path', parts.directory));
    button.append(icon('file'), info, element('span', 'file-item-date', formatDate(file.deletedAt, true)));
    button.addEventListener('click', () => selectFile(file.id, true));
    list.append(button);
  }
}

function showEmpty(title, text = '') {
  $('#file-detail').hidden = true;
  const empty = $('#empty-state');
  empty.hidden = false;
  empty.replaceChildren(icon('mark'), element('h1', '', title));
  if (text) empty.append(element('p', '', text));
  if (!state.repository) {
    const open = element('button', 'button secondary', 'Open repository');
    open.addEventListener('click', () => openDialog('#open-dialog'));
    empty.append(open);
  }
}

async function selectFile(fileId, mobile = true) {
  const selection = ++state.selection;
  state.fileId = fileId;
  state.view = 'timeline';
  renderFiles();
  if (mobile) $('#workspace').classList.add('file-open');
  const key = `${state.repository.id}:${fileId}`;
  $('#detail').setAttribute('aria-busy', 'true');
  setError('#story-error');
  try {
    let detail = state.details.get(key);
    if (!detail) {
      detail = await api(`/api/repositories/${encodeURIComponent(state.repository.id)}/files/${encodeURIComponent(fileId)}`);
      state.details.set(key, detail);
    }
    if (selection !== state.selection) return;
    state.detail = detail;
    renderDetail();
    $('#detail').scrollTop = 0;
  } catch (error) {
    if (selection !== state.selection) return;
    state.detail = null;
    showEmpty('This history could not be read.', error.message);
  } finally {
    if (selection === state.selection) $('#detail').setAttribute('aria-busy', 'false');
  }
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) return;
  const { file, stats } = detail;
  const parts = pathParts(file.path);
  $('#empty-state').hidden = true;
  $('#file-detail').hidden = false;
  $('#file-directory').textContent = parts.directory;
  $('#file-name').textContent = parts.name;
  $('#first-date').textContent = formatDate(stats.addedAt);
  $('#last-date').textContent = formatDate(stats.removedAt || file.deletedAt);
  $('#revision-count').textContent = String(stats.revisionCount);
  $('#history-hash').textContent = file.deletedCommit.slice(0, 7);
  $('#timeline-count').textContent = String(detail.history.length);
  $('#code-path').textContent = file.path;
  $('#diff-sha').textContent = file.deletedCommit.slice(0, 7);
  $('#truncation-note').hidden = !detail.truncated;
  renderTimeline();
  renderCode($('#code-view'), detail.lastContent || '(No text content available.)');
  renderCode($('#diff-view'), detail.diff || '(No diff available.)', true);
  setView('timeline');
  renderStory();
}

function renderTimeline() {
  const timeline = $('#timeline');
  timeline.replaceChildren();
  for (let i = 0; i < state.detail.history.length; i++) {
    const commit = state.detail.history[i];
    const isRemoval = commit.sha === state.detail.file.deletedCommit;
    const isAddition = /^(added|add|A)$/i.test(commit.kind || '');
    const row = element('button', 'timeline-row');
    const point = element('span', `timeline-point${isRemoval ? ' removed' : isAddition ? ' added' : ''}`, isRemoval ? '−' : isAddition ? '+' : '·');
    point.setAttribute('aria-hidden', 'true');
    const content = element('span', 'timeline-content');
    const meta = element('span', 'timeline-meta');
    meta.append(element('code', '', commit.shortSha || commit.sha.slice(0, 7)), element('span', '', commit.author || 'Unknown author'));
    content.append(element('div', 'timeline-subject', commit.subject), meta);
    row.append(point, content, element('span', 'timeline-date', formatDate(commit.date, true)), icon('arrow'));
    row.setAttribute('aria-label', `${commit.subject}. View commit ${commit.shortSha || commit.sha.slice(0, 7)}`);
    row.addEventListener('click', () => {
      const source = state.detail.evidence.find((e) => e.sha === commit.sha && e.kind === 'commit')
        || state.detail.evidence.find((e) => e.sha === commit.sha)
        || { title: commit.subject, sha: commit.sha, date: commit.date, kind: 'commit', text: commit.subject };
      showEvidence(source);
    });
    timeline.append(row);
  }
}

function renderCode(target, text, diff = false) {
  target.replaceChildren();
  const fragment = document.createDocumentFragment();
  text.split('\n').forEach((line, index) => {
    const row = element('span', 'code-line');
    if (diff) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) row.classList.add('diff-header');
      else if (line.startsWith('+')) row.classList.add('diff-add');
      else if (line.startsWith('-')) row.classList.add('diff-remove');
      row.textContent = line || ' ';
    } else {
      row.append(element('span', 'line-number', String(index + 1)), document.createTextNode(line || ' '));
    }
    fragment.append(row);
  });
  target.append(fragment);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#${tab.dataset.view}-panel`).hidden = !selected;
  });
}

function renderStory() {
  if (!state.detail) return;
  const key = cacheKey();
  const result = state.stories.get(key);
  const generating = state.generation?.key === key;
  $('#story-idle').hidden = !!result || generating;
  $('#story-loading').hidden = !generating;
  $('#story-result').hidden = !result || generating;
  const connected = state.status?.available && state.model;
  $('#summon-button').disabled = !!state.generation || !state.status;
  $('#summon-button').replaceChildren(document.createTextNode(connected ? 'Summon story' : state.status ? 'Connect model' : 'Checking model…'), icon('arrow'));
  $('#story-hint').textContent = state.generation && !generating ? 'Another story is being read.' : 'This one is still here.';
  $('#regenerate-story').disabled = !!state.generation;
  if (result) {
    $('#story-lines').replaceChildren();
    result.story.lines.forEach((line, i) => {
      const paragraph = element('div', 'story-line');
      const sourceButton = element('button', 'source-link', String(i + 1));
      sourceButton.setAttribute('aria-label', `View source ${i + 1}`);
      sourceButton.title = 'View original evidence';
      sourceButton.addEventListener('click', () => {
        const source = state.detail.evidence.find((e) => e.id === line.sourceId);
        if (source) showEvidence(source, line.quote);
      });
      paragraph.append(document.createTextNode(line.text), sourceButton);
      $('#story-lines').append(paragraph);
    });
    $('#story-credit').textContent = `AI interpretation · ${result.model} · ${(result.durationMs / 1000).toFixed(1)}s`;
  }
}

async function summonStory() {
  if (state.generation || !state.detail) return;
  if (!state.status?.available || !state.model) {
    openDialog('#model-dialog');
    refreshModels();
    return;
  }
  const controller = new AbortController();
  const key = cacheKey();
  const generation = { controller, key, started: performance.now() };
  state.generation = generation;
  setError('#story-error');
  $('#story-progress').textContent = 'You can keep exploring.';
  renderStory();
  const timer = setInterval(() => {
    if (state.generation === generation) {
      $('#story-progress').textContent = `${Math.floor((performance.now() - generation.started) / 1000)}s · You can keep exploring.`;
    }
  }, 1000);
  try {
    const result = await api('/api/story', {
      method: 'POST', signal: controller.signal,
      body: JSON.stringify({ repositoryId: state.repository.id, fileId: state.fileId, model: state.model }),
    });
    state.stories.set(key, result);
    if (key !== cacheKey()) toast('The story is ready.');
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (key === cacheKey()) setError('#story-error', error.message);
      else toast(error.message);
    }
  } finally {
    clearInterval(timer);
    if (state.generation === generation) state.generation = null;
    renderStory();
  }
}

function showEvidence(source, quote = '') {
  $('#evidence-kind').textContent = source.kind || 'Source';
  $('#evidence-title').textContent = source.title;
  $('#evidence-meta').replaceChildren();
  if (source.sha) $('#evidence-meta').append(element('span', '', source.sha.slice(0, 12)));
  if (source.date) $('#evidence-meta').append(element('span', '', formatDate(source.date)));
  const pre = $('#evidence-text');
  pre.replaceChildren();
  const index = quote ? source.text.indexOf(quote) : -1;
  if (index >= 0) {
    pre.append(document.createTextNode(source.text.slice(0, index)), element('mark', '', quote), document.createTextNode(source.text.slice(index + quote.length)));
  } else pre.textContent = source.text;
  openDialog('#evidence-dialog');
  requestAnimationFrame(() => pre.querySelector('mark')?.scrollIntoView({ block: 'center' }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function exportExhibit() {
  if (!state.detail) return;
  const { file, stats, history, evidence, lastContent } = state.detail;
  const result = state.stories.get(cacheKey());
  const story = result ? `<section class="story"><h2>From the archive</h2>${result.story.lines.map((line) => `<p>${escapeHtml(line.text)} <a href="#source-${escapeHtml(line.sourceId)}">[${escapeHtml(line.sourceId)}]</a></p>`).join('')}<small>AI interpretation · ${escapeHtml(result.model)}. Source quotes were checked; interpretations may be wrong.</small></section>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(file.name || pathParts(file.path).name)} — The Last Commit</title><style>body{margin:0;background:#111512;color:#e5e9df;font:15px/1.8 system-ui,sans-serif}main{max-width:800px;margin:60px auto;padding:0 24px}h1{font-weight:500;line-height:1.3;overflow-wrap:anywhere}h2{font-size:16px;font-weight:500;margin-top:32px}small,.meta{color:#9ba496;font-size:12px}a{color:#c6d4ad}header{border-bottom:1px solid #3a4531;padding-bottom:25px}.story{background:#20271c;border:1px solid #3a4531;border-radius:8px;margin:28px 0;padding:0 24px 24px}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:#181d19;border:1px solid #2c332b;font:12px/1.7 ui-monospace,monospace}li{margin-bottom:14px}code{color:#c6d4ad}footer{margin:40px 0;color:#9ba496;font-size:12px}</style></head><body><main><header><small>THE LAST COMMIT · ${escapeHtml(state.repository.name)}${state.repository.sample ? ' · Fictional example' : ''}</small><h1>${escapeHtml(file.path)}</h1><div class="meta">${escapeHtml(formatDate(stats.addedAt))} — ${escapeHtml(formatDate(stats.removedAt))} · ${escapeHtml(stats.revisionCount)} revisions</div></header>${story}<h2>Timeline</h2><ol>${history.map((c) => `<li>${escapeHtml(c.subject)}<br><small>${escapeHtml(formatDate(c.date))} · ${escapeHtml(c.author)} · <code>${escapeHtml(c.sha)}</code></small></li>`).join('')}</ol><h2>Original evidence</h2>${evidence.map((s) => `<section id="source-${escapeHtml(s.id)}"><h3>${escapeHtml(s.id)} · ${escapeHtml(s.title)}</h3><small>${escapeHtml(s.sha || '')}</small><pre>${escapeHtml(s.text)}</pre></section>`).join('')}<details><summary>Last version</summary><pre>${escapeHtml(lastContent)}</pre></details><footer>Exported from a local, read-only archive.${state.detail.truncated ? ' History or source excerpts were limited.' : ''} This exhibit has no external dependencies.</footer></main></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = `${pathParts(file.path).name.replace(/[^a-z0-9._-]/gi, '-')}-exhibit.html`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Exhibit exported.');
}

$('#file-search').addEventListener('input', renderFiles);
$('#open-repo').addEventListener('click', () => { setError('#repo-error'); openDialog('#open-dialog'); });
$('#open-form').addEventListener('submit', (event) => { event.preventDefault(); loadRepository($('#repo-path').value.trim()); });
$('#load-example').addEventListener('click', () => loadRepository());
$('#help-button').addEventListener('click', () => openDialog('#help-dialog'));
$('#model-button').addEventListener('click', () => openDialog('#model-dialog'));
$('#refresh-model').addEventListener('click', refreshModels);
$('#model-select').addEventListener('change', () => {
  state.generation?.controller.abort();
  state.model = $('#model-select').value;
  $('#model-label').textContent = state.model;
  setError('#story-error');
  renderStory();
});
$('#summon-button').addEventListener('click', summonStory);
$('#regenerate-story').addEventListener('click', summonStory);
$('#cancel-story').addEventListener('click', () => state.generation?.controller.abort());
$('#export-button').addEventListener('click', exportExhibit);
$('#back-to-files').addEventListener('click', () => { $('#workspace').classList.remove('file-open'); $('#file-search').focus(); });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
document.querySelectorAll('[data-view]').forEach((tab) => {
  tab.addEventListener('click', () => setView(tab.dataset.view));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-view]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setView(tabs[next].dataset.view);
    tabs[next].focus();
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    $('#workspace').classList.remove('file-open');
    $('#file-search').focus();
  }
});

refreshModels();
loadRepository();

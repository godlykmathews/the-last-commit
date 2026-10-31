import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from '../lib/ollama.mjs';

const evidence = [
  { id: 'commit-1', kind: 'commit', text: 'Subject: Replace the session store with signed cookies so sessions survive restarts' },
  { id: 'source', kind: 'source', text: 'const sessions = new Map<string, Session>();\nexport function revokeSession(id: string) {\n  sessions.delete(id);\n}\n' },
];
const story = {
  lines: [
    { text: 'I kept sessions in memory.', sourceId: 'source', quote: 'const sessions = new Map<string, Session>();' },
    { text: 'Signed cookies replaced me so sessions could survive restarts.', sourceId: 'commit-1', quote: 'Replace the session store with signed cookies so sessions survive restarts' },
  ],
};

test('narration accepts exact supporting excerpts and rejects invented citation IDs', () => {
  assert.doesNotThrow(() => validateStory(story, evidence));
  const hallucinated = structuredClone(story);
  hallucinated.lines[0].sourceId = 'commit-that-does-not-exist';
  assert.throws(() => validateStory(hallucinated, evidence), error => error.status === 502);
});

test('a quote must occur in its cited record, not merely somewhere in the evidence', () => {
  const crossAttributed = structuredClone(story);
  crossAttributed.lines[0].sourceId = 'commit-1';
  assert.throws(() => validateStory(crossAttributed, evidence), error => error.status === 502);
  const invented = structuredClone(story);
  invented.lines[1].quote = 'Replaced after a security incident';
  assert.throws(() => validateStory(invented, evidence), error => error.status === 502);
});

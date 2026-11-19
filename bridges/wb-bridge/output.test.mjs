import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliOutput } from './output.mjs';

test('JSON transcript only returns final result, excluding prompts and reasoning', () => {
  const records = [
    { type: 'message', role: 'user', content: [{ text: 'private prompt' }] },
    { type: 'reasoning', rawContent: [{ text: 'private reasoning' }] },
    { type: 'result', subtype: 'success', is_error: false, result: '323' },
  ];
  assert.deepEqual(parseCliOutput(JSON.stringify(records, null, 2)), { text: '323', failed: false });
});
test('result objects and NDJSON are supported', () => {
  const record = { type: 'result', subtype: 'success', result: 'done' };
  assert.equal(parseCliOutput(JSON.stringify(record)).text, 'done');
  assert.equal(parseCliOutput('{}\n' + JSON.stringify(record)).text, 'done');
});
test('failed and incomplete transcripts cannot report success', () => {
  assert.equal(parseCliOutput('[{"type":"result","is_error":true,"result":"failed"}]').failed, true);
  assert.equal(parseCliOutput('[{"type":"message","role":"user"}]').failed, true);
  assert.equal(parseCliOutput('[{"type":').failed, true);
  assert.deepEqual(parseCliOutput(''), { text: '', failed: false });
  assert.equal(parseCliOutput('Authentication required').text, 'Authentication required');
});

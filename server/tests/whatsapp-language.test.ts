import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectLanguage, translateReply } from '../src/channels/languages.ts';

test('detectLanguage uses Devanagari as the Hindi signal', () => {
  assert.equal(detectLanguage('Watch recommendation'), 'en');
  assert.equal(detectLanguage('watch recommendation'), 'en');
  assert.equal(detectLanguage('\u0928\u092E\u0938\u094D\u0924\u0947'), 'hi');
});

test('translateReply replaces common summary phrases in Hindi', () => {
  assert.equal(translateReply('Best match', 'en'), 'Best match');
  assert.equal(translateReply('Best match', 'hi'), 'सबसे बेहतर मिलान');
  assert.equal(translateReply('Why this fits', 'hi'), 'यह आपके लिए सही है');
});

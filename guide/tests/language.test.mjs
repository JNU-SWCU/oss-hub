import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredLanguage, languagePath, rootDestination } from '../src/scripts/language.mjs';

const base = '/oss-hub';
const url = (path) => new URL(path, 'https://jnu-swcu.github.io');

test('Korean and English regional tags follow browser preference order', () => {
  assert.equal(preferredLanguage(null, ['ko-KR', 'en-US'], 'ko-KR'), 'ko');
  assert.equal(preferredLanguage(null, ['en-GB', 'ko'], 'en-GB'), 'en');
  assert.equal(preferredLanguage(null, ['fr-FR', 'KO-kr'], 'fr-FR'), 'ko');
});

test('navigator.language is the fallback when the language list has no supported tag', () => {
  assert.equal(preferredLanguage(null, undefined, 'ko-KR'), 'ko');
  assert.equal(preferredLanguage(null, [], 'en-US'), 'en');
  assert.equal(preferredLanguage(null, ['fr'], 'ko'), 'ko');
});

test('unsupported and missing browser languages fall back to English', () => {
  assert.equal(preferredLanguage(null, ['fr-FR', 'ja-JP'], 'fr-FR'), 'en');
  assert.equal(preferredLanguage(null, [], undefined), 'en');
});

test('only valid explicit preferences take precedence', () => {
  assert.equal(preferredLanguage('ko', ['en-US'], 'en-US'), 'ko');
  assert.equal(preferredLanguage('en', ['ko-KR'], 'ko-KR'), 'en');
  assert.equal(preferredLanguage('fr', ['ko-KR'], 'ko-KR'), 'ko');
});

test('only the unqualified root may automatically redirect', () => {
  for (const path of ['/oss-hub/en/', '/oss-hub/ko/', '/oss-hub/start/', '/oss-hub/student/', '/oss-hub/en/start/']) {
    assert.equal(rootDestination(url(path), 'en', ['en'], 'en', base), null);
    assert.equal(rootDestination(url(path), 'ko', ['ko'], 'ko', base), null);
  }
});

test('root preserves query and fragment and handles a missing trailing slash', () => {
  assert.equal(rootDestination(url('/oss-hub/?from=readme#roles-h'), null, ['en'], 'en', base), '/oss-hub/en/?from=readme#roles-h');
  assert.equal(rootDestination(url('/oss-hub'), null, ['ja'], 'ja', base), '/oss-hub/en/');
  assert.equal(rootDestination(url('/oss-hub/'), 'ko', ['en'], 'en', base), null);
});

test('switching languages keeps the same document and legacy Korean route', () => {
  assert.equal(languagePath('/oss-hub/student/submissions/', 'en', base), '/oss-hub/en/student/submissions/');
  assert.equal(languagePath('/oss-hub/en/student/submissions/', 'ko', base), '/oss-hub/student/submissions/');
  assert.equal(languagePath('/oss-hub/en/start', 'ko', base), '/oss-hub/start');
});

test('home switches use explicit stable language URLs, including storage-denied fallback', () => {
  for (const path of ['/oss-hub/', '/oss-hub/en/', '/oss-hub/ko/']) {
    assert.equal(languagePath(path, 'ko', base), '/oss-hub/ko/');
    assert.equal(languagePath(path, 'en', base), '/oss-hub/en/');
  }
  assert.equal(rootDestination(url('/oss-hub/ko/'), undefined, ['en'], 'en', base), null);
});

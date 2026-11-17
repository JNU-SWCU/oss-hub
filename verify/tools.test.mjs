import assert from 'node:assert/strict';
import test from 'node:test';
import { RULE_SOURCES, finding, formatFinding } from './tools.mjs';

test('every fixed rule id has an https source URL', () => {
  assert.ok(Object.keys(RULE_SOURCES).length > 0);
  for (const [rule, source] of Object.entries(RULE_SOURCES)) {
    assert.match(source, /^https:\/\/\S+$/, rule);
    assert.equal(finding(rule, 'm', 'v', 't').source, source);
  }
});

test('a finding without an https source URL cannot be created', () => {
  assert.throws(
    () => finding('unknown-rule', 'm', 'v', 't'),
    /no https source URL/,
  );
  assert.throws(
    () => finding('api-breaking', 'm', 'v', 't', 'verify/api.mjs'),
    /no https source URL/,
  );
  assert.match(
    formatFinding(finding('public-safe', 'm', 'v', 't')),
    /source: +https:\/\/github\.com\/JNU-SWCU\/oss-hub\/blob\/main\/\.github\/check-public-safe\.sh/,
  );
});

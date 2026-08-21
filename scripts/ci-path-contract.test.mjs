import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/ci.yml', import.meta.url),
);
const docsPath = fileURLToPath(
  new URL('../docs/rules/ci-path-verification.md', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const docs = readFileSync(docsPath, 'utf8');
const paths = [
  'scripts/check-member-authority-production*',
  'scripts/member-authority-production-report.mjs',
  'scripts/member-authority-jenkins-contract.test.mjs',
  'scripts/ci-path-contract.test.mjs',
  'scripts/jenkins/verify-member-authority-backfill*',
];
const tests = [
  'scripts/check-member-authority-production.test.mjs',
  'scripts/jenkins/verify-member-authority-backfill.test.mjs',
  'scripts/member-authority-jenkins-contract.test.mjs',
];

function validate(workflowSource, docsSource) {
  const backend = section(
    workflowSource,
    '            backend:',
    '            nginx:',
  );
  const jenkins = section(
    workflowSource,
    '            jenkins:',
    '            docker_context:',
  );
  for (const path of paths) {
    assert.match(backend, new RegExp(escapeRegex(`'${path}'`)));
    assert.match(jenkins, new RegExp(escapeRegex(`'${path}'`)));
    assert.match(docsSource, new RegExp(escapeRegex(path)));
  }
  const command = tests.join(' ');
  assert.match(
    workflowSource,
    new RegExp(escapeRegex(`node --test ${command}`)),
  );
  assert.match(
    workflowSource,
    /name: CI path 계약 검사\s+run: node --test scripts\/ci-path-contract\.test\.mjs/,
  );
}

test('member-authority paths select backend and Jenkins and run every contract test', () => {
  validate(workflow, docs);
});

test('path and required-test drift fail closed', () => {
  for (const path of paths) {
    assert.throws(() => validate(workflow.replaceAll(`'${path}'`, ''), docs));
    assert.throws(() => validate(workflow, docs.replaceAll(path, '')));
  }
  for (const testPath of tests) {
    assert.throws(() => validate(workflow.replace(testPath, ''), docs));
  }
});

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return source.slice(startIndex, endIndex);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

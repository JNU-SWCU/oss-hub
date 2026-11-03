import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

import { verifyPolicyProvenance } from './verify-policy-provenance.mjs';

const manifest = JSON.parse(
  readFileSync(
    new URL('../src/app/policies/version-manifest.json', import.meta.url),
    'utf8',
  ),
);

test('manifest resolves exact Git source blobs and matches current checkout', () => {
  const result = verifyPolicyProvenance(manifest);

  assert.equal(
    result.checkedSources,
    manifest.versions.reduce(
      (count, version) =>
        count +
        version.snapshots.length * Object.keys(manifest.documents).length,
      0,
    ),
  );
});

for (const [field, value, message] of [
  ['sha256', '0'.repeat(64), /SHA-256/],
  ['blob', '0'.repeat(40), /Git blob/],
  ['path', 'apps/frontend/src/app/policies/missing/page.tsx', /document path/],
]) {
  test(`manifest rejects an incorrect ${field}`, () => {
    const corrupted = structuredClone(manifest);
    corrupted.versions[0].snapshots[0].documents.PRIVACY_COLLECTION[field] =
      value;

    assert.throws(() => verifyPolicyProvenance(corrupted), message);
  });
}

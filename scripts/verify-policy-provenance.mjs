#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = new URL(
  '../apps/frontend/src/app/policies/version-manifest.json',
  import.meta.url,
);

export function verifyPolicyProvenance(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  const documentKeys = Object.keys(manifest.documents).sort();
  assert.equal(documentKeys.length, 3);
  assert.deepEqual(
    manifest.versions.map((entry) => entry.version),
    [manifest.currentVersion, ...manifest.compatibleVersions],
  );
  let checkedSources = 0;
  for (const version of manifest.versions) {
    assert.ok(version.snapshots.length > 0, `${version.version}: snapshots`);
    for (const snapshot of version.snapshots) {
      assert.match(snapshot.commit, /^[a-f0-9]{40}$/);
      assert.equal(typeof snapshot.matchesCheckout, 'boolean');
      assert.deepEqual(Object.keys(snapshot.documents).sort(), documentKeys);
      for (const [key, source] of Object.entries(snapshot.documents)) {
        assert.match(source.blob, /^[a-f0-9]{40}$/);
        assert.match(source.sha256, /^[a-f0-9]{64}$/);
        const route = manifest.documents[key];
        const expectedPath = snapshot.matchesCheckout
          ? `apps/frontend/src/app${route}/page.tsx`
          : `apps/frontend/public${route}/${version.version}.html`;
        assert.equal(source.path, expectedPath, 'document path');
        const bytes = execFileSync(
          'git',
          ['show', `${snapshot.commit}:${source.path}`],
          { cwd: repositoryRoot, env: { ...process.env, GIT_MASTER: '1' } },
        );
        const blob = createHash('sha1')
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex');
        assert.equal(blob, source.blob, `${source.path}: Git blob`);
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          source.sha256,
          `${source.path}: SHA-256`,
        );
        if (snapshot.matchesCheckout) {
          assert.equal(version.version, manifest.currentVersion);
          assert.deepEqual(
            readFileSync(resolve(repositoryRoot, source.path)),
            bytes,
            `${source.path}: checkout drift`,
          );
        }
        checkedSources += 1;
      }
    }
  }
  return { checkedSources, versions: manifest.versions.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(JSON.stringify(verifyPolicyProvenance(manifest)));
}

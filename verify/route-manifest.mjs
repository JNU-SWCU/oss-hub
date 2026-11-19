import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finding, git, isEntry, REPO_ROOT, run } from './tools.mjs';

async function atRevision(cwd, rev) {
  const temp = mkdtempSync(join(tmpdir(), 'route-manifest-'));
  try {
    const frontend = 'apps/frontend';
    const archive = await git(cwd, ['archive', rev, 'apps'], { raw: true });
    const extract = await run('tar', ['-xf', '-', '-C', temp], {
      input: archive,
    });
    if (extract.code !== 0) throw new Error(extract.stderr);
    symlinkSync(
      join(REPO_ROOT, frontend, 'node_modules'),
      join(temp, frontend, 'node_modules'),
      'dir',
    );
    const report = await run(
      process.execPath,
      [join(REPO_ROOT, 'verify/route-snapshot.mjs')],
      { cwd: join(temp, frontend) },
    );
    if (report.code !== 0) throw new Error(report.stderr);
    return JSON.parse(report.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function checkRouteManifest({ cwd, ranges }) {
  const findings = [];
  for (const { base, head } of ranges) {
    const ancestor = await git(cwd, ['merge-base', base, head]);
    const existing = new Set(await atRevision(cwd, ancestor));
    for (const violation of await atRevision(cwd, head)) {
      if (!existing.has(violation))
        findings.push(
          finding(
            'route-manifest',
            violation,
            head.slice(0, 9),
            violation.startsWith('unreferenced ')
              ? 'No code references this route. Link it from navigation, or reference the path where it is sent (email, API, redirect).'
              : `absent at ${ancestor.slice(0, 9)}`,
            'https://github.com/JNU-SWCU/oss-hub/issues/1963',
          ),
        );
    }
  }
  return findings;
}

if (isEntry(import.meta.url))
  console.log(
    (await atRevision(REPO_ROOT, process.argv[2] ?? 'HEAD')).join('\n'),
  );

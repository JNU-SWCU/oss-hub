import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const backendRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(backendRoot, '../..');
const manifest = JSON.parse(
  readFileSync(path.join(backendRoot, 'package.json'), 'utf8'),
) as { scripts: Record<string, string>; prisma: { seed: string } };

function tsNodeTargets(command: string): string[] {
  return Array.from(
    command.matchAll(/(?:^|[\s/])ts-node\s+([\w./-]+\.ts)(?=\s|$)/g),
    (match) => match[1],
  );
}

function expectSourceFile(target: string): void {
  const absolute = path.resolve(backendRoot, target);
  expect(absolute.startsWith(`${backendRoot}${path.sep}`)).toBe(true);
  expect(statSync(absolute).isFile()).toBe(true);
}

describe('workspace runtime entrypoint contracts', () => {
  it.each([
    'notifications:send-digest',
    'submissions:retry-file-cleanup',
    'storage:reconcile',
  ])('retains the %s CLI without executing it', (name) => {
    const command = manifest.scripts[name];
    expect(typeof command).toBe('string');
    const targets = tsNodeTargets(command);
    expect(targets).toHaveLength(1);
    for (const target of targets) expectSourceFile(target);
  });

  it('resolves every package ts-node target including the Prisma seed', () => {
    const commands = [...Object.values(manifest.scripts), manifest.prisma.seed];
    for (const command of commands) {
      if (!command.includes('ts-node')) continue;
      const targets = tsNodeTargets(command);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) expectSourceFile(target);
    }
    expect(tsNodeTargets(manifest.prisma.seed)).toEqual(['prisma/seed.ts']);
  });

  it('keeps API and isolated E2E composition roots in the Knip graph', () => {
    const config = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'knip.json'), 'utf8'),
    ) as { workspaces: Record<string, { entry: string[] }> };
    for (const target of [
      'src/main.ts',
      'test/e2e-program-authoring/main.ts',
      'prisma/seed.ts',
    ]) {
      expect(config.workspaces['apps/backend'].entry).toContain(target);
      expectSourceFile(target);
    }
  });

  it('keeps documented production CLI paths aligned with package entrypoints', () => {
    const runbook = readFileSync(
      path.join(repositoryRoot, 'docs/deploy/demo-runbook.md'),
      'utf8',
    );
    const targets = Array.from(
      runbook.matchAll(/\bdist\/(src\/[\w./-]+)\.js\b/g),
      (match) => `${match[1]}.ts`,
    );
    expect(targets.length).toBeGreaterThan(0);
    const cliTargets = Object.values(manifest.scripts).flatMap(tsNodeTargets);
    for (const target of targets) {
      expect(cliTargets).toContain(target);
      expectSourceFile(target);
    }
  });

  it('keeps the browser E2E stack on the registered digest and isolated server', () => {
    const stack = readFileSync(
      path.join(repositoryRoot, 'apps/frontend/e2e/run-stack.sh'),
      'utf8',
    );
    const digestTargets = tsNodeTargets(stack);
    expect(digestTargets).toEqual(
      tsNodeTargets(manifest.scripts['notifications:send-digest']),
    );
    for (const target of digestTargets) expectSourceFile(target);
    const serverTargets = Array.from(
      stack.matchAll(/\$backend_dist\/([\w./-]+)\.js\b/g),
      (match) => `${match[1]}.ts`,
    );
    expect(serverTargets).toEqual(['test/e2e-program-authoring/main.ts']);
    for (const target of serverTargets) expectSourceFile(target);
  });
});

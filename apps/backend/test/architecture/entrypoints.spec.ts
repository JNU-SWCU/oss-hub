import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const backendRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(backendRoot, '../..');
const manifest = requiredRecord(
  JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8')),
  'backend package manifest',
);
const scripts: Record<string, string> = {};
for (const [name, command] of Object.entries(
  requiredRecord(manifest.scripts, 'backend package scripts'),
)) {
  scripts[name] = requiredString(command, `backend script ${name}`);
}
const seed = requiredString(
  requiredRecord(manifest.prisma, 'backend Prisma configuration').seed,
  'Prisma seed command',
);

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function tsNodeTargets(command: string): string[] {
  return Array.from(
    command.matchAll(/(?:^|[\s/])ts-node\s+([\w./-]+\.ts)(?=\s|$)/g),
    (match) => requiredString(match[1], 'ts-node target capture'),
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
    const command = requiredString(scripts[name], `retained script ${name}`);
    const targets = tsNodeTargets(command);
    expect(targets).toHaveLength(1);
    for (const target of targets) expectSourceFile(target);
  });

  it('resolves every package ts-node target including the Prisma seed', () => {
    const commands = [...Object.values(scripts), seed];
    for (const command of commands) {
      if (!command.includes('ts-node')) continue;
      const targets = tsNodeTargets(command);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) expectSourceFile(target);
    }
    expect(tsNodeTargets(seed)).toEqual(['prisma/seed.ts']);
  });

  it('keeps API and isolated E2E composition roots in the Knip graph', () => {
    const config = requiredRecord(
      JSON.parse(readFileSync(path.join(repositoryRoot, 'knip.json'), 'utf8')),
      'Knip configuration',
    );
    const workspace = requiredRecord(
      requiredRecord(config.workspaces, 'Knip workspaces')['apps/backend'],
      'Knip backend workspace',
    );
    const entries: unknown = workspace.entry;
    if (!Array.isArray(entries)) {
      throw new Error('Knip backend entry must be an array');
    }
    const entryPaths = entries.map((entry: unknown) =>
      requiredString(entry, 'Knip backend entry path'),
    );
    for (const target of [
      'src/main.ts',
      'test/e2e-program-authoring/main.ts',
      'prisma/seed.ts',
    ]) {
      expect(entryPaths).toContain(target);
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
      (match) => `${requiredString(match[1], 'runbook target capture')}.ts`,
    );
    expect(targets.length).toBeGreaterThan(0);
    const cliTargets = Object.values(scripts).flatMap(tsNodeTargets);
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
      tsNodeTargets(
        requiredString(
          scripts['notifications:send-digest'],
          'retained notifications:send-digest script',
        ),
      ),
    );
    for (const target of digestTargets) expectSourceFile(target);
    const serverTargets = Array.from(
      stack.matchAll(/\$backend_dist\/([\w./-]+)\.js\b/g),
      (match) => `${requiredString(match[1], 'E2E server target capture')}.ts`,
    );
    expect(serverTargets).toEqual(['test/e2e-program-authoring/main.ts']);
    for (const target of serverTargets) expectSourceFile(target);
  });
});

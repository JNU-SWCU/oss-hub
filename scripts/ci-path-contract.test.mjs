import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/ci.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const backendOnlyPaths = [
  'scripts/member-authority-contract-contract*',
  'scripts/member-authority-contract-sources.mjs',
  'scripts/member-authority-contract-seed.mjs',
  'scripts/check-member-authority-contract.sh',
  'scripts/rehearse-member-authority-contract*',
  'scripts/rehearse-legacy-submission-migrations*',
  'scripts/rehearse-legacy-table-drop*',
  'scripts/prisma-comment-checksums.test.mjs',
];

const contractTests = [
  'scripts/member-authority-contract-contract.test.mjs',

  'scripts/prisma-migration-ledger.test.mjs',

  'scripts/rehearse-legacy-submission-migrations.test.mjs',

  'scripts/rehearse-legacy-table-drop.test.mjs',
];

const deploymentHardeningPaths = [
  'compose.yml',
  'apps/*/Dockerfile',
  'scripts/check-production-image-pins*.sh',
  'scripts/jenkins/validate-production-env*',
  'Jenkinsfile',
  'scripts/jenkins/validate-rollback-images*',
  'scripts/prune-deploy-backups*.sh',
];

const deploymentHardeningCommands = [
  'node --test scripts/jenkins/validate-production-env.test.mjs',
  'bash scripts/check-production-image-pins.test.sh',
  'bash scripts/check-production-image-pins.sh',
  "! grep -rlE 'oss-hub-release-c[d]|JENKINS[_]' .github/workflows",
  'bash scripts/jenkins/validate-rollback-images.test.sh',
  'bash scripts/prune-deploy-backups.test.sh',
];

const nginxSyntaxCommand =
  '$PWD/deploy/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro';

function validate(workflowSource) {
  const backend = section(
    workflowSource,
    '            backend:',
    '            nginx:',
  );
  for (const path of backendOnlyPaths) {
    assert.match(backend, new RegExp(escapeRegex(`'${path}'`)));
  }

  const migrationContractStep = section(
    workflowSource,
    '      - name: Prisma migration contract unit tests',
    '      - name: backend lint',
  );
  for (const testPath of contractTests) {
    assert.match(migrationContractStep, new RegExp(escapeRegex(testPath)));
  }

  assert.match(
    workflowSource,
    /name: contract on real sources\s+if: [^\n]+\s+run: bash scripts\/check-member-authority-contract\.sh/,
  );

  assert.match(
    workflowSource,
    /name: CI path 계약 검사\s+run: node --test scripts\/ci-path-contract\.test\.mjs/,
  );
}

function validateDeploymentHardening(workflowSource) {
  const jenkins = section(
    workflowSource,
    '            jenkins:',
    '            docker_context:',
  );
  for (const path of deploymentHardeningPaths) {
    assert.match(jenkins, new RegExp(escapeRegex(`'${path}'`)));
  }

  const deploymentStep = section(
    workflowSource,
    '      - name: Jenkins 배포 계약 회귀 테스트',
    '      - name: Docker build context 계약 회귀 테스트',
  );
  for (const command of deploymentHardeningCommands) {
    assert.match(deploymentStep, new RegExp(escapeRegex(command)));
  }
}

function validateNginxSyntaxCheck(workflowSource) {
  const nginxStep = section(
    workflowSource,
    '      - name: nginx ingress 계약 검사',
    '      - name: Jenkins 배포 계약 회귀 테스트',
  );
  assert.match(nginxStep, new RegExp(escapeRegex(nginxSyntaxCommand)));
  assert.match(nginxStep, /nginx -t/);
}

test('deployment hardening paths run production env and image contracts', () => {
  validateDeploymentHardening(workflow);
});

test('production nginx 설정으로 syntax 검사가 돈다', () => {
  validateNginxSyntaxCheck(workflow);
});

test('deployment hardening path and command drift fail closed', () => {
  for (const path of deploymentHardeningPaths) {
    assert.throws(() =>
      validateDeploymentHardening(workflow.replaceAll(`'${path}'`, '')),
    );
  }
  for (const command of deploymentHardeningCommands) {
    assert.throws(() =>
      validateDeploymentHardening(workflow.replace(command, '')),
    );
  }
});

test('nginx syntax 검사 command drift fail closed', () => {
  assert.throws(() =>
    validateNginxSyntaxCheck(workflow.replace(nginxSyntaxCommand, '')),
  );
});

test('contract paths select backend and run the contract test', () => {
  validate(workflow);

  const backend = section(
    workflow,
    '            backend:',
    '            nginx:',
  );
  for (const path of backendOnlyPaths) {
    assert.match(backend, new RegExp(escapeRegex(`'${path}'`)));
  }
});

test('contract path and required-test drift fail closed', () => {
  for (const path of backendOnlyPaths) {
    assert.throws(() => validate(workflow.replaceAll(`'${path}'`, '')));
  }
  for (const testPath of contractTests) {
    assert.throws(() => validate(workflow.replace(testPath, '')));
  }

  assert.throws(() =>
    validate(
      workflow.replace(
        'run: bash scripts/check-member-authority-contract.sh',
        '',
      ),
    ),
  );
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

const railsPaths = [
  'apps/backend/**',
  'apps/frontend/**',
  'eslint.shared.mjs',
  'eslint-rules/**',
  'knip.json',
  'scripts/prisma-enum-names.mjs',
  'scripts/prisma-enum-names.test.mjs',
  'scripts/ci-path-contract.test.mjs',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.github/workflows/**',
];
const scopes = [
  'frontend',
  'backend',
  'nginx',
  'production_compose',
  'jenkins',
  'docker_context',
  'shell_scripts',
  'node_scripts',
  'rails',
];
const railsTestCommand = 'node --test scripts/prisma-enum-names.test.mjs';
const knipStep = [
  'Knip 구조 검사',
  "        if: ${{ steps.scope.outputs.rails == 'true' }}",
  '        run: pnpm lint:structure',
  '',
  '',
].join('\n');
const rootManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

function workflowStep(source, name) {
  const step = source
    .split('      - name: ')
    .find((candidate) => candidate.startsWith(`${name}\n`));
  assert.ok(step, `Missing workflow step: ${name}`);
  return step;
}

function stepRun(step) {
  const match = step.match(/        run: \|\n((?:          .*\n|\n)+)/);
  assert.ok(match, 'Expected workflow shell block');
  return match[1].replace(/^          /gm, '');
}

function validateRails(source) {
  const triggers = section(source, 'on:\n', '\npermissions:');
  assert.doesNotMatch(triggers, /^\s+paths(?:-ignore)?:/m);
  const ci = section(source, '  ci:\n', '  public-safe:\n');
  assert.match(ci, /^    name: ci$/m);
  assert.match(
    ci,
    /^    if: github\.event_name == 'pull_request' \|\| github\.event_name == 'push'$/m,
  );
  assert.match(
    source,
    /^  public-safe:\n    name: public-safe\n    if: github\.event_name == 'pull_request'$/m,
  );
  const filters = section(ci, '            rails:\n', '\n\n');
  for (const path of railsPaths) {
    assert.ok(filters.includes(`- '${path}'`), path);
  }
  const scope = workflowStep(ci, '실행 스코프 결정');
  assert.ok(scope.includes('EVENT_NAME: ${{ github.event_name }}'));
  for (const name of scopes) {
    assert.ok(
      scope.includes(
        `${name.toUpperCase()}: \${{ steps.changes.outputs.${name} }}`,
      ),
      name,
    );
  }
  assert.doesNotMatch(stepRun(scope), /\$\{\{/);
  const contracts = workflowStep(ci, 'Rails 계약 테스트');
  assert.ok(
    contracts.includes("if: ${{ steps.scope.outputs.rails == 'true' }}"),
  );
  assert.ok(contracts.includes(`run: ${railsTestCommand}\n`));
  assert.equal(workflowStep(ci, 'Knip 구조 검사'), knipStep);
  assert.ok(
    workflowStep(ci, 'CI path 계약 검사').includes(
      'run: node --test scripts/ci-path-contract.test.mjs\n',
    ),
  );
  assert.doesNotMatch(workflowStep(ci, 'CI path 계약 검사'), /^        if:/m);
  const install = ci.indexOf('name: 의존성 설치');
  assert.ok(install >= 0);
  assert.ok(install < ci.indexOf('name: Rails 계약 테스트'));
  assert.ok(install < ci.indexOf('name: Knip 구조 검사'));
}

function validateRootLint(manifest) {
  assert.equal(manifest.scripts['lint:structure'], 'knip');
  assert.equal(manifest.scripts.lint, 'pnpm -r lint && pnpm lint:structure');
}

function runScope(event, selected) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  const output = join(directory, 'github-output');
  try {
    execFileSync(
      'bash',
      ['-c', stepRun(workflowStep(workflow, '실행 스코프 결정'))],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...Object.fromEntries(
            scopes.map((name) => [name.toUpperCase(), 'false']),
          ),
          ...selected,
          EVENT_NAME: event,
          GITHUB_OUTPUT: output,
        },
      },
    );
    return Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('rails workflow runs Knip as a plain check in the required ci job', () => {
  validateRails(workflow);
});

test('root lint runs app lint and plain Knip', () => {
  validateRootLint(rootManifest);
});

test('root lint script drift fails closed', () => {
  for (const [name, command] of [
    ['lint:structure', 'knip || true'],
    ['lint:structure', 'knip --no-exit-code'],
    ['lint', 'pnpm -r lint'],
  ]) {
    assert.throws(() =>
      validateRootLint({
        ...rootManifest,
        scripts: { ...rootManifest.scripts, [name]: command },
      }),
    );
  }
});

test('rails path and invocation mutations fail closed', () => {
  for (const path of railsPaths) {
    assert.throws(() => validateRails(workflow.replaceAll(`- '${path}'`, '')));
  }
  for (const command of [railsTestCommand, 'run: pnpm lint:structure']) {
    assert.throws(() => validateRails(workflow.replace(command, '')));
  }
  assert.throws(() =>
    validateRails(
      workflow.replace(
        'run: pnpm lint:structure',
        'run: pnpm lint:structure || true',
      ),
    ),
  );
  assert.throws(() =>
    validateRails(
      workflow.replace(
        "      - name: Knip 구조 검사\n        if: ${{ steps.scope.outputs.rails == 'true' }}\n",
        "      - name: Knip 구조 검사\n        if: ${{ github.event_name == 'push' }}\n",
      ),
    ),
  );
  assert.throws(() =>
    validateRails(workflow.replace('on:\n', 'on:\n  paths: []\n')),
  );
  assert.throws(() =>
    validateRails(workflow.replace('    name: ci\n', '    name: other\n')),
  );
});

test('actual workflow scope forces every lane on main push', () => {
  assert.deepEqual(
    runScope('push', {}),
    Object.fromEntries(scopes.map((name) => [name, 'true'])),
  );
});

test('actual workflow scope selects both apps for root rails without production lanes', () => {
  assert.deepEqual(
    runScope('pull_request', { RAILS: 'true' }),
    Object.fromEntries(
      scopes.map((name) => [
        name,
        ['frontend', 'backend', 'rails'].includes(name) ? 'true' : 'false',
      ]),
    ),
  );
});

test('actual workflow preserves unrelated and docs-only PR selection', () => {
  assert.deepEqual(
    runScope('pull_request', {}),
    Object.fromEntries(scopes.map((name) => [name, 'false'])),
  );
  assert.deepEqual(
    runScope('pull_request', { NGINX: 'true' }),
    Object.fromEntries(
      scopes.map((name) => [name, name === 'nginx' ? 'true' : 'false']),
    ),
  );
});

test('actual workflow selects frontend independently for design changes', () => {
  assert.deepEqual(
    runScope('pull_request', { FRONTEND: 'true' }),
    Object.fromEntries(
      scopes.map((name) => [name, name === 'frontend' ? 'true' : 'false']),
    ),
  );
});

function runScopeForPaths(paths) {
  const filters = section(workflow, '          filters: |\n', '\n\n');
  const selected = Object.fromEntries(
    scopes.map((name) => {
      const filter = filters
        .split(`            ${name}:\n`)[1]
        ?.split(/\n            [a-z_]+:/)[0];
      assert.ok(filter, `Missing path filter: ${name}`);
      const patterns = [...filter.matchAll(/- '([^']+)'/g)].map(
        (match) => match[1],
      );
      return [
        name.toUpperCase(),
        String(
          paths.some((path) =>
            patterns.some((pattern) => matchesGlob(path, pattern)),
          ),
        ),
      ];
    }),
  );
  return runScope('pull_request', selected);
}

for (const [path, selected] of [
  ['scripts/jenkins/release-behavior.test.mjs', ['jenkins']],
  ['scripts/jenkins/runtime.sh', ['jenkins', 'shell_scripts']],
  ['package.json', ['frontend', 'backend', 'rails']],
  ['pnpm-lock.yaml', ['frontend', 'backend', 'rails']],
  ['apps/frontend/package.json', ['frontend', 'backend', 'rails']],
  ['.design-sync/config.json', ['frontend']],
  ['scripts/design-sync-contract.test.mjs', ['frontend', 'node_scripts']],
  ['scripts/prisma-comment-checksums.test.mjs', ['backend', 'node_scripts']],
  ['docs/reports/backend-inspection-2026-10.md', []],
  ['README.md', []],
  ['.github/workflows/ci.yml', scopes],
]) {
  test(`actual workflow scope selects expected PR lanes for ${path}`, () => {
    assert.deepEqual(
      runScopeForPaths([path]),
      Object.fromEntries(
        scopes.map((name) => [name, String(selected.includes(name))]),
      ),
    );
  });
}

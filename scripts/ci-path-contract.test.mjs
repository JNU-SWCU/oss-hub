import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/ci.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const paths = [
  'scripts/check-member-authority-production*',
  'scripts/member-authority-production-report.mjs',
  'scripts/member-authority-jenkins-contract.test.mjs',
  'scripts/ci-path-contract.test.mjs',
];
const tests = [
  'scripts/check-member-authority-production.test.mjs',
  'scripts/member-authority-jenkins-contract.test.mjs',
];

const backendOnlyPaths = [
  'scripts/member-authority-contract-contract*',
  'scripts/member-authority-contract-sources.mjs',
  'scripts/member-authority-contract-seed.mjs',
  'scripts/check-member-authority-contract.sh',
  'scripts/rehearse-member-authority-contract*',
  'scripts/rehearse-legacy-submission-migrations*',
  'scripts/rehearse-legacy-table-drop*',
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
  'scripts/check-jenkinsfile.sh',
  'scripts/check-jenkinsfile.test.sh',
  'scripts/check-jenkinsfile.test.mjs',
  'scripts/jenkins/validate-rollback-images*',
  'scripts/prune-deploy-backups*.sh',
];

const deploymentHardeningCommands = [
  'node --test scripts/jenkins/validate-production-env.test.mjs',
  'bash scripts/check-production-image-pins.test.sh',
  'bash scripts/check-production-image-pins.sh',
  'node --test scripts/check-jenkinsfile.test.mjs',
  'bash scripts/check-jenkinsfile.test.sh',
  'bash scripts/check-jenkinsfile.sh Jenkinsfile',
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
  const jenkins = section(
    workflowSource,
    '            jenkins:',
    '            docker_context:',
  );
  for (const path of paths) {
    assert.match(backend, new RegExp(escapeRegex(`'${path}'`)));
    assert.match(jenkins, new RegExp(escapeRegex(`'${path}'`)));
  }
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

test('member-authority paths select backend and Jenkins and run every contract test', () => {
  validate(workflow);
});

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

test('path and required-test drift fail closed', () => {
  for (const path of paths) {
    assert.throws(() => validate(workflow.replaceAll(`'${path}'`, '')));
  }
  for (const testPath of tests) {
    assert.throws(() => validate(workflow.replace(testPath, '')));
  }
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

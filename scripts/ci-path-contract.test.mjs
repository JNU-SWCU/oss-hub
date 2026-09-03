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
];
const tests = [
  'scripts/check-member-authority-production.test.mjs',
  'scripts/member-authority-jenkins-contract.test.mjs',
];

/**
 * 계약(contract) 산출물은 backend scope에만 든다.
 *
 * 위의 `paths`가 backend와 Jenkins를 동시에 고르는 것과 갈라진다 — 저쪽은
 * 운영 backfill처럼 배포 파이프라인이 함께 소유하는 계약이고, 계약 스키마·
 * 마이그레이션·리허설은 backend 검증만이 소유한다. 그래서 집합을 섞지 않고
 * 따로 둔다 — 섞으면 계약 파일을 고치는 PR이 Jenkins scope까지 끌어온다.
 */
const backendOnlyPaths = [
  'scripts/member-authority-contract-contract*',
  'scripts/member-authority-contract-sources.mjs',
  'scripts/member-authority-contract-seed.mjs',
  'scripts/check-member-authority-contract.sh',
  'scripts/rehearse-member-authority-contract*',
];

/** 계약 정적 계약은 Prisma migration contract 단계가 required CI에서 돌린다. */
const contractTests = [
  'scripts/member-authority-contract-contract.test.mjs',
  // 배포된 마이그레이션을 같은 타임스탬프로 갈아끼우는 것을 거절하는 원장 계약.
  'scripts/prisma-migration-ledger.test.mjs',
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

const localNginxPath = 'deploy/nginx-local/**';
const localNginxCommand =
  '$PWD/deploy/nginx-local/nginx.conf:/etc/nginx/conf.d/default.conf:ro';

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
  for (const path of backendOnlyPaths) {
    assert.match(backend, new RegExp(escapeRegex(`'${path}'`)));
    assert.match(docsSource, new RegExp(escapeRegex(path)));
  }

  // 계약 테스트는 그 이름이 workflow 어딘가에 있는 것으로는 부족하고,
  // backend scope가 골랐을 때 실제로 도는 단계 안에 있어야 한다.
  const migrationContractStep = section(
    workflowSource,
    '      - name: Prisma migration contract unit tests',
    '      - name: backend lint',
  );
  for (const testPath of contractTests) {
    assert.match(migrationContractStep, new RegExp(escapeRegex(testPath)));
  }

  // 검사기를 **저장소의 실제 파일**에 돌리는 단계가 있어야 한다. 단위 테스트만
  // 돌리면 검사기가 합성 문자열에 대해 올바르다는 것만 알 뿐, 이 저장소가
  // 규칙을 지키는지는 아무도 확인하지 않는다.
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

function validateDeploymentHardening(workflowSource, docsSource) {
  const jenkins = section(
    workflowSource,
    '            jenkins:',
    '            docker_context:',
  );
  for (const path of deploymentHardeningPaths) {
    assert.match(jenkins, new RegExp(escapeRegex(`'${path}'`)));
    assert.match(docsSource, new RegExp(escapeRegex(path)));
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

function validateLocalNginx(workflowSource, docsSource) {
  const nginx = section(
    workflowSource,
    '            nginx:',
    '            production_compose:',
  );
  const productionCompose = section(
    workflowSource,
    '            production_compose:',
    '            jenkins:',
  );
  assert.match(nginx, new RegExp(escapeRegex(`'${localNginxPath}'`)));
  assert.match(
    productionCompose,
    new RegExp(escapeRegex(`'${localNginxPath}'`)),
  );
  assert.match(docsSource, new RegExp(escapeRegex(localNginxPath)));

  const nginxStep = section(
    workflowSource,
    '      - name: nginx ingress 계약 검사',
    '      - name: Jenkins 배포 계약 회귀 테스트',
  );
  assert.match(nginxStep, new RegExp(escapeRegex(localNginxCommand)));
  assert.match(nginxStep, /nginx -t/);
}

test('member-authority paths select backend and Jenkins and run every contract test', () => {
  validate(workflow, docs);
});

test('deployment hardening paths run production env and image contracts', () => {
  validateDeploymentHardening(workflow, docs);
});

test('local nginx path selects syntax and local-compose validation', () => {
  validateLocalNginx(workflow, docs);
});

test('deployment hardening path and command drift fail closed', () => {
  for (const path of deploymentHardeningPaths) {
    assert.throws(() =>
      validateDeploymentHardening(workflow.replaceAll(`'${path}'`, ''), docs),
    );
    assert.throws(() =>
      validateDeploymentHardening(workflow, docs.replaceAll(path, '')),
    );
  }
  for (const command of deploymentHardeningCommands) {
    assert.throws(() =>
      validateDeploymentHardening(workflow.replace(command, ''), docs),
    );
  }
});

test('local nginx path and syntax command drift fail closed', () => {
  assert.throws(() =>
    validateLocalNginx(workflow.replaceAll(`'${localNginxPath}'`, ''), docs),
  );
  assert.throws(() =>
    validateLocalNginx(workflow, docs.replaceAll(localNginxPath, '')),
  );
  assert.throws(() =>
    validateLocalNginx(workflow.replace(localNginxCommand, ''), docs),
  );
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

test('contract paths select backend and run the contract test', () => {
  validate(workflow, docs);

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
    // filter 배선이 사라지면 계약 파일만 고친 PR이 backend 검증 없이 통과한다.
    assert.throws(() => validate(workflow.replaceAll(`'${path}'`, ''), docs));
    assert.throws(() => validate(workflow, docs.replaceAll(path, '')));
  }
  for (const testPath of contractTests) {
    // 단계에서 테스트가 빠지면 정적 계약이 required CI에서 사라진다.
    assert.throws(() => validate(workflow.replace(testPath, ''), docs));
  }
  // 실파일 검사 단계를 걷어내는 것도 막는다.
  assert.throws(() =>
    validate(
      workflow.replace(
        'run: bash scripts/check-member-authority-contract.sh',
        '',
      ),
      docs,
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

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { returnTypeAllowlist } from '../apps/backend/eslint-rules/controller-explicit-return.mjs';
import {
  dtoSuffixes,
  rootSuffixes,
} from '../apps/backend/eslint-rules/file-name-convention.mjs';

const docPath = (name) =>
  fileURLToPath(new URL(`../docs/decisions/${name}`, import.meta.url));
const koPath =
  process.env.ADR003_KO_PATH ?? docPath('ADR-003-backend-architecture.md');
const enPath =
  process.env.ADR003_EN_PATH ?? docPath('ADR-003-backend-architecture.en.md');

const readContract = (path) => {
  const match = readFileSync(path, 'utf8').match(
    /```json adr-003-contract\n([\s\S]*?)\n```\s*$/,
  );
  assert.ok(match, `${path} must end with a json adr-003-contract block`);
  return JSON.parse(match[1]);
};

test('ko and en ADR-003 contracts are identical', () => {
  assert.deepEqual(readContract(enPath), readContract(koPath));
});

test('ADR-003 contract lists the planned modules', () => {
  for (const path of [koPath, enPath]) {
    const contract = readContract(path);
    assert.deepEqual(contract.modules, [
      'auth',
      'users',
      'programs',
      'ranking',
      'student',
      'staff',
      'admin',
      'notifications',
      'github',
      'platform',
    ]);
    assert.equal(contract.rootSuffixes.length, 14);
    assert.deepEqual(contract.dtoSuffixes, [
      '-request.dto.ts',
      '-response.dto.ts',
    ]);
    assert.deepEqual(contract.crossAppExceptions, []);
  }
});

const backendRoot = fileURLToPath(new URL('../apps/backend/', import.meta.url));

test('ADR-003 modules are exactly the backend src folders', () => {
  const folders = readdirSync(`${backendRoot}src`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(folders, [...readContract(koPath).modules].sort());
});

test('ADR-003 prints every controller return type allowlist route', () => {
  for (const path of [koPath, enPath]) {
    const text = readFileSync(path, 'utf8');
    for (const route of returnTypeAllowlist) {
      assert.ok(text.includes(`\`${route}\``), `${path} must list ${route}`);
    }
  }
});

test('ADR-003 suffix lists match the file name rule', () => {
  const contract = readContract(koPath);
  assert.deepEqual(contract.rootSuffixes, rootSuffixes);
  assert.deepEqual(contract.dtoSuffixes, dtoSuffixes);
});

test('every ADR-003 rule id is an error in the backend ESLint config', () => {
  const severities = new Map();
  for (const file of [
    'src/programs/programs.controller.ts',
    'src/programs/dto/x-request.dto.ts',
    'src/programs/dto/x-response.dto.ts',
  ]) {
    const config = JSON.parse(
      execFileSync(
        `${backendRoot}node_modules/.bin/eslint`,
        ['--print-config', file],
        { cwd: backendRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      ),
    );
    for (const [id, setting] of Object.entries(config.rules)) {
      if ([setting].flat()[0] === 2) severities.set(id, 2);
    }
  }
  for (const id of readContract(koPath).rules) {
    assert.equal(severities.get(id), 2, `${id} must be registered as error`);
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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

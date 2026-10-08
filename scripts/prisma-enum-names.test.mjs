import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { parsePrismaEnumNames, prismaEnumNames } from './prisma-enum-names.mjs';

test('enum 선언만 이름순으로 추출하고 선언 순서에 의존하지 않는다', () => {
  const declarations = [
    'enum Zebra { FIRST SECOND }',
    'model User { id String @id }',
    'enum Alpha_2\n{ VALUE }',
    'generator client { provider = "prisma-client-js" }',
  ];

  assert.deepEqual(parsePrismaEnumNames(declarations.join('\n')), [
    'Alpha_2',
    'Zebra',
  ]);
  assert.deepEqual(parsePrismaEnumNames(declarations.reverse().join('\r\n')), [
    'Alpha_2',
    'Zebra',
  ]);
});

test('줄 주석과 문서 주석과 블록 주석의 enum은 허용하지 않는다', () => {
  const schema = `
// enum LineComment { VALUE }
/// enum Documentation { VALUE }
/*
enum BlockComment { VALUE }
*/
/* enum InlineComment { VALUE } */ enum Actual { VALUE }
enum /* enum BetweenTokens { VALUE } */ Other { VALUE }
`;

  assert.deepEqual(parsePrismaEnumNames(schema), ['Actual', 'Other']);
});

test('문자열의 enum과 주석 구분자는 선언으로 해석하지 않는다', () => {
  const schema = String.raw`
model Example {
  id String @id
  text String @default("enum NotAnEnum { VALUE }")
  url String @default("https://example.invalid/*literal*/")
  quote String @default("\" // enum Quoted { VALUE }")
}
enum Actual { VALUE @map("/* enum Mapped { VALUE } */") }
`;

  assert.deepEqual(parsePrismaEnumNames(schema), ['Actual']);
  assert.deepEqual(parsePrismaEnumNames('model Empty { id String @id }'), []);
});

test('실제 스키마의 모든 enum 선언을 포함하고 DB 접근 심볼은 제외한다', () => {
  const schema = readFileSync(
    new URL('../apps/backend/prisma/schema.prisma', import.meta.url),
    'utf8',
  );
  const declaredNames = schema
    .split(/\r?\n/)
    .filter((line) => line.startsWith('enum '))
    .map((line) => line.split(/\s+/)[1])
    .sort();

  assert.ok(declaredNames.length > 0);
  assert.deepEqual(prismaEnumNames, declaredNames);
  for (const name of [
    'Prisma',
    'PrismaClient',
    'PrismaPromise',
    'User',
    'Program',
  ]) {
    assert.ok(!prismaEnumNames.includes(name), name);
  }
});

test('생성된 backend Prisma client의 enum 집합과 정확히 일치한다', () => {
  const require = createRequire(
    new URL('../apps/backend/package.json', import.meta.url),
  );
  const { $Enums } = require('@prisma/client');

  assert.deepEqual(prismaEnumNames, Object.keys($Enums).sort());
});

test('client가 없는 별도 디렉터리에서도 작업 경로와 무관하게 로드한다', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'prisma-enum-names-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps/backend/prisma'), { recursive: true });
  const modulePath = join(root, 'scripts/prisma-enum-names.mjs');
  copyFileSync(new URL('./prisma-enum-names.mjs', import.meta.url), modulePath);
  writeFileSync(
    join(root, 'apps/backend/prisma/schema.prisma'),
    'enum Synthetic { VALUE }\n',
  );

  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const { prismaEnumNames } = await import(${JSON.stringify(pathToFileURL(modulePath).href)}); process.stdout.write(JSON.stringify(prismaEnumNames));`,
    ],
    { cwd: tmpdir(), encoding: 'utf8' },
  );

  assert.deepEqual(JSON.parse(output), ['Synthetic']);
});

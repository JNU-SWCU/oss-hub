import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const backendRoot = path.resolve(__dirname, '../..');

const runner = `
import { createRequire } from 'node:module';
import path from 'node:path';
const [backendRoot, cases] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { ESLint } = require('eslint');
const eslint = new ESLint({
  cwd: backendRoot,
  overrideConfigFile: path.join(backendRoot, 'eslint.query-lint.config.mjs'),
});
const output = [];
for (const { code, file } of JSON.parse(cases)) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(backendRoot, file),
    warnIgnored: false,
  });
  output.push((result?.messages ?? []).map((message) => message.ruleId));
}
process.stdout.write(JSON.stringify(output));
`;

const cases: { code: string; file: string; ruleIds: string[] }[] = [
  {
    code: 'class A { list() { return this.prisma.user.findMany({ where: {} }); } }',
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/find-many-take'],
  },
  {
    code: 'class A { list(args) { return this.prisma.user.findMany(args); } }',
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/find-many-take'],
  },
  {
    code: 'class A { list(take) { return this.prisma.user.findMany({ take, where: {} }); } }',
    file: 'src/sample.repository.ts',
    ruleIds: [],
  },
  {
    code: "class A { read() { return this.prisma.team.findUnique({ where: { id: 'a' }, select: { members: { select: { userId: true } } } }); } }",
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/nested-relation-take'],
  },
  {
    code: "class A { read() { return this.prisma.team.findUnique({ where: { id: 'a' }, include: { members: true } }); } }",
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/nested-relation-take'],
  },
  {
    code: "import { MEMBERS } from './members'; const SELECT = { members: MEMBERS } satisfies Prisma.TeamSelect;",
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/nested-relation-take'],
  },
  {
    code: 'const MEMBERS = { take: 101, select: { userId: true } }; const SELECT = { members: { ...MEMBERS }, program: { select: { name: true } }, _count: { select: { members: true } } } as const satisfies Prisma.TeamSelect;',
    file: 'src/sample.repository.ts',
    ruleIds: [],
  },
  {
    code: 'class A { read(id) { return this.prisma.$queryRaw`SELECT "id" FROM "Requirement" WHERE "milestoneId" = ${id} FOR UPDATE`; } }',
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/raw-select-limit'],
  },
  {
    code: 'class A { read(id) { return this.prisma.$queryRaw(Prisma.sql`SELECT count(*) FROM "Team" WHERE "programId" = ${id}`); } }',
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/raw-select-limit'],
  },
  {
    code: 'function rows() { return Prisma.sql`SELECT "id" FROM "Team"`; } class A { read() { return this.prisma.$queryRaw(rows()); } }',
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/raw-select-limit'],
  },
  {
    code: 'class A { read(sql) { return this.prisma.$queryRaw(sql); } }',
    file: 'src/sample.repository.ts',
    ruleIds: ['prisma/raw-select-limit'],
  },
  {
    code: 'class A { read(id, take) { return Promise.all([this.prisma.$queryRaw`SELECT "id" FROM "Requirement" WHERE "milestoneId" = ${id} ORDER BY "id" LIMIT ${take} FOR UPDATE`, this.prisma.$queryRaw`SELECT count(*) FROM (SELECT 1 FROM "Team" LIMIT 5) t LIMIT 1`, this.prisma.$queryRaw`UPDATE "Team" SET "name" = ${id} RETURNING "id"`]); } }',
    file: 'src/sample.repository.ts',
    ruleIds: [],
  },
  {
    code: 'async function load(ids) { for (const id of ids) { await read(id); } }',
    file: 'src/sample.service.ts',
    ruleIds: ['no-await-in-loop'],
  },
  {
    code: 'class A { list() { return this.prisma.user.findMany(); } }',
    file: 'src/sample.repository.spec.ts',
    ruleIds: [],
  },
];

describe('query lint ESLint config', () => {
  let actual: string[][];

  beforeAll(() => {
    actual = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          runner,
          backendRoot,
          JSON.stringify(cases.map(({ code, file }) => ({ code, file }))),
        ],
        { encoding: 'utf8' },
      ),
    ) as string[][];
  }, 30000);

  it.each(cases.map((entry, index) => ({ ...entry, index })))(
    'reports $ruleIds for $code in $file',
    ({ index, ruleIds }) => {
      expect(actual[index]).toEqual(ruleIds);
    },
  );
});

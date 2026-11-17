import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const backendRoot = path.resolve(__dirname, '../..');

const runner = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [backendRoot, cases] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { ESLint } = require('eslint');
const tseslint = require('typescript-eslint');
const { noAwaitInLoop } = await import(pathToFileURL(path.join(backendRoot, 'eslint-rules/no-await-in-loop.mjs')).href);
const output = [];
for (const { code, allowed } of JSON.parse(cases)) {
  const eslint = new ESLint({
    cwd: backendRoot,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { loops: { rules: { 'no-await-in-loop': noAwaitInLoop } } },
      rules: { 'loops/no-await-in-loop': ['error', { 'src/sample.ts': allowed }] },
    }],
  });
  const [result] = await eslint.lintText(code, { filePath: path.join(backendRoot, 'src/sample.ts') });
  output.push(result.messages.map((message) => message.messageId ?? message.message));
}
process.stdout.write(JSON.stringify(output));
`;

const loop = 'for (const id of ids) { await read(id); }';
const reason = { 'Sample.load': 'fixed two-pass loop' };

const cases: {
  code: string;
  allowed: Record<string, string>;
  messageIds: string[];
}[] = [
  {
    code: `class Sample { async load(ids) { ${loop} } }`,
    allowed: {},
    messageIds: ['unexpectedAwait'],
  },
  {
    code: `class Sample { async load(ids) { ${loop} } }`,
    allowed: reason,
    messageIds: [],
  },
  {
    code: `class Sample { async other(ids) { ${loop} } }`,
    allowed: reason,
    messageIds: ['staleEntry', 'unexpectedAwait'],
  },
  {
    code: `class Sample { load = async (ids) => { ${loop} }; }`,
    allowed: reason,
    messageIds: [],
  },
  {
    code: `async function load(ids) { ${loop} }`,
    allowed: { load: 'module function' },
    messageIds: [],
  },
  {
    code: 'class Sample { async load(ids) { await Promise.all(ids.map(read)); } }',
    allowed: reason,
    messageIds: ['staleEntry'],
  },
];

describe('loops/no-await-in-loop', () => {
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
          JSON.stringify(cases.map(({ code, allowed }) => ({ code, allowed }))),
        ],
        { encoding: 'utf8' },
      ),
    ) as string[][];
  }, 30000);

  it.each(cases.map((entry, index) => ({ ...entry, index })))(
    'reports $messageIds for $code',
    ({ index, messageIds }) => {
      expect(actual[index]).toEqual(messageIds);
    },
  );
});

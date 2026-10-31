import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const backendRoot = path.resolve(__dirname, '../..');

const runner = `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [backendRoot, sources] = process.argv.slice(1);
const require = createRequire(path.join(backendRoot, 'package.json'));
const { ESLint } = require('eslint');
const { builtinRules } = require('eslint/use-at-your-own-risk');
const tseslint = require('typescript-eslint');
const { noCrossAppPath, crossAppImportPatterns } = await import(pathToFileURL(path.join(backendRoot, 'eslint-rules/no-cross-app-path.mjs')).href);
const eslint = new ESLint({
  cwd: backendRoot,
  overrideConfigFile: true,
  overrideConfig: [{
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'cross-app': { rules: {
      'no-cross-app-path': noCrossAppPath,
      'no-restricted-imports': builtinRules.get('no-restricted-imports'),
    } } },
    rules: {
      'cross-app/no-cross-app-path': 'error',
      'cross-app/no-restricted-imports': ['error', { patterns: crossAppImportPatterns }],
    },
  }],
});
const output = [];
for (const code of JSON.parse(sources)) {
  const [result] = await eslint.lintText(code, { filePath: path.join(backendRoot, 'src/sample.ts') });
  output.push(result.messages.map((message) => message.ruleId).sort());
}
process.stdout.write(JSON.stringify(output));
`;

const app = ['front', 'end'].join('');

const cases: { code: string; ruleIds: string[] }[] = [
  {
    code: `import x from '../../${app}/src/lib/x'; export { x };`,
    ruleIds: ['cross-app/no-cross-app-path', 'cross-app/no-restricted-imports'],
  },
  {
    code: `export const load = () => import('../../${app}/src/lib/x');`,
    ruleIds: ['cross-app/no-cross-app-path'],
  },
  {
    code: `export const file = 'apps/${app}/src/lib/x.ts';`,
    ruleIds: ['cross-app/no-cross-app-path'],
  },
  {
    code: `export const dir = 'apps/${app}';`,
    ruleIds: ['cross-app/no-cross-app-path'],
  },
  {
    code: `export const file = \`../${app}/\${String(1)}\`;`,
    ruleIds: ['cross-app/no-cross-app-path'],
  },
  { code: "export const origin = 'FRONTEND_ORIGIN';", ruleIds: [] },
  { code: "export const audience = 'frontend';", ruleIds: [] },
  { code: "export const text = 'frontend 와 backend 분리';", ruleIds: [] },
  { code: `export const dir = 'apps/${app}-tools';`, ruleIds: [] },
];

describe('cross-app/no-cross-app-path', () => {
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
          JSON.stringify(cases.map((entry) => entry.code)),
        ],
        { encoding: 'utf8' },
      ),
    ) as string[][];
  }, 30000);

  it.each(cases.map((entry, index) => ({ ...entry, index })))(
    'reports $ruleIds for $code',
    ({ index, ruleIds }) => {
      expect(actual[index]).toEqual(ruleIds);
    },
  );
});

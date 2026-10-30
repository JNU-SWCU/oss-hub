import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import typescriptParser from '@typescript-eslint/parser';
import {
  crossAppImportPatterns,
  noCrossAppPath,
} from './no-cross-app-path.mjs';

const app = ['back', 'end'].join('');

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: typescriptParser },
      plugins: {
        local: {
          rules: {
            'no-cross-app-path': noCrossAppPath,
            'no-cross-app-imports': builtinRules.get('no-restricted-imports'),
          },
        },
      },
      rules: {
        'local/no-cross-app-path': 'error',
        'local/no-cross-app-imports': [
          'error',
          { patterns: crossAppImportPatterns },
        ],
      },
    },
  ],
});

async function ruleIds(code) {
  const [result] = await eslint.lintText(code, { filePath: 'src/sample.ts' });
  return result.messages.map((message) => message.ruleId).sort();
}

describe('local/no-cross-app-path', () => {
  it('백엔드 소스 정적 import를 두 규칙 모두로 거부한다', async () => {
    expect(
      await ruleIds(`import x from '../../../${app}/src/x';\nexport { x };`),
    ).toEqual(['local/no-cross-app-imports', 'local/no-cross-app-path']);
  });

  it('백엔드 소스 동적 import를 경로 규칙으로 거부한다', async () => {
    expect(
      await ruleIds(
        `export const load = () => import('../../../${app}/src/x');`,
      ),
    ).toEqual(['local/no-cross-app-path']);
  });

  it.each([
    `export const file = 'apps/${app}/src/main.ts';`,
    `export const dir = 'apps/${app}';`,
    `export const file = \`../${app}/\${"x"}\`;`,
    `export const win = '..\\\\${app}\\\\src';`,
  ])('백엔드 경로 문자열을 거부한다: %s', async (code) => {
    expect(await ruleIds(code)).toEqual(['local/no-cross-app-path']);
  });

  it.each([
    "import { backendOrigin } from '../backend-origin';\nexport { backendOrigin };",
    "export const label = 'backend';",
    "export const text = 'frontend/backend 분리';",
    `export const dir = 'apps/${app}-tools';`,
    "export const route = '/api/v1/programs';",
  ])('세그먼트가 아닌 backend 표기는 허용한다: %s', async (code) => {
    expect(await ruleIds(code)).toEqual([]);
  });
});

import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import { controllerExplicitReturn } from './eslint-rules/controller-explicit-return.mjs';
import { fileClassMatch } from './eslint-rules/file-class-match.mjs';
import { fileNameConvention } from './eslint-rules/file-name-convention.mjs';
import { noSessionGuard } from './eslint-rules/no-session-guard.mjs';
import {
  bootstrapFiles,
  createRailsConfig,
  testFiles,
} from './eslint-rules/rails-config.mjs';
import { requestDtoDecorated } from './eslint-rules/request-dto-decorated.mjs';
import { responseDtoShape } from './eslint-rules/response-dto-shape.mjs';
import {
  crossAppImportPatterns,
  noCrossAppPath,
} from './eslint-rules/no-cross-app-path.mjs';
import { sharedConfig } from '../../eslint.shared.mjs';

const namingBlock = (files, selector, regex) => ({
  files: [files],
  rules: {
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector,
        format: ['PascalCase'],
        custom: { regex, match: true },
      },
    ],
  },
});
const dtoSelector = ['class', 'interface', 'typeAlias'];

export default tseslint.config(
  eslint.configs.recommended,
  ...sharedConfig,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...(await createRailsConfig(import.meta.dirname)),
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    plugins: {
      'cross-app': {
        rules: {
          'no-cross-app-path': noCrossAppPath,
          'no-restricted-imports': builtinRules.get('no-restricted-imports'),
        },
      },
    },
    rules: {
      'cross-app/no-cross-app-path': 'error',
      'cross-app/no-restricted-imports': [
        'error',
        {
          patterns: [
            ...crossAppImportPatterns,
            {
              group: ['**/node_modules/**'],
              message:
                'node_modules 안 경로를 상대 경로로 import하지 않는다. 패키지 이름(@nestjs/common 등)으로 import한다.',
            },
          ],
        },
      ],
    },
  },
  namingBlock(
    'src/**/dto/*.ts',
    dtoSelector,
    '^[A-Z][A-Za-z0-9]*(?:Request|Response)Dto$',
  ),
  namingBlock(
    'src/**/dto/*-request.dto.ts',
    dtoSelector,
    '^[A-Z][A-Za-z0-9]*RequestDto$',
  ),
  namingBlock(
    'src/**/dto/*-response.dto.ts',
    dtoSelector,
    '^[A-Z][A-Za-z0-9]*ResponseDto$',
  ),
  ...Object.entries({
    controller: 'Controller',
    service: 'Service',
    repository: 'Repository',
    module: 'Module',
  }).map(([suffix, className]) =>
    namingBlock(
      `src/**/*.${suffix}.ts`,
      'class',
      `^[A-Z][A-Za-z0-9]*${className}$`,
    ),
  ),
  {
    files: ['src/**/*.ts'],
    plugins: {
      conventions: {
        rules: {
          'controller-explicit-return': controllerExplicitReturn,
          'response-dto-shape': responseDtoShape,
          'request-dto-decorated': requestDtoDecorated,
          'file-name-convention': fileNameConvention,
          'file-class-match': fileClassMatch,
        },
      },
    },
  },
  {
    files: ['{src,test,prisma}/**/*.ts'],
    plugins: { auth: { rules: { 'no-session-guard': noSessionGuard } } },
    rules: { 'auth/no-session-guard': 'error' },
  },
  {
    files: ['src/*/*.controller.ts'],
    rules: { 'conventions/controller-explicit-return': 'error' },
  },
  {
    files: ['src/*/dto/*-response.dto.ts'],
    rules: { 'conventions/response-dto-shape': 'error' },
  },
  {
    files: ['src/*/dto/*-request.dto.ts'],
    rules: { 'conventions/request-dto-decorated': 'error' },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [...testFiles, ...bootstrapFiles],
    rules: {
      'conventions/file-name-convention': 'error',
      'conventions/file-class-match': 'error',
    },
  },
  {
    files: ['eslint.config.mjs', 'eslint-rules/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    ignores: ['dist', 'node_modules'],
  },
);

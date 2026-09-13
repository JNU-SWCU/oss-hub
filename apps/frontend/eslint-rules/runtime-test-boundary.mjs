// 런타임 모듈이 테스트 소유 코드/데이터를 가져오지 못하게 한다.
//
// 대상은 해석된 리터럴 의존 간선뿐이다. 계산된 specifier(`import(name)`,
// 치환이 있는 템플릿)는 일반적으로 해석할 수 없으므로 보고하지 않는다 —
// 그런 간선은 이 규칙이 전체 프로그램 증명을 대신한다고 주장하지 말고
// 리뷰한다. 존재하지 않는 모듈은 컴파일러 오류로 남긴다. 해석 실패를
// 성공으로 꾸미는 fallback은 두지 않는다.
//
// 테스트 소유 분류(타깃·임포터 공통):
// - 패키지 루트 기준 경로 세그먼트가 정확히 `test-support` / `e2e` /
//   `__tests__` / `__mocks__` 인 트리 (부분 문자열 매칭이 아님)
// - 파일명 `*.test.*` / `*.spec.*` / `*.fixture.*`
// - 명시 헬퍼: `*-test-support.*`, `*-test-fixtures.*`, 베이스네임이 정확히
//   `fixtures.*`. `mock`/`sample`/`seed` 또는 이름에 fixture가 들어 있는
//   임의의 도메인 파일은 금지하지 않는다.
//
// 임포터 제외는 위 테스트 소유 파일과 패키지 루트의 정확한
// `vitest.config.mts` / `playwright.config.ts` 뿐이다. 모든 `.config.*`,
// `lib`, `next.config.ts`, 로컬리뷰/부채 예외, enable 플래그는 없다.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const AUTHORED_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

const TEST_OWNED_ROOT_SEGMENTS = new Set([
  'test-support',
  'e2e',
  '__tests__',
  '__mocks__',
]);

const TEST_RUNNER_CONFIG_PATHS = new Set([
  'vitest.config.mts',
  'playwright.config.ts',
]);

const compilerOptionsByRoot = new Map();
const resolutionCacheByRoot = new Map();
const hostByRoot = new Map();

function tryRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function extensionOf(filePath) {
  const base = path.basename(filePath);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return base.slice(dot);
}

function fileStem(basename) {
  const dot = basename.lastIndexOf('.');
  if (dot <= 0) {
    return basename;
  }
  return basename.slice(0, dot);
}

function absoluteLintFilename(context) {
  const raw = context.physicalFilename ?? context.filename;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  if (raw === '<input>' || raw === '<text>') {
    return null;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (typeof context.cwd !== 'string' || context.cwd.length === 0) {
    return null;
  }
  return path.resolve(context.cwd, raw);
}

function findPackageRoot(startFile) {
  let dir = path.dirname(path.resolve(startFile));
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return tryRealpath(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function relativeSegments(root, target) {
  return path.relative(root, target).split(path.sep).filter(Boolean);
}

function isColocatedTestEntry(basename) {
  return /\.(?:test|spec|fixture)\.[^.]+$/u.test(basename);
}

function isExplicitTestHelper(basename) {
  const stem = fileStem(basename);
  return (
    stem === 'fixtures' ||
    stem.endsWith('-test-support') ||
    stem.endsWith('-test-fixtures')
  );
}

function isTestOwnedPath(packageRoot, absPath) {
  if (!isInsideRoot(packageRoot, absPath)) {
    return false;
  }
  const segments = relativeSegments(packageRoot, absPath);
  if (segments.includes('node_modules')) {
    return false;
  }
  const directories = segments.slice(0, -1);
  if (directories.some((segment) => TEST_OWNED_ROOT_SEGMENTS.has(segment))) {
    return true;
  }
  const basename = segments.at(-1);
  if (basename === undefined) {
    return false;
  }
  return isColocatedTestEntry(basename) || isExplicitTestHelper(basename);
}

function isExcludedImporter(packageRoot, absPath) {
  if (isTestOwnedPath(packageRoot, absPath)) {
    return true;
  }
  return TEST_RUNNER_CONFIG_PATHS.has(
    toPosix(path.relative(packageRoot, absPath)),
  );
}

function loadCompilerOptions(packageRoot) {
  const cached = compilerOptionsByRoot.get(packageRoot);
  if (cached !== undefined) {
    return cached;
  }

  const configPathRaw = ts.findConfigFile(
    packageRoot,
    (candidate) => ts.sys.fileExists(candidate),
    'tsconfig.json',
  );
  const configPath =
    configPathRaw === undefined ? undefined : tryRealpath(configPathRaw);
  const configDir =
    configPath === undefined
      ? undefined
      : tryRealpath(path.dirname(configPath));
  if (
    configPath === undefined ||
    configDir === undefined ||
    (configDir !== packageRoot && !isInsideRoot(packageRoot, configPath))
  ) {
    throw new Error('runtime-test-boundary requires the package tsconfig.json');
  }

  const read = ts.readConfigFile(configPath, (fileName) =>
    ts.sys.readFile(fileName),
  );
  if (read.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, '\n'),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        )
        .join('\n'),
    );
  }
  const options = parsed.options;
  compilerOptionsByRoot.set(packageRoot, options);
  return options;
}

function hostFor(packageRoot) {
  const cached = hostByRoot.get(packageRoot);
  if (cached !== undefined) {
    return cached;
  }
  const host = {
    fileExists: (fileName) => ts.sys.fileExists(fileName),
    readFile: (fileName) => ts.sys.readFile(fileName),
    directoryExists: (directoryName) => ts.sys.directoryExists(directoryName),
    getDirectories: (directoryName) => ts.sys.getDirectories(directoryName),
    realpath: ts.sys.realpath,
    getCurrentDirectory: () => packageRoot,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  };
  hostByRoot.set(packageRoot, host);
  return host;
}

function resolutionCacheFor(packageRoot, compilerOptions) {
  const cached = resolutionCacheByRoot.get(packageRoot);
  if (cached !== undefined) {
    return cached;
  }
  const cache = ts.createModuleResolutionCache(
    packageRoot,
    (fileName) =>
      ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    compilerOptions,
  );
  resolutionCacheByRoot.set(packageRoot, cache);
  return cache;
}

function resolveSpecifier(packageRoot, containingFile, specifier) {
  const compilerOptions = loadCompilerOptions(packageRoot);
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    hostFor(packageRoot),
    resolutionCacheFor(packageRoot, compilerOptions),
  );
  const fromTs = resolved.resolvedModule?.resolvedFileName;
  if (fromTs === undefined) {
    return null;
  }
  return tryRealpath(fromTs);
}

function literalModuleSpecifier(node) {
  if (node == null) {
    return null;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (
    node.type === 'TemplateLiteral' &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    const cooked = node.quasis[0]?.value.cooked;
    return typeof cooked === 'string' ? cooked : null;
  }
  return null;
}

function isUnshadowedRequire(sourceCode, node) {
  const callee = node.callee;
  if (callee.type !== 'Identifier' || callee.name !== 'require') {
    return false;
  }
  let current = sourceCode.getScope(node);
  while (current) {
    const variable = current.variables.find(
      (entry) => entry.name === 'require',
    );
    if (variable !== undefined) {
      return variable.defs.length === 0;
    }
    current = current.upper;
  }
  return true;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '프론트엔드 런타임 모듈이 테스트 소유 코드로 해석되는 리터럴 의존을 갖지 못하게 한다.',
    },
    schema: [],
    messages: {
      runtimeImport:
        '런타임 모듈은 테스트 소유 코드를 가져올 수 없다 ({{specifier}} → {{target}}).',
    },
  },

  create(context) {
    const filename = absoluteLintFilename(context);
    if (filename === null) {
      return {};
    }
    if (!AUTHORED_EXTENSIONS.has(extensionOf(filename))) {
      return {};
    }

    const packageRoot = findPackageRoot(filename);
    if (packageRoot === null) {
      return {};
    }

    const importerPath = tryRealpath(filename);
    if (isExcludedImporter(packageRoot, importerPath)) {
      return {};
    }

    function checkSpecifier(specifierNode) {
      const specifier = literalModuleSpecifier(specifierNode);
      if (specifier === null) {
        return;
      }
      const resolved = resolveSpecifier(packageRoot, importerPath, specifier);
      if (resolved === null) {
        return;
      }
      if (!isTestOwnedPath(packageRoot, resolved)) {
        return;
      }
      context.report({
        node: specifierNode,
        messageId: 'runtimeImport',
        data: {
          specifier,
          target: toPosix(path.relative(packageRoot, resolved)),
        },
      });
    }

    return {
      ImportDeclaration(node) {
        checkSpecifier(node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkSpecifier(node.source);
        }
      },
      ExportAllDeclaration(node) {
        if (node.source) {
          checkSpecifier(node.source);
        }
      },
      ImportExpression(node) {
        checkSpecifier(node.source);
      },
      TSImportEqualsDeclaration(node) {
        const reference = node.moduleReference;
        if (reference?.type === 'TSExternalModuleReference') {
          checkSpecifier(reference.expression);
        }
      },
      CallExpression(node) {
        if (!isUnshadowedRequire(context.sourceCode, node)) {
          return;
        }
        checkSpecifier(node.arguments[0]);
      },
    };
  },
};

export default rule;

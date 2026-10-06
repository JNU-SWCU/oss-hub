import path from 'node:path';

function toZone(absPath, srcRoot) {
  const relative = path.relative(srcRoot, absPath);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  return { zone: segments[0], rest: segments.slice(1) };
}

function stripExtension(segment) {
  return segment.replace(/\.(ts|tsx|mts|cts|js|mjs|cjs)$/u, '');
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '모듈 경계를 상대경로 깊이와 무관하게 강제한다 (ADR-003 · ADR-010).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          srcRoot: { type: 'string' },

          sharedZones: { type: 'array', items: { type: 'string' } },

          internalDirs: { type: 'array', items: { type: 'string' } },

          encapsulated: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                zone: { type: 'string' },
                publicFiles: { type: 'array', items: { type: 'string' } },
                publicDirs: { type: 'array', items: { type: 'string' } },

                publicPaths: { type: 'array', items: { type: 'string' } },
                message: { type: 'string' },
              },
              required: ['zone'],
              additionalProperties: false,
            },
          },

          reverseDeny: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'array', items: { type: 'string' } },
                message: { type: 'string' },
              },
              required: ['from', 'to'],
              additionalProperties: false,
            },
          },

          rolePathDeny: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fileSuffix: { type: 'string' },

                denyPaths: { type: 'array', items: { type: 'string' } },

                zones: { type: 'array', items: { type: 'string' } },

                knownDebt: { type: 'array', items: { type: 'string' } },
                message: { type: 'string' },
              },
              required: ['fileSuffix', 'denyPaths'],
              additionalProperties: false,
            },
          },

          testBoundary: {
            type: 'object',
            properties: {
              testDir: { type: 'string' },

              basenamePattern: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['testDir', 'basenamePattern'],
            additionalProperties: false,
          },
        },
        required: ['srcRoot'],
        additionalProperties: false,
      },
    ],
    messages: {
      internalDir:
        '다른 모듈의 {{dir}}는 module 경계 밖에서 직접 참조하지 않는다 (ADR-003).',
      encapsulated: '{{message}}',
      reverse: '{{message}}',
      rolePath: '{{message}}',
      testBoundary: '{{message}}',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const srcRoot = options.srcRoot;
    if (!srcRoot) {
      return {};
    }

    const sharedZones = new Set(options.sharedZones ?? []);
    const internalDirs = new Set(options.internalDirs ?? []);
    const encapsulated = options.encapsulated ?? [];
    const reverseDeny = options.reverseDeny ?? [];
    const rolePathDeny = options.rolePathDeny ?? [];
    const testBoundary = options.testBoundary ?? null;
    const testBasenameRegex = testBoundary
      ? new RegExp(testBoundary.basenamePattern)
      : null;

    const filename = context.filename;
    const self = toZone(filename, srcRoot);

    if (self === null) {
      return {};
    }

    const selfIsTestFile =
      testBasenameRegex !== null &&
      testBasenameRegex.test(path.basename(filename));

    function checkSpecifier(node, specifierValue) {
      if (!specifierValue.startsWith('.')) {
        return;
      }
      const targetAbs = path.resolve(path.dirname(filename), specifierValue);

      if (testBoundary && !selfIsTestFile) {
        const relativeToTestDir = path.relative(
          testBoundary.testDir,
          targetAbs,
        );
        const underTestDir =
          relativeToTestDir !== '' &&
          !relativeToTestDir.startsWith('..') &&
          !path.isAbsolute(relativeToTestDir);
        const targetIsTestFile = testBasenameRegex.test(
          path.basename(targetAbs),
        );
        if (underTestDir || targetIsTestFile) {
          context.report({
            node,
            messageId: 'testBoundary',
            data: {
              message:
                testBoundary.message ??
                '운영 코드는 테스트 코드를 참조하지 않는다.',
            },
          });
          return;
        }
      }

      const target = toZone(targetAbs, srcRoot);
      if (target === null) {
        return;
      }

      for (const deny of rolePathDeny) {
        if (!path.basename(filename).endsWith(deny.fileSuffix)) {
          continue;
        }
        if (deny.zones !== undefined && !deny.zones.includes(self.zone)) {
          continue;
        }
        const selfPath = [self.zone, ...self.rest].join('/');
        if (deny.knownDebt?.includes(selfPath)) {
          continue;
        }
        const targetPath = [target.zone, ...target.rest].join('/');
        const normalized = stripExtension(targetPath);
        if (deny.denyPaths.some((denied) => normalized === denied)) {
          context.report({
            node,
            messageId: 'rolePath',
            data: {
              message: deny.message ?? '이 역할은 이 경로를 참조하지 않는다.',
            },
          });
          return;
        }
      }

      if (target.zone === self.zone) {
        return;
      }

      if (sharedZones.has(target.zone)) {
        return;
      }

      const capsule = encapsulated.find((entry) => entry.zone === target.zone);
      if (capsule) {
        const publicFiles = new Set(capsule.publicFiles ?? []);
        const publicDirs = new Set(capsule.publicDirs ?? []);
        const publicPaths = new Set(capsule.publicPaths ?? []);
        const [head, ...tail] = target.rest;

        const fullPath = stripExtension(target.rest.join('/'));
        const isPublic =
          publicPaths.has(fullPath) ||
          (head !== undefined &&
            (tail.length === 0
              ? publicFiles.has(stripExtension(head))
              : publicDirs.has(head)));
        if (!isPublic) {
          context.report({
            node,
            messageId: 'encapsulated',
            data: {
              message:
                capsule.message ??
                `${capsule.zone} 모듈 밖에서는 공개 surface 만 참조한다.`,
            },
          });
          return;
        }
      }

      for (const deny of reverseDeny) {
        if (self.zone === deny.from && deny.to.includes(target.zone)) {
          context.report({
            node,
            messageId: 'reverse',
            data: {
              message:
                deny.message ??
                `${deny.from} 구현은 소비자 모듈을 역참조하지 않는다.`,
            },
          });
          return;
        }
      }

      const [head] = target.rest;
      if (head !== undefined && internalDirs.has(head)) {
        context.report({
          node,
          messageId: 'internalDir',
          data: { dir: head },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        checkSpecifier(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkSpecifier(node, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        if (node.source) {
          checkSpecifier(node, node.source.value);
        }
      },
    };
  },
};

export default rule;

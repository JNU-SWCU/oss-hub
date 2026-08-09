// 모듈 경계를 **깊이와 무관하게** 강제하는 로컬 규칙.
//
// 왜 만들었나.
// 기존 경계는 `no-restricted-imports`의 상대경로 문자열 패턴이었다 —
// `../other/domain/*`, `../../other/domain/*` 처럼 `..`를 손으로 세는 방식이다.
// 그래서 `src/a/b/c/file.ts`(깊이 3)에서 `../../../other/domain/x`를 import하면
// 패턴이 매치되지 않고 **규칙이 조용히 통과한다.** 깨지는 게 아니라 무력화된다 —
// 회귀 fixture도 깊이 1에 고정돼 있어 GREEN으로 남는다.
//
// 이 규칙은 import 특정자를 파일 위치 기준으로 `path.resolve`해 절대경로로 만든 뒤
// `src/` 아래 첫 세그먼트(= zone)로 판정한다. `..`가 몇 개든 결과가 같다.
//
// 새 의존성이 없다. `eslint-plugin-import`는 이 저장소에 설치돼 있지 않으며
// 이 규칙은 Node 내장 `path`만 쓴다.
import path from 'node:path';

/**
 * 절대 경로를 `src` 기준 zone 정보로 바꾼다.
 * `<src>/collection/domain/x.ts` → `{ zone: 'collection', rest: ['domain', 'x.ts'] }`
 * `src` 밖이면 `null`.
 */
function toZone(absPath, srcRoot) {
  const relative = path.relative(srcRoot, absPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  return { zone: segments[0], rest: segments.slice(1) };
}

/** 확장자를 뗀 세그먼트. `x.ts` → `x`, `x` → `x`. */
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
          // 모듈이 아니라 전 모듈이 공유하는 기반 계층.
          sharedZones: { type: 'array', items: { type: 'string' } },
          // 다른 zone 에서 직접 참조할 수 없는 내부 표현 디렉터리.
          internalDirs: { type: 'array', items: { type: 'string' } },
          // 공개 surface 만 노출하는 zone 과 그 allowlist.
          encapsulated: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                zone: { type: 'string' },
                publicFiles: { type: 'array', items: { type: 'string' } },
                publicDirs: { type: 'array', items: { type: 'string' } },
                // 계층 폴더 안에 있는 공개 표면. zone 기준 상대 경로(확장자 제외).
                publicPaths: { type: 'array', items: { type: 'string' } },
                message: { type: 'string' },
              },
              required: ['zone'],
              additionalProperties: false,
            },
          },
          // 데이터 공급자가 소비자를 역참조하지 못하게 한다.
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
          // 특정 역할의 파일이 만질 수 없는 경로.
          rolePathDeny: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                // 파일명 접미사로 역할을 식별한다. 예: '.controller.ts'
                fileSuffix: { type: 'string' },
                // `src` 기준 경로. 예: 'prisma/prisma.service'
                denyPaths: { type: 'array', items: { type: 'string' } },
                // 이 zone 들에서만 건다. 없으면 전역.
                zones: { type: 'array', items: { type: 'string' } },
                // 이미 위반 중인 파일. 새 위반만 막는 래칫이다.
                knownDebt: { type: 'array', items: { type: 'string' } },
                message: { type: 'string' },
              },
              required: ['fileSuffix', 'denyPaths'],
              additionalProperties: false,
            },
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

    const filename = context.filename;
    const self = toZone(filename, srcRoot);
    // `src` 밖의 파일(테스트 하네스 등)은 대상이 아니다.
    if (self === null) {
      return {};
    }

    function checkSpecifier(node, specifierValue) {
      // 상대 경로만 본다. 패키지 import 는 이 규칙의 관심사가 아니다.
      if (!specifierValue.startsWith('.')) {
        return;
      }
      const targetAbs = path.resolve(path.dirname(filename), specifierValue);
      const target = toZone(targetAbs, srcRoot);
      if (target === null) {
        return;
      }

      // 역할 기반 금지 — 같은 zone 안이라도 걸린다.
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
            data: { message: deny.message ?? '이 역할은 이 경로를 참조하지 않는다.' },
          });
          return;
        }
      }

      // 같은 zone 안의 참조는 자유다.
      if (target.zone === self.zone) {
        return;
      }
      // 공유 기반 계층은 누구나 쓴다.
      if (sharedZones.has(target.zone)) {
        return;
      }

      // 캡슐화된 zone 의 내부 구현 참조 금지.
      const capsule = encapsulated.find((entry) => entry.zone === target.zone);
      if (capsule) {
        const publicFiles = new Set(capsule.publicFiles ?? []);
        const publicDirs = new Set(capsule.publicDirs ?? []);
        const publicPaths = new Set(capsule.publicPaths ?? []);
        const [head, ...tail] = target.rest;
        // 계층 폴더 도입으로 공개 표면이 zone 루트에만 있지 않게 됐다.
        // 경로 전체를 먼저 보고, 그 다음 루트 파일·공개 디렉터리를 본다.
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

      // 공급자가 소비자를 역참조하지 않는다.
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

      // 다른 모듈의 내부 표현 디렉터리 참조 금지.
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

const searchParamsAllowlist = {
  'app/programs/[id]/documents/documents-route.tsx':
    '문서 라우트가 milestoneId 선택과 경로 이동을 함께 소유한다.',
  'features/auth/auth-error.ts':
    '인증 오류 경계에서 authError의 존재만 해석한다.',
};

const effectFetchAllowlist = {
  'app/_shell/onboarding-gate.tsx':
    '온보딩 진행 조건을 fetchQuery staleTime 0으로 확인한다.',
  'features/consents/components/use-consent-flow.ts':
    '동의 폼의 편집 초기값을 fetchQuery staleTime 0으로 읽는다.',
  'features/profile/components/profile-onboarding-screen.tsx':
    '프로필 폼의 편집 초기값을 fetchQuery staleTime 0으로 읽는다.',
  'features/profile/settings/components/settings-screen.tsx':
    '설정 폼의 편집 초기값을 fetchQuery staleTime 0으로 읽는다.',
  'features/programs/authoring/program-edit-page.tsx':
    '프로그램 편집 초기값을 fetchQuery staleTime 0으로 읽는다.',
  'features/programs/documents/milestone-document-editor.tsx':
    '편집용 제출 항목 기준값을 fetchQuery staleTime 0으로 읽는다.',
};

const pageResetAllowlist = {
  'components/data-table.tsx':
    '서버 요청이 없는 클라이언트 표에서 유효한 페이지 범위로 보정한다.',
};

function filename(context) {
  return (context.physicalFilename ?? context.filename).replaceAll('\\', '/');
}

function allowed(context, allowlist) {
  const file = filename(context);
  return Object.keys(allowlist).some((entry) => file.endsWith(`/src/${entry}`));
}

function testFile(context) {
  return (
    /(?:^|\/)(?:e2e|test-support)\//.test(filename(context)) ||
    /\.(test|spec|fixture)\.|-test-(utils|fixtures|support)\.|-test-fixture\./.test(
      filename(context),
    )
  );
}

function member(node, name) {
  return (
    node?.type === 'MemberExpression' &&
    (node.computed ? node.property.value === name : node.property.name === name)
  );
}

function variable(context, node) {
  if (node?.type !== 'Identifier') return undefined;
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const binding = scope.set.get(node.name);
    if (binding) return binding;
    scope = scope.upper;
  }
  return undefined;
}

function hook(context, node, name) {
  if (node?.type === 'Identifier') {
    const binding = variable(context, node);
    const imported = binding?.defs.find((def) => def.type === 'ImportBinding');
    return imported
      ? imported.parent.source.value === 'react' &&
          imported.node.imported?.name === name
      : node.name === name;
  }
  return member(node, name) && node.object.name === 'React';
}

function walk(context, node, visit) {
  if (!node) return;
  visit(node);
  for (const key of context.sourceCode.visitorKeys[node.type] ?? []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) walk(context, item, visit);
    } else {
      walk(context, child, visit);
    }
  }
}

function localFunction(context, node) {
  if (!node) return undefined;
  if (
    [
      'ArrowFunctionExpression',
      'FunctionExpression',
      'FunctionDeclaration',
    ].includes(node.type)
  )
    return node;
  const def = variable(context, node)?.defs[0];
  if (def?.type === 'FunctionName') return def.node;
  if (def?.type !== 'Variable') return undefined;
  const init = def.node.init;
  if (
    init?.type === 'CallExpression' &&
    hook(context, init.callee, 'useCallback')
  )
    return init.arguments[0];
  return init &&
    ['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)
    ? init
    : undefined;
}

function apiCall(context, node) {
  const target = node.type === 'MemberExpression' ? node.object : node;
  const def = variable(context, target)?.defs.find(
    (entry) => entry.type === 'ImportBinding',
  );
  return (
    def &&
    def.node.importKind !== 'type' &&
    def.parent.importKind !== 'type' &&
    /(^|\/|-)(api|queries)$/.test(def.parent.source.value)
  );
}

function effectCalls(context, effect, predicate) {
  const visited = new Set();
  let found = false;
  function inspect(callback) {
    const fn = localFunction(context, callback);
    if (!fn || visited.has(fn)) return;
    visited.add(fn);
    walk(context, fn.body, (node) => {
      if (node.type !== 'CallExpression') return;
      if (predicate(node.callee)) found = true;
      inspect(node.callee);
    });
  }
  inspect(effect.arguments[0]);
  return found;
}

export default {
  'no-direct-search-params': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        urlState:
          '주소 읽기는 *-url-state.ts 훅에 모은다. 파싱과 기본값을 한곳에서 관리해야 공유·복원되는 화면 상태가 일치한다.',
      },
    },
    create(context) {
      if (
        testFile(context) ||
        filename(context).endsWith('-url-state.ts') ||
        allowed(context, searchParamsAllowlist)
      )
        return {};
      return {
        CallExpression(node) {
          const imported = variable(context, node.callee)?.defs.find(
            (def) => def.type === 'ImportBinding',
          );
          if (
            node.callee.name === 'useSearchParams' ||
            (imported?.parent.source.value === 'next/navigation' &&
              imported.node.imported?.name === 'useSearchParams') ||
            (member(node.callee, 'get') &&
              node.callee.object.name === 'searchParams')
          )
            context.report({ node, messageId: 'urlState' });
        },
        NewExpression(node) {
          const source = node.arguments[0];
          if (
            node.callee.name === 'URLSearchParams' &&
            member(source, 'search') &&
            (source.object.name === 'location' ||
              (member(source.object, 'location') &&
                source.object.object.name === 'window'))
          ) {
            context.report({ node, messageId: 'urlState' });
          }
        },
      };
    },
  },
  'no-window-custom-events': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        queryInvalidation:
          '서버 데이터 갱신은 queryClient.invalidateQueries로 선언한다. window CustomEvent는 캐시 의존 관계를 숨긴다.',
      },
    },
    create(context) {
      if (testFile(context)) return {};
      return {
        CallExpression(node) {
          if (
            member(node.callee, 'dispatchEvent') &&
            node.callee.object.name === 'window' &&
            node.arguments[0]?.type === 'NewExpression' &&
            node.arguments[0].callee.name === 'CustomEvent'
          ) {
            context.report({ node, messageId: 'queryInvalidation' });
          }
        },
      };
    },
  },
  'no-effect-server-fetch': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        serverQuery:
          '서버 데이터는 Query 훅으로 구독한다. useEffect와 로컬 로더의 API 호출은 캐시·경합 처리를 중복시킨다. 편집 초기값은 명시된 fetchQuery 예외만 허용한다.',
      },
    },
    create(context) {
      if (testFile(context) || allowed(context, effectFetchAllowlist))
        return {};
      return {
        CallExpression(node) {
          if (
            hook(context, node.callee, 'useEffect') &&
            effectCalls(context, node, (callee) => apiCall(context, callee))
          ) {
            context.report({ node, messageId: 'serverQuery' });
          }
        },
      };
    },
  },
  'no-effect-reset-page': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        atomicPage:
          '필터와 페이지는 같은 이벤트에서 변경한다. useEffect의 setPage는 이전 페이지로 먼저 요청하여 중복 조회를 만든다.',
      },
    },
    create(context) {
      if (testFile(context) || allowed(context, pageResetAllowlist)) return {};
      return {
        CallExpression(node) {
          if (
            hook(context, node.callee, 'useEffect') &&
            effectCalls(
              context,
              node,
              (callee) =>
                callee.type === 'Identifier' && callee.name === 'setPage',
            )
          ) {
            context.report({ node, messageId: 'atomicPage' });
          }
        },
      };
    },
  },
};

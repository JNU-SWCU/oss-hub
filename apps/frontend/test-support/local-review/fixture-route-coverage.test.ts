// 로컬 검토 픽스처가 **backend 에 실제로 있는 GET 라우트를 빠짐없이 안다**는 것을
// 계약으로 고정한다.
//
// 왜 필요한가 — QA8·QA9 가 이 사각지대에서 나왔다. 픽스처는 손으로 관리하는 가짜
// backend 라, 새 엔드포인트가 생겨도 아무도 알려 주지 않는다. 빠진 경로는 조용히
// `LFX_404` 로 떨어지고, 검토자에게는 **제품 결함처럼 보인다**. 실제로 QA 두 건이
// 그렇게 올라왔고 배포 환경에서는 둘 다 200 이었다.
//
// 판정 기준은 상태 코드가 아니라 **`LFX_404` 여부**다. `LFX_404` 는 "이 경로를 아는
// 규칙이 하나도 없다"는 뜻이고, 도메인 404(`PROGRAM_NOT_FOUND`·`SHW_001` 등)는
// "경로는 아는데 그 데이터가 없다"는 뜻이라 성격이 다르다. QA10 이 후자였다 —
// 경로가 양쪽에 다 있고 404 조건이 데이터·권한이었다. 그 둘을 섞으면 이 테스트가
// 없는 결함을 만들어 낸다.
//
// 역할·데이터 조건은 페르소나마다 다르므로 **한 페르소나라도 아는 경로면 통과**로 본다.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_REVIEW_FIXTURE_IDS } from '@/lib/local-review-runtime';
import { resolveLocalReviewResponse } from './fixture-response';
import { PUBLIC_PROGRAM_IDS } from './handlers/student-program-fixtures';

const BACKEND_SRC = path.resolve(__dirname, '../../../backend/src');
const REPOSITORY_ROOT = path.resolve(BACKEND_SRC, '../../..');

/** 픽스처가 "이 경로를 모른다"고 말할 때 쓰는 코드. 도메인 404 와 구분된다. */
const UNKNOWN_ROUTE_CODE = 'LFX_404';

/**
 * 로컬 검토 대상이 아닌 경로 — 각각 **왜** 빠지는지 적는다.
 * 조용히 줄이지 않기 위해 이유 없는 항목은 두지 않는다.
 */
const OUT_OF_SCOPE: ReadonlyMap<string, string> = new Map([
  [
    'auth/github',
    'OAuth 리다이렉트 — JSON API 가 아니라 픽스처가 대신할 수 없다',
  ],
  ['auth/github/callback', 'OAuth 콜백 — 위와 같다'],
  ['health', '인프라 헬스체크 — 화면이 부르지 않는다'],
  [
    'submission-files/:fileId',
    '파일 바이너리 다운로드 — 응답이 JSON 이 아니다',
  ],
  [
    'milestones/:milestoneId/documents/:documentId/submissions/current/file',
    '파일 바이너리 다운로드 — 응답이 JSON 이 아니다(위 항목과 같은 이유)',
  ],
  // 아래 다섯은 프론트 소스 전체에 호출부가 0건이다(운영·CLI 용). 화면이 부르지
  // 않는 경로는 로컬 검토에서 404 가 나도 아무도 보지 못하므로 픽스처가 필요 없다.
  ['admin/collection/runs', '화면 호출부 0건 — 운영 조회용'],
  [
    'admin/collection/invariants',
    '화면 호출부 0건 — 기여 데이터 불변식 전수 검사(ADR-010 §11) 운영 조회용',
  ],
  ['notifications/deadline-digests/failures', '화면 호출부 0건 — 운영 조회용'],
  ['submission-files/cleanup/failures', '화면 호출부 0건 — 운영 조회용'],
  [
    'users/me/login-history',
    '화면 호출부 0건 — 미사용 API 처리 확정은 이슈 #550 이 다룬다',
  ],
  // 아래 셋은 E2E 오케스트레이션 전용 경로다 — env 게이트로 프로덕션에서는
  // 모듈 자체가 등록되지 않고, 호출부도 화면이 아니라 Playwright 하네스뿐이다.
  ['_e2e/program-authoring/fixture', 'E2E 전용 — 화면 호출부 0건'],
  ['_e2e/program-authoring/state/:programId', 'E2E 전용 — 화면 호출부 0건'],
  [
    '_e2e/program-authoring/cross-team-current-file',
    'E2E 전용 — 화면 호출부 0건',
  ],
]);

/**
 * **이미 알고 있는 공백.** 비우는 것이 목표이고, 늘어나면 테스트가 깨진다.
 *
 * 여기에 두는 이유는 「지금 이 PR 에서 고치지 않는다」이지 「고칠 필요 없다」가
 * 아니다. 조용히 통과시키지 않으려고 목록으로 드러낸다.
 */
const KNOWN_GAPS: ReadonlyMap<string, string> = new Map();

function isBackendControllerFile(name: string): boolean {
  return (
    name.endsWith('.controller.ts') &&
    !name.includes('.spec.') &&
    !name.startsWith('__lint_fixture_')
  );
}

/**
 * 현재 작업 트리를 순회하지 않고, 이 후보 commit이 추적하는 controller만 읽는다.
 * 병렬 lint·빌드가 만드는 파일은 working tree에는 보여도 이 목록에는 없고, 반대로
 * 추적된 controller는 backend/src 전체 후보에서 이름으로만 거르므로 빠뜨리지 않는다.
 */
function trackedControllerFiles(): readonly string[] {
  return execFileSync(
    'git',
    ['-C', REPOSITORY_ROOT, 'ls-files', '--', 'apps/backend/src'],
    { encoding: 'utf-8' },
  )
    .split('\n')
    .filter(Boolean)
    .filter((candidate) => isBackendControllerFile(path.basename(candidate)))
    .map((candidate) => path.resolve(REPOSITORY_ROOT, candidate))
    .sort();
}

/** `@Controller('base')` 블록마다 그 안의 `@Get('sub')` 을 모아 경로를 만든다. */
function backendGetRoutes(): readonly string[] {
  const routes = new Set<string>();
  for (const file of trackedControllerFiles()) {
    const source = readFileSync(file, 'utf-8');
    const controllers = [...source.matchAll(/@Controller\('([^']*)'\)/g)];
    for (const [index, controller] of controllers.entries()) {
      const base = controller[1];
      const blockStart = controller.index + controller[0].length;
      const blockEnd = controllers[index + 1]?.index ?? source.length;
      const block = source.slice(blockStart, blockEnd);
      for (const get of block.matchAll(/@Get\((?:'([^']*)')?\)/g)) {
        const segment = get[1] ?? '';
        routes.add([base, segment].filter(Boolean).join('/'));
      }
    }
  }
  return [...routes].sort();
}

/**
 * 경로 파라미터를 합성 값으로 채운다. 실제로 존재하는 id 일 필요는 없다 —
 * 이 테스트가 보는 것은 **경로 모양을 아는 규칙이 있는가**이지 데이터가 있는가가
 * 아니다. 없는 id 면 도메인 404 가 나오는데 그것은 통과로 본다.
 */
function fillParams(route: string): string {
  return route
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? `synthetic-${segment.slice(1)}` : segment,
    )
    .join('/');
}

/**
 * 프로그램 경로의 **첫 파라미터만** 실제 프로그램 id 로 채운다 — `programs/…` 아래에서
 * 첫 파라미터는 언제나 프로그램이고(`:id`·`:programId` 이름만 다르다), 나머지는 게시글·
 * 마일스톤처럼 다른 것들이라 합성 값 그대로 둔다.
 */
function fillProgramParams(route: string, programId: string): string {
  let programFilled = false;
  return route
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      if (programFilled) return `synthetic-${segment.slice(1)}`;
      programFilled = true;
      return programId;
    })
    .join('/');
}

interface FixtureOutcome {
  readonly status: number | null;
  readonly code: string | null;
}

function probe(requestPath: string): readonly FixtureOutcome[] {
  return (
    LOCAL_REVIEW_FIXTURE_IDS
      // `loading`·`error` 는 경로와 무관하게 같은 결과를 주도록 만든 페르소나라
      // 경로 인지 여부를 말해 주지 못한다. 판정에서 뺀다.
      .filter((fixture) => fixture !== 'loading' && fixture !== 'error')
      .map((fixture) => {
        const plan = resolveLocalReviewResponse({
          fixture,
          method: 'GET',
          path: requestPath,
          searchParams: new URLSearchParams(),
          body: undefined,
        });
        // ⚠ `problem()` 도 `kind: 'json'` 을 돌려준다(handler-kit.ts). 별도 kind 가
        // 있다고 보고 판정하면 이 테스트가 통째로 헛돈다.
        if (plan.kind !== 'json') return { status: null, code: null };
        const body: unknown = plan.body;
        const code =
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof (body as { code: unknown }).code === 'string'
            ? (body as { code: string }).code
            : null;
        return { status: plan.status, code };
      })
  );
}

describe('로컬 검토 픽스처의 GET 라우트 커버리지', () => {
  const routes = backendGetRoutes();

  it('병렬 backend lint가 만든 임시 controller를 운영 라우트로 세지 않는다', () => {
    expect(
      isBackendControllerFile(
        '__lint_fixture_green_controller_service.controller.ts',
      ),
    ).toBe(false);
  });

  it('추적된 controller 후보만 읽어 동시 작업 파일에 흔들리지 않는다', () => {
    expect(trackedControllerFiles().length).toBeGreaterThan(20);
    expect(
      trackedControllerFiles().every((file) =>
        file.startsWith(`${BACKEND_SRC}${path.sep}`),
      ),
    ).toBe(true);
  });

  it('backend 컨트롤러를 실제로 읽어 낸다', () => {
    // 파싱이 조용히 0건이 되면 아래 단언이 전부 통과해 버린다 — 그 상태를 막는다.
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain('programs/status-counts');
    expect(routes).toContain('ranking/years');
  });

  const inScope = routes.filter((route) => !OUT_OF_SCOPE.has(route));

  it('파라미터 없는 경로는 어떤 페르소나에게도 404 로 끝나지 않는다', () => {
    // QA8 이 이 모양이었다 — `programs/status-counts` 가 `programs/:id` 규칙에
    // **프로그램 id 로 먹혀** 도메인 404(`PROGRAM_NOT_FOUND`)가 됐다. 그래서
    // 「경로를 모른다(LFX_404)」만 보면 잡히지 않는다. 고정 경로는 데이터·권한
    // 조건이 없으므로 최소 한 페르소나에게는 404 가 아닌 답이 나와야 한다.
    const swallowed = inScope
      .filter((route) => !route.includes(':'))
      .filter((route) =>
        probe(route).every((outcome) => outcome.status === 404),
      );

    expect(swallowed.filter((route) => !KNOWN_GAPS.has(route))).toEqual([]);
  });

  it('파라미터가 있는 경로도 규칙 자체는 존재한다', () => {
    // 합성 id 는 실제로 없으므로 도메인 404 는 정상이다. 여기서 막는 것은
    // 「그 경로 모양을 아는 규칙이 하나도 없는」 상태다(QA9 가 그랬다 — 픽스처
    // 폴더 전체에 `ranking` 이라는 말이 한 번도 없었다).
    const unknown = inScope
      .filter((route) => route.includes(':'))
      .filter((route) =>
        probe(fillParams(route)).every(
          (outcome) => outcome.code === UNKNOWN_ROUTE_CODE,
        ),
      );

    expect(unknown.filter((route) => !KNOWN_GAPS.has(route))).toEqual([]);
  });

  it('알려진 공백 목록이 낡지 않는다 — 메워진 항목은 목록에서 빼야 한다', () => {
    // 목록에 남은 채 공백이 메워지면, 나중에 같은 경로가 다시 비어도 통과한다.
    const stillMissing = [...KNOWN_GAPS.keys()].filter((route) => {
      const outcomes = probe(fillParams(route));
      return route.includes(':')
        ? outcomes.every((outcome) => outcome.code === UNKNOWN_ROUTE_CODE)
        : outcomes.every((outcome) => outcome.status === 404);
    });

    expect(stillMissing).toEqual([...KNOWN_GAPS.keys()]);
  });

  /**
   * 공개 프로그램을 새로 하나 넣을 때, 그 id 를 아는 규칙이 프로그램 경로마다 있어야
   * 한다. 위의 두 검사는 `synthetic-id` 로 「경로 모양을 아는 규칙이 있는가」만 보므로,
   * 실제 픽스처 프로그램이 일부 경로에서만 인식되는 상태는 잡지 못한다 — 검토자에게는
   * 목록에서 눌러 들어간 화면 하나만 조용히 비어 보인다.
   */
  it.each(PUBLIC_PROGRAM_IDS)(
    '%s 는 프로그램 경로 어디에서도 경로 미인지로 떨어지지 않는다',
    (programId) => {
      const unknown = inScope
        .filter((route) => route.startsWith('programs/') && route.includes(':'))
        .filter((route) =>
          probe(fillProgramParams(route, programId)).every(
            (outcome) => outcome.code === UNKNOWN_ROUTE_CODE,
          ),
        );

      expect(unknown).toEqual([]);
    },
  );

  it('범위 밖 목록이 실재하는 경로만 가리킨다', () => {
    // backend 에서 사라진 경로가 예외 목록에 남으면, 나중에 같은 이름의 경로가
    // 새로 생겼을 때 검사 없이 통과한다.
    for (const route of OUT_OF_SCOPE.keys()) {
      expect(routes).toContain(route);
    }
  });
});

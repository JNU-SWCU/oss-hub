import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import {
  RANKING_YEAR_ALL,
  type RankingItem,
  type RankingPage,
  type RankingViewerClass,
} from '../types';
import { RankingView } from './ranking-view';

vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>();

  return {
    ...actual,
    DataTable: ({
      columns,
      data,
      rowKey,
      className,
      emptyState,
      caption,
    }: {
      readonly columns: readonly {
        readonly id: string;
        readonly header: React.ReactNode;
        readonly headClassName?: string;
        readonly cell: (item: RankingItem) => React.ReactNode;
      }[];
      readonly data: readonly RankingItem[];
      readonly rowKey: (item: RankingItem) => React.Key;
      readonly className?: string;
      readonly emptyState?: React.ReactNode;
      readonly caption?: React.ReactNode;
    }) => (
      <div
        className={className}
        data-column-widths={columns
          .map(({ id, headClassName }) => `${id}:${headClassName ?? ''}`)
          .join(',')}
        data-row-keys={data.map(rowKey).join(',')}
      >
        {caption}
        {/* 머리글도 실제 DOM 으로 내늘다 — 열 이름은 사용자가 읽는 문구라
            props 만 보면 "Star(누적)" 같은 표기가 사라져도 통과해 버린다. */}
        {columns.map((column) => (
          <div key={`head-${column.id}`} data-column-head={column.id}>
            {column.header}
          </div>
        ))}
        {data.length === 0 ? emptyState : null}
        {data.map((item) => (
          <div key={rowKey(item)}>
            {columns.map((column) => (
              <div key={column.id} data-column-id={column.id}>
                {column.cell(item)}
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
  };
});

const handlers = {
  onPageChange: () => undefined,
  onRetry: () => undefined,
  onExportCsv: () => undefined,
  isExportingCsv: false,
};

function rankingEnvelope(
  overrides: Partial<RankingPage> &
    Pick<RankingPage, 'year' | 'items' | 'page' | 'pageSize' | 'total'>,
): RankingPage {
  return {
    dataAsOf: null,
    viewerClass: 'public',
    nextCycleAt: null,
    ...overrides,
  };
}

test('모바일 레이아웃을 명시하고 기간 토글 버튼을 렌더하지 않는다', () => {
  const displayName = 'A very long participant display name';
  const githubLogin = 'participant-with-a-very-long-github-login';
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: rankingEnvelope({
          year: 2026,
          items: [
            {
              rank: 1,
              displayName,
              githubLogin,
              department: null,
              commitCount: 3,
              pullRequestCount: 2,
              issueCount: 1,
              repositoryCount: 1,
              starCount: 7,
              total: 6,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
      }}
      {...handlers}
    />,
  );

  expect(html).not.toContain('aria-label="랭킹 기간"');
  expect(html).not.toContain('aria-pressed');
  expect(html).not.toContain('>올해<');
  expect(html).not.toContain('>전체<');
  expect(html).toContain('break-keep');
  expect(html).not.toContain('table-fixed');
  expect(html).toContain(
    'data-column-widths="rank:w-8,member:w-24,department:w-20,commit:w-12 text-right,pr:w-12 text-right,issue:w-12 text-right,repository:w-12 text-right,star:w-12 text-right,total:w-12 text-right"',
  );
  expect(html).not.toContain(displayName);
  expect(html).toContain(`@${githubLogin}`);
  expect(html).not.toContain('truncate');
  expect(html).toContain('whitespace-normal');
  expect(html).not.toContain('break-all');
});

test('표 캡션을 렌더하지 않는다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [
            {
              rank: 1,
              displayName: 'mina',
              githubLogin: 'mina',
              department: null,
              commitCount: 1,
              pullRequestCount: 0,
              issueCount: 0,
              repositoryCount: 1,
              starCount: 7,
              total: 1,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).not.toContain('sr-only');
  expect(html).not.toContain('공개 GitHub 활동 랭킹');
});

test('빈 상태와 오류 재시도 상태를 사용자에게 표시한다', () => {
  const empty = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2025,
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );
  const failure = renderToStaticMarkup(
    <RankingView page={1} state={{ kind: 'error' }} {...handlers} />,
  );

  expect(empty).toContain('집계된 활동 데이터가 없습니다');
  expect(failure).toContain('다시 시도');
  expect(failure).not.toContain(
    '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
  );
  expect(failure).not.toContain('data-row-keys');
  expect(failure).not.toContain('표시할 데이터가 없습니다.');
});

test('집계 안내 문구를 더 이상 화면에 표시하지 않는다', () => {
  const html = renderToStaticMarkup(
    <RankingView page={1} state={{ kind: 'loading' }} {...handlers} />,
  );

  expect(html).not.toContain('집계 안내');
  expect(html).not.toContain(
    '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.',
  );
  expect(html).not.toContain(
    'Release는 해당 기간에 게시된 GitHub 릴리스 수입니다.',
  );
});

test('GitHub 로그인이 같아도 순위가 다른 행에 고유 키를 사용한다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [
            {
              rank: 1,
              displayName: '첫 번째 참여자',
              githubLogin: 'same-login',
              department: null,
              commitCount: 3,
              pullRequestCount: 2,
              issueCount: 1,
              repositoryCount: 1,
              starCount: 7,
              total: 6,
            },
            {
              rank: 2,
              displayName: '두 번째 참여자',
              githubLogin: 'same-login',
              department: null,
              commitCount: 2,
              pullRequestCount: 1,
              issueCount: 1,
              repositoryCount: 1,
              starCount: 7,
              total: 4,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 2,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('data-row-keys="1,2"');
});

// F4 QA 감사 갭: outcome-1·2·4·5는 지금까지 backend 통합 테스트
// (`public-exposure-matrix.integration.spec.ts`)에서만 증명됐다. 아래는 그 outcome들의 ranking
// 화면 절반을 고정한다 — archive 쪽 절반(outcome-2 기여자 분리, outcome-4 stale-allow,
// outcome-5 회수)은 `archive/archive.test.tsx`가 동일한 synthetic 식별자로 짝을 맞춘다.
//
// `department` 는 2026-08-19 owner 결정으로 **공개 정보**가 되어 이 목록에서 빠졌다 —
// 학과 열은 비로그인에게도 보이는 것이 계약이다(plan todo 15·16). 나머지 칸은 여전히
// 어느 계층에도 내려가지 않는다.
const forbiddenRankingFields = [
  'studentId',
  'accountStatus',
  '"role"',
  'realName',
  '@example.com',
];

test('outcome-1: 발행 전 프로젝트의 기여자는 다른 참여자가 랭킹에 있어도 함께 나타나지 않는다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic 활성 참여자',
              githubLogin: 'synthetic-outcome2-owner-login',
              department: null,
              commitCount: 5,
              pullRequestCount: 2,
              issueCount: 1,
              repositoryCount: 1,
              starCount: 7,
              total: 8,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('synthetic-outcome2-owner-login');
  expect(html).not.toContain('synthetic-outcome1');
});

test('outcome-2: 발행 후 관측된 저장소의 기여자 2명이 각자의 순위와 커밋/PR/릴리스 수치로 정확히 분리되어 랭킹에 표시된다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic-outcome2-owner-login',
              githubLogin: 'synthetic-outcome2-owner-login',
              department: null,
              commitCount: 5,
              pullRequestCount: 2,
              issueCount: 1,
              repositoryCount: 1,
              starCount: 7,
              total: 8,
            },
            {
              rank: 2,
              displayName: 'synthetic-outcome2-other-login',
              githubLogin: 'synthetic-outcome2-other-login',
              department: null,
              commitCount: 3,
              pullRequestCount: 1,
              issueCount: 0,
              repositoryCount: 1,
              starCount: 7,
              total: 4,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 2,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('@synthetic-outcome2-owner-login');
  expect(html).toContain('@synthetic-outcome2-other-login');
  expect(html).toContain('data-row-keys="1,2"');
  for (const forbidden of forbiddenRankingFields) {
    expect(html).not.toContain(forbidden);
  }
});

test('outcome-4: 발행 이전 stale 관측 때문에 아카이브에는 여전히 노출되는 프로젝트라도, 현재 관측이 비공개면 그 기여자는 랭킹에서 제외된다', () => {
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic 다른 활성 참여자',
              githubLogin: 'synthetic-outcome2-other-login',
              department: null,
              commitCount: 3,
              pullRequestCount: 1,
              issueCount: 0,
              repositoryCount: 1,
              starCount: 7,
              total: 4,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('synthetic-outcome2-other-login');
  expect(html).not.toContain('synthetic-outcome4-applicant-login');
});

test('outcome-5: 발행 후 비공개로 전환(회수)된 기여자는 이전엔 랭킹에 있었더라도 최신 응답에서 빠지면 화면에서 사라진다', () => {
  const beforeRevocationHtml = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [
            {
              rank: 1,
              displayName: 'synthetic 회수 예정 참여자',
              githubLogin: 'synthetic-outcome5-applicant-login',
              department: null,
              commitCount: 3,
              pullRequestCount: 1,
              issueCount: 0,
              repositoryCount: 1,
              starCount: 7,
              total: 4,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );
  expect(beforeRevocationHtml).toContain('synthetic-outcome5-applicant-login');

  const afterRevocationHtml = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: RANKING_YEAR_ALL,
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );
  expect(afterRevocationHtml).not.toContain(
    'synthetic-outcome5-applicant-login',
  );
  expect(afterRevocationHtml).toContain('집계된 활동 데이터가 없습니다');
});

test('갱신 시각이 있으면 화면에 기준 시각을 보여준다', () => {
  // 숫자만 있으면 오늘 값인지 석 달 전 값인지 알 수 없다 —
  // 수집이 멈춘 것을 화면이 먼저 말해야 한다(ADR-010 §10).
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          dataAsOf: new Date('2026-08-09T01:23:00.000Z'),
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('data-ranking-as-of');
});

test('갱신 시각이 없으면 시각을 숨기지 않고 "아직 수집 전"이라고 말한다', () => {
  // 예전에는 시각을 통째 생략했다. 그러면 배포 직후처럼 수집이 아직 한 번도
  // 안 돌았을 때 화면이 아무 신호도 주지 않아, 수집이 멈춘 것과 구별되지 않는다.
  const html = renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: {
          year: 2026,
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          dataAsOf: null,
          viewerClass: 'public',
          nextCycleAt: null,
        },
      }}
      {...handlers}
    />,
  );

  expect(html).toContain('data-ranking-as-of="none"');
  expect(html).toContain('아직 수집 전');
});

// 사람 축 5종 지표 (ADR-010 개정 노트 2026-08-19).
//
// 아래는 전부 **렌더된 DOM 문자열**을 본다 — 컬럼 정의나 props 를 들여다보면
// 열이 화면에서 빠져도 통과한다.

const personAxisItem = (overrides: Partial<RankingItem> = {}): RankingItem => ({
  rank: 1,
  displayName: 'synthetic-top',
  githubLogin: 'synthetic-top',
  department: null,
  commitCount: 128,
  pullRequestCount: 24,
  issueCount: 17,
  repositoryCount: 9,
  starCount: 213,
  total: 391,
  ...overrides,
});

function personAxisMarkup(
  items: readonly RankingItem[],
  options: {
    readonly dataAsOf?: Date | null;
    readonly viewerClass?: RankingViewerClass;
  },
): string {
  const dataAsOf =
    options.dataAsOf === undefined
      ? new Date('2026-08-19T02:30:00.000Z')
      : options.dataAsOf;
  const viewerClass =
    options.viewerClass === undefined ? 'public' : options.viewerClass;
  return renderToStaticMarkup(
    <RankingView
      page={1}
      state={{
        kind: 'ready',
        ranking: rankingEnvelope({
          year: 2026,
          items,
          page: 1,
          pageSize: 20,
          total: items.length,
          dataAsOf,
          viewerClass,
        }),
      }}
      {...handlers}
    />,
  );
}

test('commit·PR·issue·repo·star 5종과 합계를 화면에 그린다', () => {
  const html = personAxisMarkup([personAxisItem()], {});

  for (const header of ['Commit', 'PR', 'Issue', 'Repo', 'Star', '합계']) {
    expect(html).toContain(header);
  }
  for (const value of ['128', '24', '17', '9', '213', '391']) {
    expect(html).toContain(`>${value}<`);
  }
});

test('release 지표는 랭킹 화면에서 사라진다 — 저장소 축 전속이다', () => {
  const html = personAxisMarkup([personAxisItem()], {});

  expect(html).not.toContain('Release');
  expect(html).not.toContain('릴리스');
});

test('star 는 올해가 아니라 누적임을 화면이 밝힌다', () => {
  // 이 문구가 없으면 옆 열들과 같은 규칙(해당 연도)으로 읽혀 "올해 받은 별"로
  // 오해된다. GitHub 이 올해분 star 를 싸게 주지 않아 수집기는 계정 전체를 센다.
  const html = personAxisMarkup([personAxisItem()], {});

  expect(html).toContain('누적');
  expect(html).toContain('계정 전체 누적');
  expect(html).toContain('(누적)');
});

test('활동이 0인 가입자도 목록에서 0으로 남는다 — 빠지지 않는다', () => {
  const html = personAxisMarkup(
    [
      personAxisItem(),
      personAxisItem({
        rank: 2,
        displayName: 'synthetic-newcomer',
        githubLogin: 'synthetic-newcomer',
        department: null,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      }),
    ],
    {},
  );

  expect(html).toContain('@synthetic-newcomer');
  expect(html).toContain('data-row-keys="1,2"');
  expect(html).not.toContain('집계된 활동 데이터가 없습니다');
});

test('갱신 시각을 사람이 읽는 문구로 함께 보여준다', () => {
  const html = personAxisMarkup([personAxisItem()], {});

  expect(html).toContain('data-ranking-as-of="2026-08-19T02:30:00.000Z"');
  // Asia/Seoul 기준 표기 — 속성만 있고 눈에 보이는 글자가 없으면 소용없다.
  expect(html).toContain('기준');
  expect(html).toMatch(/2026[^<]*8[^<]*19/);
});

test('비로그인 화면 DOM 에는 실명 같은 비공개 값이 없다', () => {
  // 이 화면에는 세션이 없다. 서버가 공개 계층에 실명을 애초에 싣지 않으므로
  // 화면이 지울 값 자체가 없다 — 아래는 그 사실이 DOM 에서도 유지되는지 본다.
  const html = personAxisMarkup(
    [
      personAxisItem(),
      personAxisItem({
        rank: 2,
        displayName: 'synthetic-second',
        githubLogin: 'synthetic-second',
        department: null,
        total: 3,
      }),
    ],
    {},
  );

  for (const forbidden of [...forbiddenRankingFields, '홍길동']) {
    expect(html).not.toContain(forbidden);
  }
});

// 수집 전 / 전원 0 상태 (배포 직후 첫 sweep 이전).
//
// 이 두 화면은 "모두가 진짜로 아무것도 안 했다"와 글자 그대로 같아 보인다.
// 그대로 두면 이번에 고치려는 버그(학생이 0으로만 보임)와 구별이 안 된다.

test('dataAsOf 가 null 이면 수집 전임을 화면이 설명한다 — 0 만 남기지 않는다', () => {
  const html = personAxisMarkup(
    [
      personAxisItem({
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      }),
    ],
    { dataAsOf: null },
  );

  expect(html).toContain('아직 수집 전입니다');
  expect(html).toContain('수집 전 기본값');
  expect(html).toContain('data-ranking-as-of="none"');
  // 설명만 붙일 뿐 사람을 지우지 않는다.
  expect(html).toContain('@synthetic-top');
  expect(html).toContain('data-row-keys="1"');
});

test('전원이 0 이면 그 사실을 따로 말하고, 그래도 전원을 목록에 남긴다', () => {
  // `items.length === 0` 은 사람 축에서 사실상 오지 않는다 — 가입자는 항상 행을
  // 갖는다. 그래서 빈 목록 문구에 기대면 이 상태는 영원히 설명되지 않는다.
  const zero = (rank: number, login: string): RankingItem =>
    personAxisItem({
      rank,
      displayName: login,
      githubLogin: login,
      department: null,
      commitCount: 0,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
      total: 0,
    });
  const html = personAxisMarkup(
    [
      zero(1, 'synthetic-top'),
      zero(2, 'synthetic-second'),
      zero(3, 'synthetic-newcomer'),
    ],
    {},
  );

  expect(html).toContain('집계된 활동이 아직 없습니다');
  expect(html).toContain('참여자 전원이 그대로 남아');
  expect(html).toContain('data-row-keys="1,2,3"');
  expect(html).toContain('@synthetic-newcomer');
  // 수집은 돌았으므로 기준 시각은 그대로 보인다.
  expect(html).toContain('data-ranking-as-of="2026-08-19T02:30:00.000Z"');
  expect(html).not.toContain('아직 수집 전입니다');
});

test('한 명이라도 활동이 있으면 대기 안내를 띄우지 않는다', () => {
  const html = personAxisMarkup(
    [
      personAxisItem(),
      personAxisItem({
        rank: 2,
        displayName: 'synthetic-newcomer',
        githubLogin: 'synthetic-newcomer',
        department: null,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      }),
    ],
    {},
  );

  expect(html).not.toContain('집계된 활동이 아직 없습니다');
  expect(html).not.toContain('아직 수집 전입니다');
});

const STAFF_ROW = {
  name: 'synthetic-staff-name',
  githubLogin: 'synthetic-gildong',
  department: '소프트웨어공학과',
} as const;

const publicTierRow = (): RankingItem =>
  personAxisItem({
    displayName: STAFF_ROW.githubLogin,
    githubLogin: STAFF_ROW.githubLogin,
    department: STAFF_ROW.department,
  });

const staffTierRow = (): RankingItem =>
  personAxisItem({
    displayName: STAFF_ROW.githubLogin,
    githubLogin: STAFF_ROW.githubLogin,
    name: STAFF_ROW.name,
    department: STAFF_ROW.department,
  });

test('공개 화면은 @login 한 줄과 학과만 보이고 이름·CSV 가 없다', () => {
  const html = personAxisMarkup([publicTierRow()], { dataAsOf: null });

  expect(html).toContain('학과');
  expect(html).toContain(STAFF_ROW.department);
  expect(html).toContain(`@${STAFF_ROW.githubLogin}`);
  expect(html).not.toContain(STAFF_ROW.name);
  expect(html).not.toContain('>이름<');
  expect(html).not.toContain('CSV 내려받기');
  expect(html).toContain('data-slot="page-header-actions"');
  expect(html).toContain('data-ranking-as-of="none"');
  expect(html).not.toContain('data-slot="program-countdown"');
});

test('viewerClass public 이면 세션이 학생처럼 보여도 이름·CSV 를 더하지 않는다', () => {
  const html = personAxisMarkup([publicTierRow()], {
    dataAsOf: null,
    viewerClass: 'public',
  });

  expect(html).not.toContain('>이름<');
  expect(html).not.toContain('CSV 내려받기');
  expect(html).not.toContain(STAFF_ROW.name);
});

test('viewerClass staff 이면 이름 열과 CSV 버튼을 그린다', () => {
  const html = personAxisMarkup([staffTierRow()], {
    dataAsOf: null,
    viewerClass: 'staff',
  });

  expect(html).toContain('>이름<');
  expect(html).toContain(`>${STAFF_ROW.name}<`);
  expect(html).toContain(`@${STAFF_ROW.githubLogin}`);
  expect(html).toContain(STAFF_ROW.department);
  expect(html).toContain('CSV 내려받기');
  expect(html).toContain(
    'data-column-widths="rank:w-8,name:w-24,member:w-24,department:w-20,commit:w-12 text-right,pr:w-12 text-right,issue:w-12 text-right,repository:w-12 text-right,star:w-12 text-right,total:w-12 text-right"',
  );
});

test('staff 행의 name 이 null 이면 이름 칸에 대시를 그린다', () => {
  const html = personAxisMarkup(
    [
      personAxisItem({
        displayName: 'nameless-login',
        githubLogin: 'nameless-login',
        name: null,
        department: STAFF_ROW.department,
      }),
    ],
    { dataAsOf: null, viewerClass: 'staff' },
  );

  expect(html).toContain('이름 미입력');
  expect(html).toContain('@nameless-login');
});

test('학과가 없으면 대시를 그린다 — 빈칸으로 두거나 깨지지 않는다', () => {
  const html = personAxisMarkup([personAxisItem({ department: null })], {
    dataAsOf: null,
  });

  expect(html).toContain('>-<');
  expect(html).toContain('학과 미입력');
  expect(html).toContain('@synthetic-top');
});

test('department 칸이 아예 없는 낡은 응답도 대시로 그린다 — 크래시하지 않는다', () => {
  const { department: _omitted, ...withoutDepartment } = personAxisItem();
  const html = personAxisMarkup([withoutDepartment as RankingItem], {
    dataAsOf: null,
    viewerClass: 'staff',
  });

  expect(html).toContain('>-<');
  expect(html).toContain('@synthetic-top');
});

test('기준 시각은 PageHeader actions 의 time 요소에 있다', () => {
  const html = personAxisMarkup([personAxisItem()], {});

  expect(html).toContain('data-slot="page-header-actions"');
  expect(html).toContain('data-ranking-as-of="2026-08-19T02:30:00.000Z"');
  expect(html).toContain('<time');
  expect(html).toContain('dateTime="2026-08-19T02:30:00.000Z"');
  expect(html).not.toContain('data-slot="program-countdown"');
});

test('권한 열이 붙어도 5종 지표·star 누적 문구·수집 안내는 그대로다', () => {
  const staff = personAxisMarkup([staffTierRow()], {
    dataAsOf: null,
    viewerClass: 'staff',
  });

  for (const header of ['Commit', 'PR', 'Issue', 'Repo', 'Star', '합계']) {
    expect(staff).toContain(header);
  }
  expect(staff).toContain('(누적)');
  expect(staff).toContain('계정 전체 누적');
  expect(staff).toContain('아직 수집 전입니다');
  expect(staff).toContain('data-ranking-as-of="none"');
  expect(staff).toContain('CSV 내려받기');

  const collected = personAxisMarkup(
    [
      staffTierRow(),
      personAxisItem({
        rank: 2,
        displayName: 'synthetic-zero',
        githubLogin: 'synthetic-zero',
        name: 'synthetic-zero-name',
        department: null,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      }),
    ],
    {
      dataAsOf: new Date('2026-08-19T02:30:00.000Z'),
      viewerClass: 'staff',
    },
  );

  expect(collected).toContain('@synthetic-zero');
  expect(collected).toContain('data-row-keys="1,2"');
  expect(collected).toContain('data-ranking-as-of="2026-08-19T02:30:00.000Z"');

  const allZero = personAxisMarkup(
    [
      personAxisItem({
        displayName: 'synthetic-gildong',
        githubLogin: 'synthetic-gildong',
        name: 'synthetic-staff-name',
        department: null,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      }),
    ],
    {
      dataAsOf: new Date('2026-08-19T02:30:00.000Z'),
      viewerClass: 'staff',
    },
  );
  expect(allZero).toContain('집계된 활동이 아직 없습니다');
});

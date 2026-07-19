import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkTeamStateDrift,
  exitCodeFor,
  formatReport,
} from './team-state-check-lib.mjs';

const RECENT_GENERATED_AT = '2026-07-20T09:00:00+09:00';
const NOW = new Date('2026-07-20T10:00:00+09:00');

function teamStateFixture() {
  return `# TEAM-STATE

## 메타

| 항목 | 값 |
| --- | --- |
| generated_at | ${RECENT_GENERATED_AT} |
| source_commit | abc1234 (main) |

## 기능 상태

| 기능 | owner | 상태 | parent Issue | PR | CI | blocker (unblock owner) |
| --- | --- | --- | --- | --- | --- | --- |
| 합성 가이드 | @synthetic-owner | review | #111 | #112 | pass | 없음 |
| 합성 로그인 | @synthetic-owner | review | #109 | #113 | pass | 없음 |
| 합성 수집기 | @synthetic-owner | review | #110 | #114 | pass | #113 merge 후 base 전환 (@synthetic-reviewer 리뷰) |
`;
}

function activePlanFixture() {
  return `# exec-plan: 합성 로그인

- owner: @synthetic-owner / Issue: #109 / 브랜치: \`feat/synthetic-login\`
- 상태: 구현 중

## 구현 단계

1. [x] 합성 설계
2. [ ] 합성 구현
`;
}

function teamStateRowsFixture(rows) {
  return `# TEAM-STATE

## 메타

| 항목 | 값 |
| --- | --- |
| generated_at | ${RECENT_GENERATED_AT} |
| source_commit | abc1234 (main) |

## 기능 상태

| 기능 | owner | 상태 | parent Issue | PR | CI | blocker (unblock owner) |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function singleFeatureGithub({
  issue = { state: 'open' },
  pull = { number: 202, state: 'open', mergedAt: null, base: 'main' },
  branchPulls = [],
  failPull = false,
  failBranch = false,
} = {}) {
  return {
    async getIssue() {
      return issue;
    },
    async getPull() {
      if (failPull) {
        throw new Error('synthetic pull failure');
      }
      return pull;
    },
    async findPullsByHead() {
      if (failBranch) {
        throw new Error('synthetic branch failure');
      }
      return branchPulls;
    },
  };
}

function singleFeatureCheck({
  row = '| 합성 기능 | @synthetic-owner | review | #201 | #202 | pass | 없음 |',
  activePlans = [],
  github = singleFeatureGithub(),
  inspectSourceCommit = async () => ({ status: 'clean', commitsBehind: 0 }),
} = {}) {
  return checkTeamStateDrift({
    teamStatePath: 'docs/handoff/TEAM-STATE.md',
    teamStateText: teamStateRowsFixture([row]),
    activePlans,
    github,
    now: NOW,
    inspectSourceCommit,
  });
}

function githubFixture({ failIssue = null } = {}) {
  const issues = new Map([
    [109, { state: 'closed' }],
    [110, { state: 'open' }],
    [111, { state: 'open' }],
  ]);
  const pulls = new Map([
    [112, { state: 'closed', mergedAt: '2026-07-19T01:00:00Z', base: 'main' }],
    [113, { state: 'closed', mergedAt: '2026-07-19T02:00:00Z', base: 'main' }],
    [114, { state: 'open', mergedAt: null, base: 'main' }],
  ]);

  return {
    async getIssue(number) {
      if (number === failIssue) {
        throw new Error('synthetic GitHub failure');
      }
      return issues.get(number) ?? { state: 'open' };
    },
    async getPull(number) {
      return (
        pulls.get(number) ?? { state: 'open', mergedAt: null, base: 'main' }
      );
    },
    async findPullsByHead(branch) {
      if (branch === 'feat/synthetic-login') {
        return [
          {
            number: 113,
            state: 'closed',
            mergedAt: '2026-07-19T02:00:00Z',
            base: 'main',
          },
        ];
      }
      return [];
    },
  };
}

test('TEAM-STATE의 종료 PR·해소된 stacked blocker·source commit drift를 탐지한다', async () => {
  const result = await checkTeamStateDrift({
    teamStatePath: 'docs/handoff/TEAM-STATE.md',
    teamStateText: teamStateFixture(),
    activePlans: [],
    github: githubFixture(),
    now: NOW,
    inspectSourceCommit: async () => ({
      status: 'stale',
      commitsBehind: 7,
      changedFiles: ['apps/synthetic/example.mjs'],
    }),
  });

  const findingKeys = result.findings.map(
    ({ code, subject }) => `${code}:${subject}`,
  );
  assert.ok(findingKeys.includes('TEAM_STATE_PR_TERMINAL:PR #112'));
  assert.ok(findingKeys.includes('TEAM_STATE_PR_TERMINAL:PR #113'));
  assert.ok(findingKeys.includes('TEAM_STATE_BLOCKER_RESOLVED:PR #114'));
  assert.ok(findingKeys.includes('SOURCE_COMMIT_STALE:abc1234'));
  assert.equal(exitCodeFor(result), 1);
});

test('active exec-plan의 종료 parent Issue와 main 병합 PR을 재검토로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    teamStatePath: 'docs/handoff/TEAM-STATE.md',
    teamStateText: teamStateFixture(),
    activePlans: [
      {
        path: 'docs/exec-plan/active/synthetic-login.md',
        text: activePlanFixture(),
      },
    ],
    github: githubFixture(),
    now: NOW,
    inspectSourceCommit: async () => ({ status: 'clean', commitsBehind: 0 }),
  });

  const codes = result.findings.map(({ code }) => code);
  assert.ok(codes.includes('EXEC_PLAN_ISSUE_CLOSED'));
  assert.ok(codes.includes('EXEC_PLAN_PR_MERGED'));
  assert.match(formatReport(result), /archive를 자동 수행하지 않음/);
});

test('GitHub 조회 실패를 unknown과 exit code 2로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    teamStatePath: 'docs/handoff/TEAM-STATE.md',
    teamStateText: teamStateFixture(),
    activePlans: [],
    github: githubFixture({ failIssue: 109 }),
    now: NOW,
    inspectSourceCommit: async () => ({ status: 'clean', commitsBehind: 0 }),
  });

  assert.ok(
    result.findings.some(
      ({ status, code, subject }) =>
        status === 'unknown' &&
        code === 'GITHUB_ISSUE_UNKNOWN' &&
        subject === 'Issue #109',
    ),
  );
  assert.equal(exitCodeFor(result), 2);
});

test('generated_at 48시간 초과를 stale로 보고한다', async () => {
  const oldTeamState = teamStateFixture().replace(
    RECENT_GENERATED_AT,
    '2026-07-17T09:59:59+09:00',
  );
  const result = await checkTeamStateDrift({
    teamStatePath: 'docs/handoff/TEAM-STATE.md',
    teamStateText: oldTeamState,
    activePlans: [],
    github: githubFixture(),
    now: NOW,
    inspectSourceCommit: async () => ({ status: 'clean', commitsBehind: 0 }),
  });

  assert.ok(result.findings.some(({ code }) => code === 'GENERATED_AT_STALE'));
});

test('active exec-plan의 선언됐지만 파싱할 수 없는 참조를 unknown으로 보고한다', async () => {
  const result = await singleFeatureCheck({
    row: '| 합성 대기 | @synthetic-owner | planned | - | - | - | 없음 |',
    activePlans: [
      {
        path: 'docs/exec-plan/active/malformed.md',
        text: `# exec-plan: 깨진 참조

- owner: @synthetic-owner / Issue: 번호 없음 / 브랜치: feat/missing-code-span
- 상태: 구현 중
`,
      },
    ],
  });

  const unknownKeys = result.findings
    .filter(({ status }) => status === 'unknown')
    .map(({ code, subject }) => `${code}:${subject}`);
  assert.deepEqual(unknownKeys, [
    'EXEC_PLAN_ISSUE_REFERENCE_UNKNOWN:Issue reference',
    'EXEC_PLAN_BRANCH_REFERENCE_UNKNOWN:branch reference',
  ]);
  assert.equal(exitCodeFor(result), 2);
});

test('TEAM-STATE의 파싱할 수 없는 기능 행을 unknown으로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    teamStatePath: 'docs/handoff/TEAM-STATE.md',
    teamStateText: teamStateRowsFixture([
      '| 정상 기능 | @synthetic-owner | planned | - | - | - | 없음 |',
      '| 열이 부족한 기능 | @synthetic-owner | review | #201 | #202 | pass |',
    ]),
    activePlans: [],
    github: singleFeatureGithub(),
    now: NOW,
    inspectSourceCommit: async () => ({ status: 'clean', commitsBehind: 0 }),
  });

  assert.ok(
    result.findings.some(
      ({ status, code, subject }) =>
        status === 'unknown' &&
        code === 'TEAM_STATE_ROW_UNKNOWN' &&
        subject.startsWith('기능 상태 표 line '),
    ),
  );
  assert.equal(exitCodeFor(result), 2);
});

for (const [label, pull] of [
  ['open PR', { number: 202, state: 'open', mergedAt: null, base: 'main' }],
  [
    'closed-unmerged PR',
    { number: 202, state: 'closed', mergedAt: null, base: 'main' },
  ],
]) {
  test(`TEAM-STATE의 done과 ${label} 불일치를 stale로 보고한다`, async () => {
    const result = await singleFeatureCheck({
      row: '| 합성 완료 | @synthetic-owner | done | #201 | #202 | pass | 없음 |',
      github: singleFeatureGithub({
        issue: { state: 'closed' },
        pull,
      }),
    });

    assert.ok(
      result.findings.some(
        ({ status, code, subject }) =>
          status === 'stale' &&
          code === 'TEAM_STATE_DONE_MISMATCH' &&
          subject === '기능 “합성 완료”',
      ),
    );
    assert.equal(exitCodeFor(result), 1);
  });
}

test('같은 branch의 최신 open PR이 있으면 과거 merged PR로 stale을 추론하지 않는다', async () => {
  const openPull = {
    number: 203,
    state: 'open',
    mergedAt: null,
    base: 'main',
  };
  const historicalMergedPull = {
    number: 199,
    state: 'closed',
    mergedAt: '2026-07-01T01:00:00Z',
    base: 'main',
  };
  const result = await singleFeatureCheck({
    activePlans: [
      {
        path: 'docs/exec-plan/active/reused-branch.md',
        text: `# exec-plan: 재사용 branch

- owner: @synthetic-owner / Issue: #201 / 브랜치: \`feat/reused-branch\`
- 상태: 구현 중
`,
      },
    ],
    github: singleFeatureGithub({
      branchPulls: [openPull, historicalMergedPull],
    }),
  });

  assert.ok(
    !result.findings.some(({ code }) => code === 'EXEC_PLAN_PR_MERGED'),
  );
  assert.equal(exitCodeFor(result), 0);
});

test('모든 문서 참조와 GitHub 상태가 일치하면 clean과 exit code 0을 반환한다', async () => {
  const openPull = {
    number: 202,
    state: 'open',
    mergedAt: null,
    base: 'main',
  };
  const result = await singleFeatureCheck({
    activePlans: [
      {
        path: 'docs/exec-plan/active/clean.md',
        text: `# exec-plan: 합성 clean

- owner: @synthetic-owner / Issue: #201 / 브랜치: \`feat/clean\`
- 상태: 구현 중

1. [ ] 합성 구현
`,
      },
    ],
    github: singleFeatureGithub({
      pull: openPull,
      branchPulls: [openPull],
    }),
  });

  assert.deepEqual(result.findings, []);
  assert.equal(exitCodeFor(result), 0);
  assert.match(formatReport(result), /^# TEAM-STATE drift report\n\n\[clean\]/);
});

test('source commit·PR·branch 조회 실패를 모두 unknown으로 보고한다', async () => {
  const result = await singleFeatureCheck({
    activePlans: [
      {
        path: 'docs/exec-plan/active/api-failure.md',
        text: `# exec-plan: 조회 실패

- owner: @synthetic-owner / Issue: #201 / 브랜치: \`feat/api-failure\`
- 상태: 구현 중
`,
      },
    ],
    github: singleFeatureGithub({ failPull: true, failBranch: true }),
    inspectSourceCommit: async () => {
      throw new Error('synthetic Git failure');
    },
  });

  const codes = result.findings.map(({ code }) => code);
  assert.ok(codes.includes('SOURCE_COMMIT_UNKNOWN'));
  assert.ok(codes.includes('GITHUB_PR_UNKNOWN'));
  assert.ok(codes.includes('GITHUB_BRANCH_PRS_UNKNOWN'));
  assert.ok(result.findings.every(({ status }) => status === 'unknown'));
  assert.equal(exitCodeFor(result), 2);
});

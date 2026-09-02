import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkTeamStateDrift,
  exitCodeFor,
  formatReport,
} from './team-state-check-lib.mjs';

function journalEntry(fields) {
  return `## ${fields.date} — ${fields.title}

- 상태: ${fields.state}
- Issue: ${fields.issue}
- PR: ${fields.pull}
- blocker: ${fields.blocker}
`;
}

function journalText(entries) {
  return `# @synthetic 저널\n\n${entries.join('\n')}`;
}

function journalsFromEntries(entries) {
  return [
    {
      path: 'docs/handoff/team-state/synthetic.md',
      text: journalText(entries),
    },
  ];
}

function reviewFixture() {
  return journalsFromEntries([
    journalEntry({
      date: '2026-07-20',
      title: '합성 가이드',
      state: 'review',
      issue: '#111',
      pull: '#112',
      blocker: '없음',
    }),
    journalEntry({
      date: '2026-07-20',
      title: '합성 로그인',
      state: 'review',
      issue: '#109',
      pull: '#113',
      blocker: '없음',
    }),
    journalEntry({
      date: '2026-07-20',
      title: '합성 수집기',
      state: 'review',
      issue: '#110',
      pull: '#114',
      blocker: '#113 merge 후 base 전환 (@synthetic-reviewer 리뷰)',
    }),
  ]);
}

function singleFeatureGithub(options) {
  const issue = options.issue;
  const pull = options.pull;
  const failPull = options.failPull;
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
  };
}

function openMainPull(number) {
  return { number, state: 'open', mergedAt: null, base: 'main' };
}

function githubFixture(options) {
  const failIssue = options.failIssue;
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
  };
}

test('종료 PR과 해소된 stacked blocker를 stale로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    journals: reviewFixture(),
    github: githubFixture({ failIssue: null }),
  });

  const findingKeys = result.findings.map(
    ({ code, subject }) => `${code}:${subject}`,
  );
  assert.ok(findingKeys.includes('TEAM_STATE_PR_TERMINAL:PR #112'));
  assert.ok(findingKeys.includes('TEAM_STATE_PR_TERMINAL:PR #113'));
  assert.ok(findingKeys.includes('TEAM_STATE_BLOCKER_RESOLVED:PR #114'));
  assert.equal(exitCodeFor(result), 1);
});

test('GitHub 조회 실패를 unknown과 exit code 2로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    journals: reviewFixture(),
    github: githubFixture({ failIssue: 109 }),
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

test('저널 파일이 없으면 unknown으로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    journals: [],
    github: githubFixture({ failIssue: null }),
  });

  assert.ok(
    result.findings.some(({ code }) => code === 'TEAM_STATE_JOURNAL_UNKNOWN'),
  );
  assert.equal(exitCodeFor(result), 2);
});

test('제목만 있는 저널은 항목 0건으로 clean이다', async () => {
  const result = await checkTeamStateDrift({
    journals: [
      {
        path: 'docs/handoff/team-state/empty.md',
        text: '# @synthetic 저널\n',
      },
    ],
    github: githubFixture({ failIssue: null }),
  });

  assert.deepEqual(result.findings, []);
  assert.equal(exitCodeFor(result), 0);
});

test('파싱할 수 없는 저널 항목을 unknown으로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    journals: journalsFromEntries([
      journalEntry({
        date: '2026-07-20',
        title: '정상 기능',
        state: 'planned',
        issue: '-',
        pull: '-',
        blocker: '없음',
      }),
      '## 2026-07-20 — 깨진 항목\n\n- 상태: review\n',
    ]),
    github: singleFeatureGithub({
      issue: { state: 'open' },
      pull: openMainPull(202),
      failPull: false,
    }),
  });

  assert.ok(
    result.findings.some(
      ({ status, code, subject }) =>
        status === 'unknown' &&
        code === 'TEAM_STATE_ROW_UNKNOWN' &&
        subject.startsWith('저널 항목 line '),
    ),
  );
  assert.equal(exitCodeFor(result), 2);
});

test('(이 PR)은 유효하고 PR 조회를 하지 않는다', async () => {
  const result = await checkTeamStateDrift({
    journals: journalsFromEntries([
      journalEntry({
        date: '2026-07-20',
        title: '번호 없는 PR',
        state: 'review',
        issue: '-',
        pull: '(이 PR)',
        blocker: '없음',
      }),
    ]),
    github: singleFeatureGithub({
      issue: { state: 'open' },
      pull: openMainPull(202),
      failPull: true,
    }),
  });

  assert.deepEqual(result.findings, []);
  assert.equal(exitCodeFor(result), 0);
});

test('같은 Issue의 나중 done이 이전 review stale을 덮는다', async () => {
  const result = await checkTeamStateDrift({
    journals: journalsFromEntries([
      journalEntry({
        date: '2026-07-18',
        title: '합성 완료',
        state: 'review',
        issue: '#201',
        pull: '#202',
        blocker: '없음',
      }),
      journalEntry({
        date: '2026-07-20',
        title: '합성 완료',
        state: 'done',
        issue: '#201',
        pull: '#202',
        blocker: '없음',
      }),
    ]),
    github: singleFeatureGithub({
      issue: { state: 'closed' },
      pull: {
        number: 202,
        state: 'closed',
        mergedAt: '2026-07-19T01:00:00Z',
        base: 'main',
      },
      failPull: false,
    }),
  });

  assert.deepEqual(result.findings, []);
  assert.equal(exitCodeFor(result), 0);
});

for (const [label, pull] of [
  ['open PR', openMainPull(202)],
  [
    'closed-unmerged PR',
    { number: 202, state: 'closed', mergedAt: null, base: 'main' },
  ],
]) {
  test(`done과 ${label} 불일치를 stale로 보고한다`, async () => {
    const result = await checkTeamStateDrift({
      journals: journalsFromEntries([
        journalEntry({
          date: '2026-07-20',
          title: '합성 완료',
          state: 'done',
          issue: '#201',
          pull: '#202',
          blocker: '없음',
        }),
      ]),
      github: singleFeatureGithub({
        issue: { state: 'closed' },
        pull,
        failPull: false,
      }),
    });

    assert.ok(
      result.findings.some(
        ({ status, code, subject }) =>
          status === 'stale' &&
          code === 'TEAM_STATE_DONE_MISMATCH' &&
          subject === '저널 항목 “합성 완료”',
      ),
    );
    assert.equal(exitCodeFor(result), 1);
  });
}

test('모든 문서 참조와 GitHub 상태가 일치하면 clean과 exit code 0을 반환한다', async () => {
  const openPull = openMainPull(202);
  const result = await checkTeamStateDrift({
    journals: journalsFromEntries([
      journalEntry({
        date: '2026-07-20',
        title: '합성 기능',
        state: 'review',
        issue: '#201',
        pull: '#202',
        blocker: '없음',
      }),
    ]),
    github: singleFeatureGithub({
      issue: { state: 'open' },
      pull: openPull,
      failPull: false,
    }),
  });

  assert.deepEqual(result.findings, []);
  assert.equal(exitCodeFor(result), 0);
  assert.match(formatReport(result), /^# TEAM-STATE drift report\n\n\[clean\]/);
});

test('PR 조회 실패를 unknown으로 보고한다', async () => {
  const result = await checkTeamStateDrift({
    journals: journalsFromEntries([
      journalEntry({
        date: '2026-07-20',
        title: '합성 기능',
        state: 'review',
        issue: '#201',
        pull: '#202',
        blocker: '없음',
      }),
    ]),
    github: singleFeatureGithub({
      issue: { state: 'open' },
      pull: openMainPull(202),
      failPull: true,
    }),
  });

  const codes = result.findings.map(({ code }) => code);
  assert.ok(codes.includes('GITHUB_PR_UNKNOWN'));
  assert.ok(result.findings.every(({ status }) => status === 'unknown'));
  assert.equal(exitCodeFor(result), 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateMergePolicy,
  findUnsupportedCodeownersPatterns,
  isCodeownersCandidate,
  matchesCodeownersPattern,
  parseCodeownersPatterns,
} from './merge-policy-check-lib.mjs';

const HEAD = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const OTHER_SHA = 'c'.repeat(40);

const CODEOWNERS_TEXT = `# 정책 경로
/AGENTS.md       @GoBeromsu @Lumiere001
/docs/decisions/ @GoBeromsu @Lumiere001
/.github/        @GoBeromsu @Lumiere001
/scripts/        @GoBeromsu @Lumiere001
/apps/backend/src/auth/ @GoBeromsu @Lumiere001
/apps/*/Dockerfile @GoBeromsu @Lumiere001
`;

const GENERAL_FILES = ['apps/frontend/src/features/foo/bar.tsx'];
const CANDIDATE_FILES = ['scripts/new-check.sh'];

function pull(overrides = {}) {
  return {
    number: 1,
    headSha: HEAD,
    baseRef: 'main',
    baseSha: BASE_SHA,
    ...overrides,
  };
}

function mergeReadyBody({
  head = HEAD,
  baseRef = 'main',
  baseSha = BASE_SHA,
  risk = 'GENERAL',
  markers = {},
} = {}) {
  const values = {
    CODE_CONTRACT:
      'PASS — 계약 일치 https://github.com/JNU-SWCU/oss-hub/pull/1/files',
    PONYTAIL: 'PASS — 중복·불필요 복잡도 없음',
    QA: 'PASS — 브라우저에서 정상/오류 흐름 확인',
    CLI: 'PASS — lint·test·build 통과',
    CI: 'PASS — https://github.com/JNU-SWCU/oss-hub/actions/runs/1',
    ...markers,
  };
  const lines = [
    `MERGE_READY head=${head} base=${baseRef} base_sha=${baseSha} risk=${risk}`,
    '',
  ];
  for (const [marker, value] of Object.entries(values)) {
    if (value !== null) {
      lines.push(`${marker}: ${value}`);
    }
  }
  return lines.join('\n');
}

function comment(id, authorLogin, body) {
  return { id, authorLogin, body };
}

const pmAccept = (head = HEAD, baseRef = 'main', baseSha = BASE_SHA) =>
  `PM_ACCEPT head=${head} base=${baseRef} base_sha=${baseSha}`;
const techLeadAccept = (head = HEAD, baseRef = 'main', baseSha = BASE_SHA) =>
  `TECH_LEAD_ACCEPT head=${head} base=${baseRef} base_sha=${baseSha}`;
const riskAccept = (role, head = HEAD, baseRef = 'main', baseSha = BASE_SHA) =>
  `RISK_ACCEPT role=${role} head=${head} base=${baseRef} base_sha=${baseSha} risk=GENERAL`;

function evaluate({
  pullData = pull(),
  comments = [],
  changedFiles = GENERAL_FILES,
} = {}) {
  return evaluateMergePolicy({
    pull: pullData,
    comments,
    changedFiles,
    codeownersText: CODEOWNERS_TEXT,
  });
}

test('일반 PR: 현재 head·base 고정 MERGE_READY와 증거가 있으면 통과한다', () => {
  const result = evaluate({
    comments: [comment(10, 'Lumiere001', mergeReadyBody())],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'GENERAL');
  assert.equal(result.mergeReadyCommentId, 10);
});

test('증거 marker가 없으면 실패한다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        mergeReadyBody({ markers: { PONYTAIL: null } }),
      ),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('PONYTAIL')));
});

test('증거 marker 값이 비어 있으면 실패한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ markers: { CI: '' } })),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('CI')));
});

test('stale head의 MERGE_READY는 무효다', () => {
  const result = evaluate({
    comments: [comment(10, 'Lumiere001', mergeReadyBody({ head: OTHER_SHA }))],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('무효')));
});

test('stale base SHA의 MERGE_READY는 무효다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ baseSha: OTHER_SHA })),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('base ref가 다른 MERGE_READY는 무효다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ baseRef: 'release' })),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('default branch가 아닌 base의 PR은 fail-closed다', () => {
  const result = evaluate({
    pullData: pull({ baseRef: 'release' }),
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ baseRef: 'release' })),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('fail-closed')));
});

test('full SHA가 아니면 판정 불능으로 실패한다', () => {
  const result = evaluate({ pullData: pull({ headSha: 'abc123' }) });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('full SHA')));
});

test('CODEOWNERS 후보의 GENERAL 하향은 이중 RISK_ACCEPT로 통과한다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM')),
      comment(12, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('CODEOWNERS 후보에 단일 RISK_ACCEPT만 있으면 실패한다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM')),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('RISK_ACCEPT')));
});

test('다른 head에 고정된 RISK_ACCEPT는 무효다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM', OTHER_SHA)),
      comment(12, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('잘못된 actor의 RISK_ACCEPT는 무효다 — role=PM은 PM만 남길 수 있다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'Lumiere001', riskAccept('PM')),
      comment(12, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('HIGH_RISK: PM·Tech Lead accept가 모두 현재 head·base에 있으면 통과한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept()),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'HIGH_RISK');
});

test('HIGH_RISK: 단일 accept만 있으면 실패한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('PM_ACCEPT')));
});

test('HIGH_RISK: 다른 head에 고정된 accept는 무효다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept(OTHER_SHA)),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('HIGH_RISK: 잘못된 actor의 PM_ACCEPT는 무효다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'Lumiere001', pmAccept()),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('docs-only QA N/A는 구체적 사유가 있으면 허용한다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        mergeReadyBody({
          markers: {
            QA: 'N/A — 문서만 변경하며 관찰 가능한 UI/API 동작 변경이 없음',
          },
        }),
      ),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('QA N/A에 사유가 없으면 실패한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ markers: { QA: 'N/A' } })),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('N/A')));
});

test('BLOCKED/UNVERIFIED가 포함된 MERGE_READY는 실패한다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        mergeReadyBody({
          markers: { QA: 'BLOCKED/UNVERIFIED — 실행 환경 부재' },
        }),
      ),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some((reason) => reason.includes('BLOCKED/UNVERIFIED')),
  );
});

test('URL 없이 요약만 있는 증거도 허용한다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        mergeReadyBody({
          markers: { CI: 'PASS — required CI 5개 green 확인' },
        }),
      ),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('허용되지 않은 actor의 MERGE_READY는 무시한다 — 진단은 note로만 남는다', () => {
  const result = evaluate({
    comments: [comment(10, 'jinsol1190-rgb', mergeReadyBody())],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some((reason) => reason.includes('MERGE_READY 기록이 없음')),
  );
  assert.ok(result.notes.some((note) => note.includes('허용되지 않은 actor')));
});

test('백틱·코드 블록으로 인용된 토큰은 승인으로 세지 않는다', () => {
  const quoted = [
    '내용에 동의하시면 아래 토큰으로 승인 부탁드립니다:',
    '',
    `\`${pmAccept()}\``,
    '```',
    techLeadAccept(),
    '```',
  ].join('\n');
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', quoted),
      comment(12, 'Lumiere001', quoted),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('key=value 줄바꿈 변형 등 형식이 다른 accept는 인정하지 않는다', () => {
  const variant = [
    'PM_ACCEPT',
    `head_sha=${HEAD}`,
    `base_sha=${BASE_SHA}`,
    'actor=@GoBeromsu',
  ].join('\n');
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', variant),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('댓글 삭제를 반영해 현재 댓글만으로 판정한다 — MERGE_READY가 사라지면 실패한다', () => {
  const before = evaluate({
    comments: [comment(10, 'Lumiere001', mergeReadyBody())],
  });
  const after = evaluate({ comments: [] });
  assert.equal(before.conclusion, 'success');
  assert.equal(after.conclusion, 'failure');
});

test('현재 head·base에 고정된 MERGE_READY가 여럿이면 최신 것이 위험도를 결정한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(20, 'Lumiere001', mergeReadyBody({ risk: 'GENERAL' })),
    ],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'GENERAL');
  assert.equal(result.mergeReadyCommentId, 20);
});

test('CODEOWNERS 패턴 매칭 — 디렉터리·glob·정확 일치', () => {
  const patterns = parseCodeownersPatterns(CODEOWNERS_TEXT);
  assert.ok(matchesCodeownersPattern('/scripts/', 'scripts/foo.sh'));
  assert.ok(matchesCodeownersPattern('/.github/', '.github/workflows/ci.yml'));
  assert.ok(matchesCodeownersPattern('/AGENTS.md', 'AGENTS.md'));
  assert.ok(!matchesCodeownersPattern('/AGENTS.md', 'docs/AGENTS.md'));
  assert.ok(
    matchesCodeownersPattern('/apps/*/Dockerfile', 'apps/backend/Dockerfile'),
  );
  assert.ok(
    !matchesCodeownersPattern(
      '/apps/*/Dockerfile',
      'apps/backend/sub/Dockerfile',
    ),
  );
  assert.ok(
    isCodeownersCandidate(patterns, ['apps/backend/src/auth/auth.service.ts']),
  );
  assert.ok(
    !isCodeownersCandidate(patterns, ['apps/backend/src/programs/foo.ts']),
  );
});

test('제3자의 MERGE_READY 접두 댓글은 유효한 MERGE_READY를 오염시키지 않는다 (게이트 DoS 방지)', () => {
  const result = evaluate({
    comments: [
      comment(9, 'jinsol1190-rgb', 'MERGE_READY 인 것 같은데요?'),
      comment(10, 'Lumiere001', mergeReadyBody()),
    ],
  });
  assert.equal(result.conclusion, 'success');
  assert.ok(result.notes.some((note) => note.includes('허용되지 않은 actor')));
});

test('허용 actor의 형식 불일치 초안 댓글도 유효한 MERGE_READY를 오염시키지 않는다', () => {
  const result = evaluate({
    comments: [
      comment(9, 'Lumiere001', 'MERGE_READY: 검증 끝나면 곧 남길게요'),
      comment(10, 'Lumiere001', mergeReadyBody()),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('HTML 주석 안에 숨긴 accept 토큰은 세지 않는다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', `감사합니다.\n<!--\n${pmAccept()}\n-->`),
      comment(12, 'Lumiere001', `확인했습니다.\n<!-- ${techLeadAccept()} -->`),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('~~~ fence 안의 accept 토큰은 세지 않는다', () => {
  const quoted = ['예시:', '~~~', pmAccept(), '~~~'].join('\n');
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', quoted),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('4칸 들여쓰기 코드 블록의 토큰은 세지 않는다 — MERGE_READY 예시 포함', () => {
  const indentedAccept = `예시:\n\n    ${pmAccept()}`;
  const indentedMergeReady = mergeReadyBody({ risk: 'HIGH_RISK' })
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  const result = evaluate({
    comments: [
      comment(9, 'Lumiere001', indentedMergeReady),
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', indentedAccept),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.risk, 'HIGH_RISK');
});

test('여러 줄에 걸친 인라인 코드 스팬 안의 토큰은 세지 않는다', () => {
  const spanned = ['다음 형식을 참고: `', pmAccept(), '` 입니다.'].join('\n');
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', spanned),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('소문자 n/a·해당 없음 표기도 사유가 없으면 실패한다', () => {
  for (const value of ['n/a', 'NA', '해당 없음']) {
    const result = evaluate({
      comments: [
        comment(10, 'Lumiere001', mergeReadyBody({ markers: { QA: value } })),
      ],
    });
    assert.equal(result.conclusion, 'failure', `QA: ${value}`);
  }
});

test('UNVERIFIED 단독 표기도 미검증으로 차단한다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        mergeReadyBody({ markers: { QA: 'UNVERIFIED — 환경 없음' } }),
      ),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('댓글 수정으로 토큰이 다른 head를 가리키면 무효가 된다 (stateless 재평가)', () => {
  const before = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept()),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  const afterEdit = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept(OTHER_SHA)),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(before.conclusion, 'success');
  assert.equal(afterEdit.conclusion, 'failure');
});

test('다른 base SHA에 고정된 RISK_ACCEPT는 무효다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM', HEAD, 'main', OTHER_SHA)),
      comment(12, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('지원하지 않는 CODEOWNERS 패턴이 있으면 판정 불능으로 fail-closed한다', () => {
  const result = evaluateMergePolicy({
    pull: pull(),
    comments: [comment(10, 'Lumiere001', mergeReadyBody())],
    changedFiles: GENERAL_FILES,
    codeownersText: `${CODEOWNERS_TEXT}\n*.md @GoBeromsu\n`,
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('판정 불능')));
  assert.deepEqual(findUnsupportedCodeownersPatterns('*.md @a\n/ok/ @b'), [
    '*.md',
  ]);
});

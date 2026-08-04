import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECK_RUN_NAME,
  collectChangedPaths,
  evaluateMergePolicy,
  findUnsupportedCodeownersPatterns,
  isCodeownersCandidate,
  matchesCodeownersPattern,
  matchesDeployContractPattern,
  matchedDeployContractPatterns,
  parseCodeownersPatterns,
  planCheckRunPublish,
  touchesDeployContract,
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

# 배포 정의 — 실제 .github/CODEOWNERS와 동일하게 배포 계약 경로도 후보로 남긴다.
/Jenkinsfile     @GoBeromsu @Lumiere001
/compose.yml     @GoBeromsu @Lumiere001
/.env.example    @GoBeromsu @Lumiere001
/deploy/         @GoBeromsu @Lumiere001
/apps/*/Dockerfile @GoBeromsu @Lumiere001
/.dockerignore   @GoBeromsu @Lumiere001
`;

const GENERAL_FILES = ['apps/frontend/src/features/foo/bar.tsx'];
const CANDIDATE_FILES = ['scripts/new-check.sh'];
const DEPLOY_CONTRACT_FILES = ['Jenkinsfile'];
const JENKINS_SCRIPT_FILES = ['scripts/jenkins/validate-rollback-images.sh'];

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

test('리뷰 증거 전용 계정의 MERGE_READY는 일반 PR에서 유효하다', () => {
  const result = evaluate({
    comments: [comment(10, 'Lumeire002', mergeReadyBody())],
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

// 시나리오 7: 단일 RISK_ACCEPT로 GENERAL 하향 → PASS
test('CODEOWNERS 후보(배포 외 경로)의 GENERAL 하향은 단일 RISK_ACCEPT로 통과한다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('CODEOWNERS 후보의 GENERAL 하향은 PM 단독 RISK_ACCEPT로도 통과한다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM')),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

// 시나리오 8: 배포 계약 경로에서 RISK_ACCEPT role=TECH_LEAD 하향 → FAIL
test('배포 계약 경로의 GENERAL 하향은 role=TECH_LEAD RISK_ACCEPT로는 실패한다', () => {
  const result = evaluate({
    changedFiles: DEPLOY_CONTRACT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some(
      (reason) => reason.includes('role=PM') && reason.includes('Jenkinsfile'),
    ),
  );
});

test('배포 계약 경로의 GENERAL 하향은 role=PM RISK_ACCEPT로 통과한다', () => {
  const result = evaluate({
    changedFiles: DEPLOY_CONTRACT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM')),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('CODEOWNERS 후보에 RISK_ACCEPT가 전혀 없으면 실패한다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [comment(10, 'Lumiere001', mergeReadyBody())],
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
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

// PM 작성 PR은 어떤 사람의 review·accept도 요구하지 않는다 (PM 결정, 2026-07-30).
// required check(`ci`·`public-safe`)는 그대로 강제되므로 기계적 검증은 유지된다.

const pmPull = (overrides = {}) =>
  pull({ authorLogin: 'GoBeromsu', ...overrides });

test('PM 작성 PR: 댓글이 전혀 없어도 통과한다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull(),
    comments: [],
    changedFiles: GENERAL_FILES,
    codeownersText: CODEOWNERS_TEXT,
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'PM_AUTHORED');
  assert.deepEqual(result.reasons, []);
});

test('PM 작성 PR: 배포 계약 경로도 accept 없이 통과한다', () => {
  for (const files of [DEPLOY_CONTRACT_FILES, CANDIDATE_FILES]) {
    const result = evaluateMergePolicy({
      pull: pmPull(),
      comments: [],
      changedFiles: files,
      codeownersText: CODEOWNERS_TEXT,
    });
    assert.equal(result.conclusion, 'success', JSON.stringify(files));
  }
});

test('PM 작성 PR: 면제 사유가 note로 남는다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull(),
    comments: [],
    changedFiles: DEPLOY_CONTRACT_FILES,
    codeownersText: CODEOWNERS_TEXT,
  });
  assert.ok(
    result.notes.some((n) => n.includes('GoBeromsu') && n.includes('면제')),
    JSON.stringify(result.notes),
  );
});

test('Tech Lead 작성 PR은 면제되지 않는다', () => {
  const result = evaluateMergePolicy({
    pull: pull({ authorLogin: 'Lumiere001' }),
    comments: [],
    changedFiles: GENERAL_FILES,
    codeownersText: CODEOWNERS_TEXT,
  });
  assert.equal(result.conclusion, 'failure');
});

test('제3자 작성 PR은 면제되지 않는다', () => {
  for (const who of ['jinsol1190-rgb', 'GOBEROMSU', 'GoBeromsu2', '']) {
    const result = evaluateMergePolicy({
      pull: pull({ authorLogin: who }),
      comments: [],
      changedFiles: GENERAL_FILES,
      codeownersText: CODEOWNERS_TEXT,
    });
    assert.equal(result.conclusion, 'failure', `면제됨: ${who}`);
  }
});

test('authorLogin 부재는 면제되지 않는다 (fail-closed)', () => {
  for (const who of [undefined, null]) {
    const result = evaluateMergePolicy({
      pull: pull({ authorLogin: who }),
      comments: [],
      changedFiles: GENERAL_FILES,
      codeownersText: CODEOWNERS_TEXT,
    });
    assert.equal(result.conclusion, 'failure', `면제됨: ${who}`);
  }
});

test('PM 작성 PR도 head·base SHA 형식 검증은 통과해야 한다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull({ headSha: 'short' }),
    comments: [],
    changedFiles: GENERAL_FILES,
    codeownersText: CODEOWNERS_TEXT,
  });
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.risk, 'UNKNOWN');
});

test('PM 작성 PR도 base가 main이 아니면 fail-closed다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull({ baseRef: 'develop' }),
    comments: [],
    changedFiles: GENERAL_FILES,
    codeownersText: CODEOWNERS_TEXT,
  });
  assert.equal(result.conclusion, 'failure');
});

// 시나리오 1: 배포 외 경로 + PM 단독 accept → PASS
test('HIGH_RISK(배포 외 경로): PM 단독 accept로 통과한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept()),
    ],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'HIGH_RISK');
});

// 시나리오 2: 배포 외 경로 + TECH_LEAD 단독 accept → PASS
test('HIGH_RISK(배포 외 경로): TECH_LEAD 단독 accept로 통과한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'HIGH_RISK');
});

// 시나리오 3: 배포 계약 경로 + TECH_LEAD 단독 accept → FAIL (사유에 매칭 패턴 포함)
test('HIGH_RISK(배포 계약 경로): TECH_LEAD 단독 accept는 실패하고 사유에 매칭 패턴이 남는다', () => {
  const result = evaluate({
    changedFiles: DEPLOY_CONTRACT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.includes('Jenkinsfile') && reason.includes('PM_ACCEPT'),
    ),
  );
});

// 시나리오 4: 배포 계약 경로 + PM accept → PASS
test('HIGH_RISK(배포 계약 경로): PM accept로 통과한다', () => {
  const result = evaluate({
    changedFiles: DEPLOY_CONTRACT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept()),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

// 시나리오 5: accept 0건 → FAIL
test('HIGH_RISK: accept가 전혀 없으면 실패한다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.includes('PM_ACCEPT') && reason.includes('TECH_LEAD_ACCEPT'),
    ),
  );
});

// 시나리오 6: stale head accept(현재 head·base에 미고정) → FAIL
test('HIGH_RISK: 다른 head에 고정된 accept는 무효다(stale)', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept(OTHER_SHA)),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('HIGH_RISK: 잘못된 actor의 PM_ACCEPT는 무효다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'Lumiere001', pmAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('리뷰 증거 전용 계정의 TECH_LEAD_ACCEPT는 무효다', () => {
  const result = evaluate({
    comments: [
      comment(10, 'Lumeire002', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'Lumeire002', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.includes('PM_ACCEPT') && reason.includes('TECH_LEAD_ACCEPT'),
    ),
  );
});

test('리뷰 증거 전용 계정의 RISK_ACCEPT는 무효다', () => {
  const result = evaluate({
    changedFiles: CANDIDATE_FILES,
    comments: [
      comment(10, 'Lumeire002', mergeReadyBody()),
      comment(11, 'Lumeire002', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('RISK_ACCEPT')));
});

test('리뷰 증거 전용 계정의 PM_ACCEPT는 배포 계약 승인이 아니다', () => {
  const result = evaluate({
    changedFiles: DEPLOY_CONTRACT_FILES,
    comments: [
      comment(10, 'Lumeire002', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'Lumeire002', pmAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(result.reasons.some((reason) => reason.includes('PM_ACCEPT')));
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

test('배포 계약 경로 패턴 매칭 — 정확 일치·apps/*/Dockerfile·deploy/** 재귀', () => {
  assert.ok(matchesDeployContractPattern('Jenkinsfile', 'Jenkinsfile'));
  assert.ok(!matchesDeployContractPattern('Jenkinsfile', 'apps/Jenkinsfile'));
  assert.ok(
    matchesDeployContractPattern(
      'apps/*/Dockerfile',
      'apps/backend/Dockerfile',
    ),
  );
  assert.ok(
    !matchesDeployContractPattern(
      'apps/*/Dockerfile',
      'apps/backend/sub/Dockerfile',
    ),
  );
  assert.ok(matchesDeployContractPattern('deploy/**', 'deploy/nginx.conf'));
  assert.ok(matchesDeployContractPattern('deploy/**', 'deploy/sub/nginx.conf'));
  assert.ok(!matchesDeployContractPattern('deploy/**', 'docs/deploy/x.md'));
  assert.deepEqual(
    matchedDeployContractPatterns(['Jenkinsfile', 'apps/frontend/src/x.ts']),
    ['Jenkinsfile'],
  );
  assert.equal(touchesDeployContract(['deploy/nginx.conf']), true);
  assert.equal(touchesDeployContract(['apps/frontend/src/x.ts']), false);
});

// Jenkinsfile 절차 로직을 scripts/jenkins/ 로 추출해도 PM 전속 보호가 유지되어야 한다.
// 이 경로가 배포 계약에서 빠지면 추출 자체가 승인 요건을 낮추는 우회로가 된다.

test('배포 계약 경로: scripts/jenkins/** 는 재귀로 매칭된다', () => {
  assert.equal(touchesDeployContract(JENKINS_SCRIPT_FILES), true);
  assert.equal(
    touchesDeployContract(['scripts/jenkins/nested/helper.sh']),
    true,
  );
  assert.deepEqual(matchedDeployContractPatterns(JENKINS_SCRIPT_FILES), [
    'scripts/jenkins/**',
  ]);
});

test('배포 계약 경로: scripts/jenkins 인접 경로는 매칭되지 않는다', () => {
  assert.equal(touchesDeployContract(['scripts/jenkins-helper.sh']), false);
  assert.equal(touchesDeployContract(['scripts/check-public-safe.sh']), false);
});

test('HIGH_RISK(scripts/jenkins/**): TECH_LEAD 단독 accept는 실패한다', () => {
  const result = evaluate({
    changedFiles: JENKINS_SCRIPT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.includes('scripts/jenkins/**') && reason.includes('PM_ACCEPT'),
    ),
    `사유에 매칭 패턴이 없다: ${JSON.stringify(result.reasons)}`,
  );
});

test('HIGH_RISK(scripts/jenkins/**): PM accept로 통과한다', () => {
  const result = evaluate({
    changedFiles: JENKINS_SCRIPT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept()),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

test('배포 계약 경로: scripts/jenkins/** 의 GENERAL 하향은 role=PM만 허용한다', () => {
  const techLead = evaluate({
    changedFiles: JENKINS_SCRIPT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'GENERAL' })),
      comment(11, 'Lumiere001', riskAccept('TECH_LEAD')),
    ],
  });
  assert.equal(techLead.conclusion, 'failure');

  const pm = evaluate({
    changedFiles: JENKINS_SCRIPT_FILES,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'GENERAL' })),
      comment(11, 'GoBeromsu', riskAccept('PM')),
    ],
  });
  assert.equal(pm.conclusion, 'success');
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

test('BLOCKED 단독 표기도 미검증으로 차단한다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        mergeReadyBody({ markers: { QA: 'BLOCKED — 실행 환경 부재' } }),
      ),
    ],
  });
  assert.equal(result.conclusion, 'failure');
  assert.ok(
    result.reasons.some((reason) => reason.includes('BLOCKED/UNVERIFIED')),
  );
});

test('댓글 수정으로 토큰이 다른 head를 가리키면 무효가 된다 (stateless 재평가)', () => {
  const before = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept()),
    ],
  });
  const afterEdit = evaluate({
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(11, 'GoBeromsu', pmAccept(OTHER_SHA)),
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

test('rename previous_filename이 CODEOWNERS 후보면 GENERAL 하향에 RISK_ACCEPT가 필요하다', () => {
  const changedFiles = collectChangedPaths([
    {
      filename: 'apps/frontend/src/lib/moved-auth.ts',
      previous_filename: 'apps/backend/src/auth/session.ts',
    },
  ]);
  assert.deepEqual(changedFiles, [
    'apps/frontend/src/lib/moved-auth.ts',
    'apps/backend/src/auth/session.ts',
  ]);
  const withoutAccept = evaluate({
    changedFiles,
    comments: [comment(10, 'Lumiere001', mergeReadyBody())],
  });
  assert.equal(withoutAccept.conclusion, 'failure');
  assert.ok(
    withoutAccept.reasons.some((reason) => reason.includes('RISK_ACCEPT')),
  );
  const withAccept = evaluate({
    changedFiles,
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody()),
      comment(11, 'GoBeromsu', riskAccept('PM')),
    ],
  });
  assert.equal(withAccept.conclusion, 'success');
});

test('normal HIGH_RISK Tech Lead accept remains sufficient', () => {
  const result = evaluate({
    pullData: pull({ changedFiles: 1 }),
    comments: [
      comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' })),
      comment(12, 'Lumiere001', techLeadAccept()),
    ],
  });
  assert.equal(result.conclusion, 'success');
});

// 발행 계획 — 같은 head SHA 재평가가 check run을 누적하면 required check 판정이
// 비결정적이 된다. 아래 fixture가 그 회귀를 고정한다.

function checkRun(overrides = {}) {
  return {
    id: 1,
    name: CHECK_RUN_NAME,
    head_sha: HEAD,
    status: 'completed',
    conclusion: 'failure',
    ...overrides,
  };
}

test('발행 계획: 기존 run이 없으면 생성한다', () => {
  assert.deepEqual(planCheckRunPublish([], HEAD), {
    create: true,
    updateIds: [],
  });
});

test('발행 계획: 같은 head의 기존 run은 생성하지 않고 갱신한다', () => {
  assert.deepEqual(planCheckRunPublish([checkRun({ id: 77 })], HEAD), {
    create: false,
    updateIds: [77],
  });
});

test('발행 계획: 누적된 동명 run을 전부 갱신 대상으로 삼는다', () => {
  const runs = [
    checkRun({ id: 30 }),
    checkRun({ id: 10 }),
    checkRun({ id: 20, conclusion: 'success' }),
  ];
  assert.deepEqual(planCheckRunPublish(runs, HEAD), {
    create: false,
    updateIds: [10, 20, 30],
  });
});

test('발행 계획: 다른 이름의 check run은 갱신하지 않는다', () => {
  const runs = [
    checkRun({ id: 5, name: 'merge-policy-evaluate' }),
    checkRun({ id: 6, name: 'ci' }),
  ];
  assert.deepEqual(planCheckRunPublish(runs, HEAD), {
    create: true,
    updateIds: [],
  });
});

test('발행 계획: 다른 head SHA의 run은 갱신하지 않는다', () => {
  const runs = [checkRun({ id: 9, head_sha: OTHER_SHA })];
  assert.deepEqual(planCheckRunPublish(runs, HEAD), {
    create: true,
    updateIds: [],
  });
});

test('발행 계획: 같은 head와 다른 head가 섞이면 같은 head만 갱신한다', () => {
  const runs = [
    checkRun({ id: 41, head_sha: OTHER_SHA }),
    checkRun({ id: 42 }),
  ];
  assert.deepEqual(planCheckRunPublish(runs, HEAD), {
    create: false,
    updateIds: [42],
  });
});

test('발행 계획: 목록이 배열이 아니면 실패한다', () => {
  assert.throws(() => planCheckRunPublish(null, HEAD), /배열이 아닙니다/);
  assert.throws(
    () => planCheckRunPublish({ check_runs: [] }, HEAD),
    /배열이 아닙니다/,
  );
});

test('발행 계획: head SHA가 40자 hex가 아니면 실패한다', () => {
  assert.throws(() => planCheckRunPublish([], 'abc'), /head SHA/);
  assert.throws(() => planCheckRunPublish([], undefined), /head SHA/);
});

test('발행 계획: run id가 정수가 아니면 실패한다', () => {
  assert.throws(
    () => planCheckRunPublish([checkRun({ id: 'x' })], HEAD),
    /정수가 아닙니다/,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECK_RUN_NAME,
  evaluateMergePolicy,
  planCheckRunPublish,
} from './merge-policy-check-lib.mjs';

const HEAD = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const OTHER_SHA = 'c'.repeat(40);

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

function evaluate({ pullData = pull(), comments = [] } = {}) {
  return evaluateMergePolicy({ pull: pullData, comments });
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

test('HIGH_RISK로 기록된 MERGE_READY도 accept 없이 증거만으로 통과한다', () => {
  const result = evaluate({
    comments: [comment(10, 'Lumiere001', mergeReadyBody({ risk: 'HIGH_RISK' }))],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'HIGH_RISK');
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

// PM 작성 PR은 어떤 사람의 review·accept도 요구하지 않는다 (PM 결정, 2026-07-30).
// required check(`ci`·`public-safe`)는 그대로 강제되므로 기계적 검증은 유지된다.

const pmPull = (overrides = {}) =>
  pull({ authorLogin: 'GoBeromsu', ...overrides });

test('PM 작성 PR: 댓글이 전혀 없어도 통과한다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull(),
    comments: [],
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.risk, 'PM_AUTHORED');
  assert.deepEqual(result.reasons, []);
});

test('PM 작성 PR: 면제 사유가 note로 남는다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull(),
    comments: [],
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
  });
  assert.equal(result.conclusion, 'failure');
});

test('제3자 작성 PR은 면제되지 않는다', () => {
  for (const who of ['jinsol1190-rgb', 'GOBEROMSU', 'GoBeromsu2', '']) {
    const result = evaluateMergePolicy({
      pull: pull({ authorLogin: who }),
      comments: [],
    });
    assert.equal(result.conclusion, 'failure', `면제됨: ${who}`);
  }
});

test('authorLogin 부재는 면제되지 않는다 (fail-closed)', () => {
  for (const who of [undefined, null]) {
    const result = evaluateMergePolicy({
      pull: pull({ authorLogin: who }),
      comments: [],
    });
    assert.equal(result.conclusion, 'failure', `면제됨: ${who}`);
  }
});

test('PM 작성 PR도 head·base SHA 형식 검증은 통과해야 한다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull({ headSha: 'short' }),
    comments: [],
  });
  assert.equal(result.conclusion, 'failure');
  assert.equal(result.risk, 'UNKNOWN');
});

test('PM 작성 PR도 base가 main이 아니면 fail-closed다', () => {
  const result = evaluateMergePolicy({
    pull: pmPull({ baseRef: 'develop' }),
    comments: [],
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

test('HTML 주석 안에 숨긴 MERGE_READY 토큰은 세지 않는다', () => {
  const result = evaluate({
    comments: [
      comment(
        10,
        'Lumiere001',
        `감사합니다.\n<!--\n${mergeReadyBody({ risk: 'HIGH_RISK' })}\n-->`,
      ),
    ],
  });
  assert.equal(result.conclusion, 'failure');
});

test('~~~ fence 안의 MERGE_READY 토큰은 세지 않는다', () => {
  const quoted = ['예시:', '~~~', mergeReadyBody(), '~~~'].join('\n');
  const result = evaluate({
    comments: [comment(10, 'Lumiere001', quoted)],
  });
  assert.equal(result.conclusion, 'failure');
});

test('4칸 들여쓰기 코드 블록의 MERGE_READY 예시는 세지 않는다', () => {
  const indentedMergeReady = mergeReadyBody({ risk: 'HIGH_RISK' })
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  const result = evaluate({
    comments: [comment(9, 'Lumiere001', indentedMergeReady)],
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

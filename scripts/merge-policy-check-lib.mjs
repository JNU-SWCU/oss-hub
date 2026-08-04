// merge-policy 판정 라이브러리 — GitHub metadata만 입력받아 병합 게이트를 판정한다.
// 계약 원본: ADR-005, Issue #226. PR head 코드는 어떤 경로로도 읽거나 실행하지 않는다.
// accept 코멘트(PM_ACCEPT·TECH_LEAD_ACCEPT·RISK_ACCEPT) 요건은 폐지됐다 — 접근 제어는
// GitHub platform 기능(브랜치 보호·CODEOWNERS 등)으로 옮겼다. 이 판정기는 전남의
// exact-head `MERGE_READY` 리뷰 기록과 그 안의 근거(evidence marker)만 검증한다.

const FULL_SHA = /^[0-9a-f]{40}$/;
const MERGE_READY_HEAD_LINE =
  /^MERGE_READY head=([0-9a-f]{40}) base=(\S+) base_sha=([0-9a-f]{40}) risk=(GENERAL|HIGH_RISK)$/;
const EVIDENCE_MARKERS = ['CODE_CONTRACT', 'PONYTAIL', 'QA', 'CLI', 'CI'];
const QA_NA_MIN_REASON_LENGTH = 10;

export const MERGE_READY_ACTORS = ['GoBeromsu', 'Lumiere001', 'Lumeire002'];
export const PM_ACTOR = 'GoBeromsu';

// 인용·비가시 영역의 토큰이 승인으로 오인되는 것을 막는다.
// 제거 대상: HTML 주석, ```·~~~ 코드 fence, 4칸 이상 들여쓰기 코드 블록,
// 백틱 인용 줄과 여러 줄에 걸친 인라인 코드 스팬. 토큰은 들여쓰기 없는
// 가시적 최상위 줄에서만 인정된다.
export function effectiveLines(body) {
  const withoutHtmlComments = String(body ?? '')
    .replaceAll('\r\n', '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
  const result = [];
  let fenceMarker = null;
  let inInlineSpan = false;
  for (const rawLine of withoutHtmlComments.split('\n')) {
    const line = rawLine.trim();
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (fence && !inInlineSpan) {
      if (fenceMarker === null) {
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        fenceMarker = null;
      }
      continue;
    }
    if (fenceMarker !== null) {
      continue;
    }
    if (/^( {4,}|\t)/.test(rawLine)) {
      continue;
    }
    const backtickCount = (line.match(/`/g) ?? []).length;
    if (inInlineSpan) {
      if (backtickCount % 2 === 1) {
        inInlineSpan = false;
      }
      continue;
    }
    if (line.startsWith('`')) {
      if (backtickCount % 2 === 1) {
        inInlineSpan = true;
      }
      continue;
    }
    if (backtickCount % 2 === 1) {
      inInlineSpan = true;
    }
    result.push(line);
  }
  return result;
}

function pinnedToCurrent(pull, head, baseRef, baseSha) {
  return (
    pull.headSha === head &&
    pull.baseRef === baseRef &&
    pull.baseSha === baseSha
  );
}

// MERGE_READY 후보 중 [허용 actor + 첫 줄 형식 + 현재 head/base 고정]을 만족하는 최신 댓글을 고른다.
// 무효 후보는 판정 사유가 아니라 진단 note로만 남긴다 — 제3자·초안 댓글이
// 유효한 MERGE_READY를 오염시키는 것(공개 repo 게이트 DoS)을 막는다.
function findMergeReady(pull, comments, notes) {
  let latest = null;
  let sawStale = false;
  for (const comment of comments) {
    const lines = effectiveLines(comment.body);
    const firstLine = lines.find((line) => line.length > 0) ?? '';
    if (!firstLine.startsWith('MERGE_READY')) {
      continue;
    }
    if (!MERGE_READY_ACTORS.includes(comment.authorLogin)) {
      notes.push(
        `MERGE_READY 무시 — 허용되지 않은 actor @${comment.authorLogin} (comment ${comment.id})`,
      );
      continue;
    }
    const match = firstLine.match(MERGE_READY_HEAD_LINE);
    if (!match) {
      notes.push(
        `MERGE_READY 무시 — 첫 줄이 'MERGE_READY head=<full-sha> base=<ref> base_sha=<full-sha> risk=<GENERAL|HIGH_RISK>' 형식이 아님 (comment ${comment.id})`,
      );
      continue;
    }
    const [, head, baseRef, baseSha, risk] = match;
    if (!pinnedToCurrent(pull, head, baseRef, baseSha)) {
      sawStale = true;
      continue;
    }
    if (latest === null || comment.id > latest.commentId) {
      latest = {
        commentId: comment.id,
        actor: comment.authorLogin,
        risk,
        lines,
      };
    }
  }
  return { latest, sawStale };
}

function checkEvidenceMarkers(mergeReady, reasons) {
  const body = mergeReady.lines.join('\n');
  // Issue #226·ADR-005: BLOCKED와 UNVERIFIED 모두 미검증으로 병합 불가.
  // 복합 표기(BLOCKED/UNVERIFIED)와 단독 표기를 같은 규칙으로 차단한다.
  if (/\b(?:BLOCKED|UNVERIFIED)\b/i.test(body)) {
    reasons.push(
      'MERGE_READY에 BLOCKED/UNVERIFIED 상태가 포함됨 — 미검증 동작은 병합 불가',
    );
  }
  for (const marker of EVIDENCE_MARKERS) {
    const line = mergeReady.lines.find((candidate) =>
      candidate.startsWith(`${marker}:`),
    );
    const value = line ? line.slice(marker.length + 1).trim() : '';
    if (value.length === 0) {
      reasons.push(`증거 marker 누락 또는 빈 값 — ${marker}:`);
      continue;
    }
    if (marker !== 'QA') {
      continue;
    }
    const notApplicable = value.match(/^(n\/?a|해당\s*없음)[\s—–:.-]*/i);
    if (notApplicable) {
      const reason = value.slice(notApplicable[0].length);
      if (reason.length < QA_NA_MIN_REASON_LENGTH) {
        reasons.push(
          'QA: N/A에는 관찰 가능한 동작 변경이 없다는 구체적 사유가 함께 필요함',
        );
      }
    }
  }
}

// 메인 판정 — 입력은 전부 GitHub metadata이며 결정적이다.
export function evaluateMergePolicy({
  pull,
  comments,
  defaultBranch = 'main',
}) {
  const reasons = [];
  const notes = [];

  if (!FULL_SHA.test(pull.headSha) || !FULL_SHA.test(pull.baseSha)) {
    reasons.push('PR head/base SHA를 40자 full SHA로 확인하지 못함');
    return verdict('failure', 'UNKNOWN', reasons, notes, null);
  }
  if (pull.baseRef !== defaultBranch) {
    reasons.push(
      `게이트는 ${defaultBranch} 대상 PR에만 적용 — base가 ${pull.baseRef}인 PR은 fail-closed`,
    );
    return verdict('failure', 'UNKNOWN', reasons, notes, null);
  }

  // PM이 작성한 PR은 어떤 사람의 review·accept도 요구하지 않는다 (PM 결정, 2026-07-30).
  // required check는 `ci`·`public-safe`가 그대로 강제하므로 기계적 검증은 유지된다.
  if (pull.authorLogin === PM_ACTOR) {
    notes.push(
      `@${PM_ACTOR} 작성 PR — review·accept 면제 (required CI는 그대로 적용)`,
    );
    return verdict('success', 'PM_AUTHORED', reasons, notes, null);
  }

  const sortedComments = [...comments].sort((a, b) => a.id - b.id);
  const { latest: mergeReady, sawStale } = findMergeReady(
    pull,
    sortedComments,
    notes,
  );
  if (!mergeReady) {
    reasons.push(
      sawStale
        ? 'stale MERGE_READY만 존재 — head, base ref 또는 base SHA가 바뀌어 이전 증거는 무효 (ADR-005)'
        : '현재 head·base에 고정된 MERGE_READY 기록이 없음',
    );
    return verdict('failure', 'UNKNOWN', reasons, notes, null);
  }

  checkEvidenceMarkers(mergeReady, reasons);

  return verdict(
    reasons.length === 0 ? 'success' : 'failure',
    mergeReady.risk,
    reasons,
    notes,
    mergeReady.commentId,
  );
}

function verdict(conclusion, risk, reasons, notes, mergeReadyCommentId) {
  return {
    conclusion,
    risk,
    reasons,
    notes,
    mergeReadyCommentId,
  };
}

export const CHECK_RUN_NAME = 'merge-policy';

/**
 * 같은 head SHA의 재평가가 check run을 누적하지 않도록 발행 계획을 정한다.
 * 동일 (name, head_sha) run이 이미 있으면 전부 갱신 대상으로 삼는다 — 한 SHA에
 * 서로 다른 결론이 공존하면 required check 판정이 비결정적이 되기 때문이다.
 *
 * @param {unknown} existingRuns GitHub check-runs 응답의 check_runs 배열
 * @param {string} headSha 판정 대상 head SHA
 * @returns {{ create: boolean, updateIds: number[] }}
 */
export function planCheckRunPublish(existingRuns, headSha) {
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error('check run 발행 계획에 유효한 head SHA가 필요합니다');
  }
  if (!Array.isArray(existingRuns)) {
    throw new Error('GitHub check run 목록이 배열이 아닙니다');
  }

  const updateIds = [];
  for (const run of existingRuns) {
    if (run?.name !== CHECK_RUN_NAME) {
      continue;
    }
    if (run?.head_sha !== headSha) {
      continue;
    }
    if (!Number.isInteger(run?.id)) {
      throw new Error('GitHub check run id가 정수가 아닙니다');
    }
    updateIds.push(run.id);
  }

  updateIds.sort((left, right) => left - right);
  return { create: updateIds.length === 0, updateIds };
}

export function formatSummary(result, pull) {
  const lines = [
    `- head: \`${pull.headSha}\``,
    `- base: \`${pull.baseRef}\` @ \`${pull.baseSha}\``,
    `- risk: ${result.risk}`,
  ];
  if (result.mergeReadyCommentId) {
    lines.push(`- MERGE_READY comment id: ${result.mergeReadyCommentId}`);
  }
  if (result.conclusion === 'success') {
    lines.push(
      '- 판정: PASS — 증거가 현재 head·base에 고정되어 있음',
    );
  } else {
    lines.push('- 판정: FAIL');
    for (const reason of result.reasons) {
      lines.push(`  - ${reason}`);
    }
  }
  for (const note of result.notes ?? []) {
    lines.push(`- 참고: ${note}`);
  }
  return `${lines.join('\n')}\n`;
}

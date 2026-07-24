// merge-policy 판정 라이브러리 — GitHub metadata만 입력받아 병합 게이트를 판정한다.
// 계약 원본: ADR-005, Issue #226. PR head 코드는 어떤 경로로도 읽거나 실행하지 않는다.

const FULL_SHA = /^[0-9a-f]{40}$/;
const MERGE_READY_HEAD_LINE =
  /^MERGE_READY head=([0-9a-f]{40}) base=(\S+) base_sha=([0-9a-f]{40}) risk=(GENERAL|HIGH_RISK)$/;
const PM_ACCEPT_LINE =
  /^PM_ACCEPT head=([0-9a-f]{40}) base=(\S+) base_sha=([0-9a-f]{40})$/;
const TECH_LEAD_ACCEPT_LINE =
  /^TECH_LEAD_ACCEPT head=([0-9a-f]{40}) base=(\S+) base_sha=([0-9a-f]{40})$/;
const RISK_ACCEPT_LINE =
  /^RISK_ACCEPT role=(PM|TECH_LEAD) head=([0-9a-f]{40}) base=(\S+) base_sha=([0-9a-f]{40}) risk=GENERAL$/;
const EVIDENCE_MARKERS = ['CODE_CONTRACT', 'PONYTAIL', 'QA', 'CLI', 'CI'];
const QA_NA_MIN_REASON_LENGTH = 10;

export const MERGE_READY_ACTORS = ['GoBeromsu', 'Lumiere001'];
export const PM_ACTOR = 'GoBeromsu';
export const TECH_LEAD_ACTOR = 'Lumiere001';

// 코드 fence(```)와 백틱으로 시작하는 인용 줄을 제거한다 — 토큰 인용이 승인으로 오인되는 것을 막는다.
export function effectiveLines(body) {
  const lines = String(body ?? '')
    .replaceAll('\r\n', '\n')
    .split('\n');
  const result = [];
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.startsWith('`')) {
      continue;
    }
    result.push(line);
  }
  return result;
}

// CODEOWNERS 패턴 파싱 — 이 repo가 쓰는 anchored 패턴 부분집합만 지원한다.
export function parseCodeownersPatterns(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter((pattern) => pattern.startsWith('/'));
}

export function matchesCodeownersPattern(pattern, filePath) {
  const anchored = pattern.slice(1);
  if (anchored.includes('*')) {
    const regex = new RegExp(
      `^${anchored.split('*').map(escapeRegExp).join('[^/]*')}$`,
    );
    return regex.test(filePath);
  }
  if (anchored.endsWith('/')) {
    return filePath.startsWith(anchored);
  }
  return filePath === anchored || filePath.startsWith(`${anchored}/`);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isCodeownersCandidate(patterns, changedFiles) {
  return changedFiles.some((filePath) =>
    patterns.some((pattern) => matchesCodeownersPattern(pattern, filePath)),
  );
}

function pinnedToCurrent(pull, head, baseRef, baseSha) {
  return (
    pull.headSha === head &&
    pull.baseRef === baseRef &&
    pull.baseSha === baseSha
  );
}

// MERGE_READY 후보 중 [허용 actor + 첫 줄 형식 + 현재 head/base 고정]을 만족하는 최신 댓글을 고른다.
function findMergeReady(pull, comments, reasons) {
  let latest = null;
  let sawStale = false;
  for (const comment of comments) {
    const lines = effectiveLines(comment.body);
    const firstLine = lines.find((line) => line.length > 0) ?? '';
    if (!firstLine.startsWith('MERGE_READY')) {
      continue;
    }
    if (!MERGE_READY_ACTORS.includes(comment.authorLogin)) {
      reasons.push(
        `MERGE_READY 무시 — 허용되지 않은 actor @${comment.authorLogin} (comment ${comment.id})`,
      );
      continue;
    }
    const match = firstLine.match(MERGE_READY_HEAD_LINE);
    if (!match) {
      reasons.push(
        `MERGE_READY 형식 불일치 — 첫 줄이 'MERGE_READY head=<full-sha> base=<ref> base_sha=<full-sha> risk=<GENERAL|HIGH_RISK>' 형식이 아님 (comment ${comment.id})`,
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
  if (latest === null && sawStale) {
    reasons.push(
      'stale MERGE_READY만 존재 — head, base ref 또는 base SHA가 바뀌어 이전 증거는 무효 (ADR-005)',
    );
  }
  return latest;
}

function checkEvidenceMarkers(mergeReady, reasons) {
  const body = mergeReady.lines.join('\n');
  if (body.includes('BLOCKED/UNVERIFIED')) {
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
    if (marker === 'QA' && /^N\/A\b/.test(value)) {
      const reason = value.slice(3).replace(/^[\s—–:-]+/, '');
      if (reason.length < QA_NA_MIN_REASON_LENGTH) {
        reasons.push(
          'QA: N/A에는 관찰 가능한 동작 변경이 없다는 구체적 사유가 함께 필요함',
        );
      }
    }
  }
}

// 지정 actor의 댓글에서 현재 head/base에 고정된 단일 줄 토큰을 찾는다.
function findAcceptToken({ pull, comments, pattern, actor, shaIndex }) {
  for (const comment of comments) {
    if (comment.authorLogin !== actor) {
      continue;
    }
    for (const line of effectiveLines(comment.body)) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }
      const head = match[shaIndex];
      const baseRef = match[shaIndex + 1];
      const baseSha = match[shaIndex + 2];
      if (pinnedToCurrent(pull, head, baseRef, baseSha)) {
        return { commentId: comment.id, actor };
      }
    }
  }
  return null;
}

function checkHighRiskAccepts(pull, comments, reasons) {
  const pmAccept = findAcceptToken({
    pull,
    comments,
    pattern: PM_ACCEPT_LINE,
    actor: PM_ACTOR,
    shaIndex: 1,
  });
  const techLeadAccept = findAcceptToken({
    pull,
    comments,
    pattern: TECH_LEAD_ACCEPT_LINE,
    actor: TECH_LEAD_ACTOR,
    shaIndex: 1,
  });
  if (!pmAccept) {
    reasons.push(
      `HIGH_RISK — 현재 head·base에 고정된 @${PM_ACTOR}의 PM_ACCEPT가 없음`,
    );
  }
  if (!techLeadAccept) {
    reasons.push(
      `HIGH_RISK — 현재 head·base에 고정된 @${TECH_LEAD_ACTOR}의 TECH_LEAD_ACCEPT가 없음`,
    );
  }
}

function findRiskAccept(pull, comments, role, actor) {
  for (const comment of comments) {
    if (comment.authorLogin !== actor) {
      continue;
    }
    for (const line of effectiveLines(comment.body)) {
      const match = line.match(RISK_ACCEPT_LINE);
      if (!match) {
        continue;
      }
      const [, matchedRole, head, baseRef, baseSha] = match;
      if (
        matchedRole === role &&
        pinnedToCurrent(pull, head, baseRef, baseSha)
      ) {
        return { commentId: comment.id };
      }
    }
  }
  return null;
}

function checkGeneralDowngrade(pull, comments, reasons) {
  const pmRiskAccept = findRiskAccept(pull, comments, 'PM', PM_ACTOR);
  const techLeadRiskAccept = findRiskAccept(
    pull,
    comments,
    'TECH_LEAD',
    TECH_LEAD_ACTOR,
  );
  if (!pmRiskAccept || !techLeadRiskAccept) {
    reasons.push(
      'CODEOWNERS 후보 경로 변경 — GENERAL 하향에는 현재 head·base에 고정된 ' +
        `@${PM_ACTOR} (role=PM)와 @${TECH_LEAD_ACTOR} (role=TECH_LEAD)의 RISK_ACCEPT가 모두 필요함 ` +
        '(또는 MERGE_READY를 risk=HIGH_RISK로 재기록하고 이중 accept 진행)',
    );
  }
}

// 메인 판정 — 입력은 전부 GitHub metadata·default-branch 파일이며 결정적이다.
export function evaluateMergePolicy({
  pull,
  comments,
  changedFiles,
  codeownersText,
  defaultBranch = 'main',
}) {
  const reasons = [];

  if (!FULL_SHA.test(pull.headSha) || !FULL_SHA.test(pull.baseSha)) {
    reasons.push('PR head/base SHA를 40자 full SHA로 확인하지 못함');
    return verdict('failure', 'UNKNOWN', reasons, null);
  }
  if (pull.baseRef !== defaultBranch) {
    reasons.push(
      `게이트는 ${defaultBranch} 대상 PR에만 적용 — base가 ${pull.baseRef}인 PR은 fail-closed`,
    );
    return verdict('failure', 'UNKNOWN', reasons, null);
  }

  const sortedComments = [...comments].sort((a, b) => a.id - b.id);
  const mergeReady = findMergeReady(pull, sortedComments, reasons);
  if (!mergeReady) {
    if (reasons.length === 0) {
      reasons.push('현재 head·base에 고정된 MERGE_READY 기록이 없음');
    }
    return verdict('failure', 'UNKNOWN', reasons, null);
  }

  checkEvidenceMarkers(mergeReady, reasons);

  const candidate = isCodeownersCandidate(
    parseCodeownersPatterns(codeownersText),
    changedFiles,
  );
  if (mergeReady.risk === 'HIGH_RISK') {
    checkHighRiskAccepts(pull, sortedComments, reasons);
  } else if (candidate) {
    checkGeneralDowngrade(pull, sortedComments, reasons);
  }

  return verdict(
    reasons.length === 0 ? 'success' : 'failure',
    mergeReady.risk,
    reasons,
    mergeReady.commentId,
  );
}

function verdict(conclusion, risk, reasons, mergeReadyCommentId) {
  return { conclusion, risk, reasons, mergeReadyCommentId };
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
      '- 판정: PASS — 증거와 필요한 accept가 현재 head·base에 고정되어 있음',
    );
  } else {
    lines.push('- 판정: FAIL');
    for (const reason of result.reasons) {
      lines.push(`  - ${reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

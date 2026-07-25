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
export const PM_EMERGENCY_ACCEPT_LINE =
  /^PM_EMERGENCY_ACCEPT head=([0-9a-f]{40}) base=(main) base_sha=([0-9a-f]{40}) policy_sha=([0-9a-f]{40}) window=(2026-07-26-KST)$/;
export const OWNER_CONFIRM_LINE =
  /^OWNER_CONFIRM head=([0-9a-f]{40}) base=(main) base_sha=([0-9a-f]{40})$/;
export const EMERGENCY_POLICY_PR_NUMBER = 258;
export const EMERGENCY_CUTOFF = '2026-07-26T15:00:00.000Z';
export const EMERGENCY_WINDOW_LABEL = '2026-07-26-KST';
export const EMERGENCY_PR_NUMBER = 256;
export const OWNER_ACTOR = 'jinsol1190-rgb';
export const EMERGENCY_DENYLIST = [
  'AGENTS.md',
  '**/AGENTS.md',
  '.github/CODEOWNERS',
  'docs/decisions/ADR-002*',
  'docs/decisions/ADR-005*',
  '.github/workflows/**',
  '.github/actions/**',
  '.github/emergency-*',
  'scripts/merge-policy-check.mjs',
  'scripts/merge-policy-check-lib.mjs',
  'scripts/merge-policy-check.test.mjs',
];

export const MERGE_READY_ACTORS = ['GoBeromsu', 'Lumiere001'];
export const PM_ACTOR = 'GoBeromsu';
export const TECH_LEAD_ACTOR = 'Lumiere001';

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

// CODEOWNERS 패턴 파싱 — 이 repo가 쓰는 anchored 패턴 부분집합만 지원한다.
export function parseCodeownersPatterns(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter((pattern) => pattern.startsWith('/'));
}

// 판정기가 해석하지 못하는 CODEOWNERS 패턴은 무시하지 않고 판정 불능(fail-closed)으로 처리한다.
export function findUnsupportedCodeownersPatterns(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .filter((pattern) => !pattern.startsWith('/'));
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

// PR files API의 filename + previous_filename을 모두 모아 rename/move가
// CODEOWNERS 후보 경로를 빠져나가지 못하게 한다.
export function collectChangedPaths(files) {
  const paths = [];
  for (const file of files ?? []) {
    if (file?.filename) {
      paths.push(file.filename);
    }
    if (file?.previous_filename) {
      paths.push(file.previous_filename);
    }
  }
  return paths;
}

const GITHUB_FILE_STATUSES = new Set([
  'added',
  'changed',
  'copied',
  'modified',
  'removed',
  'renamed',
  'unchanged',
]);

export function hasCompletePullFiles(files, changedFiles) {
  return (
    Array.isArray(files) &&
    Number.isInteger(changedFiles) &&
    files.length === changedFiles &&
    files.every(
      (file) =>
        typeof file?.filename === 'string' &&
        GITHUB_FILE_STATUSES.has(file?.status) &&
        (file.status !== 'renamed' ||
          (typeof file.previous_filename === 'string' &&
            file.previous_filename.length > 0)) &&
        (file.previous_filename === undefined ||
          typeof file.previous_filename === 'string'),
    )
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

// 지정 actor의 댓글에서 현재 head/base에 고정된 단일 줄 토큰을 찾는다.
function findAcceptToken({ pull, comments, pattern, actor }) {
  for (const comment of comments) {
    if (comment.authorLogin !== actor) {
      continue;
    }
    for (const line of effectiveLines(comment.body)) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }
      const [, head, baseRef, baseSha] = match;
      if (pinnedToCurrent(pull, head, baseRef, baseSha)) {
        return { commentId: comment.id, actor };
      }
    }
  }
  return null;
}

function matchesEmergencyDenylist(path) {
  return (
    path === 'AGENTS.md' ||
    path.endsWith('/AGENTS.md') ||
    path === '.github/CODEOWNERS' ||
    path.startsWith('docs/decisions/ADR-002') ||
    path.startsWith('docs/decisions/ADR-005') ||
    path.startsWith('.github/workflows/') ||
    path.startsWith('.github/actions/') ||
    path.startsWith('.github/emergency-') ||
    path === 'scripts/merge-policy-check.mjs' ||
    path === 'scripts/merge-policy-check-lib.mjs' ||
    path === 'scripts/merge-policy-check.test.mjs'
  );
}

function isUnedited(comment) {
  const createdAt = Date.parse(comment.createdAt);
  const updatedAt = Date.parse(comment.updatedAt);
  return Number.isFinite(createdAt) && createdAt === updatedAt;
}

export function checkEmergencyApproval({
  pull,
  comments,
  files,
  policy,
  auditReasons = [],
}) {
  if (pull.number !== EMERGENCY_PR_NUMBER) {
    return false;
  }
  const reject = (reason) => {
    auditReasons.push(`PR #256 긴급 승인 무효 — ${reason}`);
    return false;
  };
  if (EMERGENCY_POLICY_PR_NUMBER === 0) {
    return reject('정책 PR 번호가 비활성 상태임');
  }
  if (policy?.prNumber !== EMERGENCY_POLICY_PR_NUMBER) {
    return reject('정책 PR 번호가 고정값과 일치하지 않음');
  }
  if (!FULL_SHA.test(policy?.mergeCommitSha ?? '')) {
    return reject('정책 merge SHA를 확인하지 못함');
  }
  if (policy.mergeCommitIsAncestorOfBase !== true) {
    return reject('정책 merge SHA가 현재 base의 조상이 아님');
  }
  if (!hasCompletePullFiles(files, pull.changedFiles)) {
    return reject('PR files 목록의 완전성을 증명하지 못함');
  }
  if (
    files.some((file) =>
      [file.filename, file.previous_filename]
        .filter(Boolean)
        .some(matchesEmergencyDenylist),
    )
  ) {
    return reject('제어면 denylist 경로가 변경됨');
  }

  const mergedAt = Date.parse(policy.mergedAt);
  const cutoff = Date.parse(EMERGENCY_CUTOFF);
  if (!Number.isFinite(mergedAt)) {
    return reject('정책 PR merged_at을 확인하지 못함');
  }
  const emergencyAccept = comments.find((comment) => {
    if (comment.authorLogin !== PM_ACTOR || !isUnedited(comment)) {
      return false;
    }
    const createdAt = Date.parse(comment.createdAt);
    if (createdAt < mergedAt || createdAt >= cutoff) {
      return false;
    }
    return effectiveLines(comment.body).some((line) => {
      const match = line.match(PM_EMERGENCY_ACCEPT_LINE);
      return (
        match &&
        pinnedToCurrent(pull, match[1], match[2], match[3]) &&
        match[4] === policy.mergeCommitSha
      );
    });
  });
  if (!emergencyAccept) {
    return reject('유효한 unedited PM_EMERGENCY_ACCEPT가 없음');
  }
  const ownerConfirm = comments.find(
    (comment) =>
      comment.authorLogin === OWNER_ACTOR &&
      isUnedited(comment) &&
      effectiveLines(comment.body).some((line) => {
        const match = line.match(OWNER_CONFIRM_LINE);
        return match && pinnedToCurrent(pull, match[1], match[2], match[3]);
      }),
  );
  if (!ownerConfirm) {
    return reject(`유효한 @${OWNER_ACTOR} OWNER_CONFIRM이 없음`);
  }
  return {
    policyPrNumber: policy.prNumber,
    policyMergeCommitSha: policy.mergeCommitSha,
    policyMergedAt: policy.mergedAt,
    emergencyCommentId: emergencyAccept.id,
    ownerCommentId: ownerConfirm.id,
    windowLabel: EMERGENCY_WINDOW_LABEL,
    timestampsValid: true,
    filesComplete: true,
    denylistClear: true,
  };
}

function checkHighRiskAccepts(pull, comments, reasons, files, policy) {
  const pmAccept = findAcceptToken({
    pull,
    comments,
    pattern: PM_ACCEPT_LINE,
    actor: PM_ACTOR,
  });
  const techLeadAccept = findAcceptToken({
    pull,
    comments,
    pattern: TECH_LEAD_ACCEPT_LINE,
    actor: TECH_LEAD_ACTOR,
  });
  const emergencyEvidence = techLeadAccept
    ? null
    : checkEmergencyApproval({
        pull,
        comments,
        files,
        policy,
        auditReasons: reasons,
      });
  if (!pmAccept) {
    reasons.push(
      `HIGH_RISK — 현재 head·base에 고정된 @${PM_ACTOR}의 PM_ACCEPT가 없음`,
    );
  }
  if (!techLeadAccept && !emergencyEvidence) {
    reasons.push(
      `HIGH_RISK — 현재 head·base에 고정된 @${TECH_LEAD_ACTOR}의 TECH_LEAD_ACCEPT가 없음`,
    );
  }
  return emergencyEvidence
    ? {
        ...emergencyEvidence,
        retainedGates: {
          mergeReady: true,
          pmAccept: Boolean(pmAccept),
        },
      }
    : null;
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
  files,
  policy,
  codeownersText,
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
  const unsupportedPatterns = findUnsupportedCodeownersPatterns(codeownersText);
  if (unsupportedPatterns.length > 0) {
    reasons.push(
      `판정 불능 — CODEOWNERS에 판정기가 지원하지 않는 패턴 존재: ${unsupportedPatterns.join(', ')} (fail-closed)`,
    );
    return verdict('failure', 'UNKNOWN', reasons, notes, null);
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

  const candidate = isCodeownersCandidate(
    parseCodeownersPatterns(codeownersText),
    changedFiles,
  );
  let emergencyEvidence = null;
  if (mergeReady.risk === 'HIGH_RISK') {
    emergencyEvidence = checkHighRiskAccepts(
      pull,
      sortedComments,
      reasons,
      files,
      policy,
    );
  } else if (candidate) {
    checkGeneralDowngrade(pull, sortedComments, reasons);
  }

  return verdict(
    reasons.length === 0 ? 'success' : 'failure',
    mergeReady.risk,
    reasons,
    notes,
    mergeReady.commentId,
    emergencyEvidence,
  );
}

function verdict(
  conclusion,
  risk,
  reasons,
  notes,
  mergeReadyCommentId,
  emergencyEvidence = null,
) {
  return {
    conclusion,
    risk,
    reasons,
    notes,
    mergeReadyCommentId,
    emergencyEvidence,
  };
}

export function formatSummary(result, pull) {
  const lines = [
    `- head: \`${pull.headSha}\``,
    `- base: \`${pull.baseRef}\` @ \`${pull.baseSha}\``,
    `- risk: ${result.risk}`,
  ];
  if (result.mergeReadyCommentId) {
    lines.push(`- MERGE_READY comment id: ${result.mergeReadyCommentId}`);
    if (result.emergencyEvidence) {
      lines.push(
        `- emergency policy PR: #${result.emergencyEvidence.policyPrNumber} @ \`${result.emergencyEvidence.policyMergeCommitSha}\``,
        `- emergency policy merged at: ${result.emergencyEvidence.policyMergedAt}`,
        `- PM_EMERGENCY_ACCEPT comment id: ${result.emergencyEvidence.emergencyCommentId}`,
        `- OWNER_CONFIRM comment id: ${result.emergencyEvidence.ownerCommentId}`,
        `- emergency window: ${result.emergencyEvidence.windowLabel}`,
        `- emergency timestamps: ${result.emergencyEvidence.timestampsValid ? 'PASS' : 'FAIL'}`,
        `- emergency files completeness: ${result.emergencyEvidence.filesComplete ? 'PASS' : 'FAIL'}`,
        `- emergency denylist: ${result.emergencyEvidence.denylistClear ? 'PASS' : 'FAIL'}`,
        `- retained gates: MERGE_READY=${result.emergencyEvidence.retainedGates?.mergeReady ? 'PASS' : 'FAIL'}, PM_ACCEPT=${result.emergencyEvidence.retainedGates?.pmAccept ? 'PASS' : 'FAIL'}`,
      );
    }
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
  for (const note of result.notes ?? []) {
    lines.push(`- 참고: ${note}`);
  }
  return `${lines.join('\n')}\n`;
}

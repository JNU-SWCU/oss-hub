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

// 배포 계약 경로 — 결정 원본은 ADR-005. CODEOWNERS에서 파생하지 않는다(두 사람을
// 함께 나열하는 CODEOWNERS는 PM 전속을 표현할 수 없다). 이 경로를 건드리는 PR은
// high risk PM_ACCEPT·GENERAL 하향 RISK_ACCEPT 모두 role=PM이 필수이며 Tech Lead
// accept로 대체할 수 없다.
export const DEPLOY_CONTRACT_PATTERNS = [
  'Jenkinsfile',
  'compose.yml',
  '.env.example',
  'deploy/**',
  'apps/*/Dockerfile',
  '.dockerignore',
  '.github/workflows/deploy.yml',
  'scripts/check-jenkinsfile.sh',
  'scripts/check-jenkinsfile.test.sh',
  'scripts/jenkins/**',
];

function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesDeployContractPattern(pattern, filePath) {
  return globToRegExp(pattern).test(filePath);
}

// 실패 사유에 남길 근거 — 어떤 패턴이 매칭됐는지 조용히 넘기지 않는다.
export function matchedDeployContractPatterns(changedFiles) {
  const matched = new Set();
  for (const filePath of changedFiles) {
    for (const pattern of DEPLOY_CONTRACT_PATTERNS) {
      if (matchesDeployContractPattern(pattern, filePath)) {
        matched.add(pattern);
      }
    }
  }
  return [...matched];
}

export function touchesDeployContract(changedFiles) {
  return matchedDeployContractPatterns(changedFiles).length > 0;
}

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

// 단일 accept 병합 게이트(ADR-005) — 배포 계약 경로가 아니면 PM_ACCEPT 또는
// TECH_LEAD_ACCEPT 중 하나로 충분하고, 배포 계약 경로면 PM_ACCEPT가 반드시 있어야
// 하며 TECH_LEAD_ACCEPT로 대체할 수 없다.
function checkHighRiskAccepts(pull, comments, reasons, changedFiles) {
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
  const deployPatterns = matchedDeployContractPatterns(changedFiles);
  if (deployPatterns.length > 0) {
    if (!pmAccept) {
      reasons.push(
        `HIGH_RISK — 배포 계약 경로 변경(매칭 패턴: ${deployPatterns.join(', ')}) — ` +
          `현재 head·base에 고정된 @${PM_ACTOR}의 PM_ACCEPT가 반드시 필요하며 TECH_LEAD_ACCEPT로 대체할 수 없음`,
      );
    }
    return;
  }
  if (!pmAccept && !techLeadAccept) {
    reasons.push(
      `HIGH_RISK — 현재 head·base에 고정된 @${PM_ACTOR}의 PM_ACCEPT 또는 @${TECH_LEAD_ACTOR}의 ` +
        'TECH_LEAD_ACCEPT 중 최소 하나가 필요함',
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

// 단일 RISK_ACCEPT로 GENERAL 하향이 충분하되, 배포 계약 경로면 role=PM이어야 한다.
function checkGeneralDowngrade(pull, comments, reasons, changedFiles) {
  const pmRiskAccept = findRiskAccept(pull, comments, 'PM', PM_ACTOR);
  const deployPatterns = matchedDeployContractPatterns(changedFiles);
  if (deployPatterns.length > 0) {
    if (!pmRiskAccept) {
      reasons.push(
        `CODEOWNERS 후보 경로 변경 + 배포 계약 경로 변경(매칭 패턴: ${deployPatterns.join(', ')}) — ` +
          `GENERAL 하향에는 현재 head·base에 고정된 @${PM_ACTOR}의 RISK_ACCEPT role=PM이 필요함`,
      );
    }
    return;
  }
  const techLeadRiskAccept = findRiskAccept(
    pull,
    comments,
    'TECH_LEAD',
    TECH_LEAD_ACTOR,
  );
  if (!pmRiskAccept && !techLeadRiskAccept) {
    reasons.push(
      'CODEOWNERS 후보 경로 변경 — GENERAL 하향에는 현재 head·base에 고정된 ' +
        `@${PM_ACTOR} (role=PM) 또는 @${TECH_LEAD_ACTOR} (role=TECH_LEAD)의 RISK_ACCEPT 중 최소 하나가 필요함`,
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

  const candidate = isCodeownersCandidate(
    parseCodeownersPatterns(codeownersText),
    changedFiles,
  );
  if (mergeReady.risk === 'HIGH_RISK') {
    checkHighRiskAccepts(pull, sortedComments, reasons, changedFiles);
  } else if (candidate) {
    checkGeneralDowngrade(pull, sortedComments, reasons, changedFiles);
  }

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
  for (const note of result.notes ?? []) {
    lines.push(`- 참고: ${note}`);
  }
  return `${lines.join('\n')}\n`;
}

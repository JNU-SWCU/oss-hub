const STALE_AFTER_MS = 48 * 60 * 60 * 1_000;
const FEATURE_STATES = new Set([
  'planned',
  'active',
  'blocked',
  'review',
  'done',
]);

function tableCells(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function issueNumber(value) {
  const match = value.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function metadataValue(text, key) {
  const line = text
    .split('\n')
    .find((candidate) => tableCells(candidate)[0] === key);
  return line ? tableCells(line)[1] ?? null : null;
}

function parseFeatureRows(text) {
  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => {
    const cells = tableCells(line);
    return (
      cells[0] === '기능' &&
      cells[2] === '상태' &&
      cells[3] === 'parent Issue' &&
      cells[4] === 'PR'
    );
  });
  if (headerIndex < 0) {
    return { headerFound: false, malformedRows: [], rows: [] };
  }

  const rows = [];
  const malformedRows = [];
  for (const [offset, line] of lines.slice(headerIndex + 2).entries()) {
    if (!line.trim().startsWith('|')) {
      break;
    }
    const cells = tableCells(line);
    const lineNumber = headerIndex + offset + 3;
    if (cells.length !== 7) {
      malformedRows.push({
        lineNumber,
        reason: `열 개수가 7개가 아닙니다 (${cells.length}개).`,
      });
      continue;
    }

    const issue = issueNumber(cells[3]);
    const pull = issueNumber(cells[4]);
    const reasons = [];
    if (!cells[0]) {
      reasons.push('기능 이름이 비어 있습니다.');
    }
    if (!FEATURE_STATES.has(cells[2])) {
      reasons.push(`지원하지 않는 상태입니다 (${cells[2] || '비어 있음'}).`);
    }
    if (issue === null && cells[3] !== '-') {
      reasons.push(`parent Issue 참조를 읽지 못했습니다 (${cells[3] || '비어 있음'}).`);
    }
    if (pull === null && cells[4] !== '-') {
      reasons.push(`PR 참조를 읽지 못했습니다 (${cells[4] || '비어 있음'}).`);
    }
    if (reasons.length > 0) {
      malformedRows.push({ lineNumber, reason: reasons.join(' ') });
      continue;
    }

    rows.push({
      feature: cells[0],
      state: cells[2],
      issue,
      pull,
      blocker: cells[6],
    });
  }
  return { headerFound: true, malformedRows, rows };
}

function parseActivePlan(text) {
  const issue = text.match(/Issue:\s*#(\d+)/);
  const branch = text.match(/브랜치:\s*`([^`]+)`/);
  const state = text.match(/^- 상태:\s*(.+)$/m);
  return {
    issue: issue ? Number(issue[1]) : null,
    issueReferenceMalformed: /Issue\s*:/.test(text) && !issue,
    branch: branch?.[1] ?? null,
    branchReferenceMalformed: /브랜치\s*:/.test(text) && !branch,
    state: state?.[1]?.trim() ?? '미기록',
    incompleteSteps: [...text.matchAll(/^\d+\. \[ \]/gm)].length,
  };
}

function finding(status, code, source, subject, evidence, action) {
  return { status, code, source, subject, evidence, action };
}

function terminalPullState(pull) {
  if (pull.mergedAt) {
    return 'merged';
  }
  return pull.state === 'closed' ? 'closed' : 'open';
}

export async function checkTeamStateDrift({
  teamStatePath,
  teamStateText,
  activePlans,
  github,
  now,
  inspectSourceCommit,
}) {
  const findings = [];
  const issueCache = new Map();
  const pullCache = new Map();
  const branchCache = new Map();
  const cached = (cache, key, load) => {
    if (!cache.has(key)) {
      cache.set(key, load());
    }
    return cache.get(key);
  };
  const getIssue = (number) =>
    cached(issueCache, number, () => github.getIssue(number));
  const getPull = (number) =>
    cached(pullCache, number, () => github.getPull(number));
  const findPullsByHead = (branch) =>
    cached(branchCache, branch, () => github.findPullsByHead(branch));

  const generatedAt = metadataValue(teamStateText, 'generated_at');
  const generatedDate = generatedAt ? new Date(generatedAt) : null;
  if (!generatedDate || Number.isNaN(generatedDate.getTime())) {
    findings.push(
      finding(
        'unknown',
        'GENERATED_AT_UNKNOWN',
        teamStatePath,
        'generated_at',
        '문서에서 유효한 시각을 읽지 못했습니다.',
        '`generated_at`을 ISO 8601 형식으로 확인해 주세요.',
      ),
    );
  } else if (now.getTime() - generatedDate.getTime() > STALE_AFTER_MS) {
    findings.push(
      finding(
        'stale',
        'GENERATED_AT_STALE',
        teamStatePath,
        'generated_at',
        `스냅샷이 48시간 기준을 넘겼습니다 (${generatedAt}).`,
        'GitHub 상태를 재조회한 뒤 TEAM-STATE를 수동 갱신해 주세요.',
      ),
    );
  }

  const sourceCommitValue = metadataValue(teamStateText, 'source_commit');
  const sourceCommit = sourceCommitValue?.match(/[0-9a-f]{7,40}/i)?.[0] ?? null;
  if (!sourceCommit) {
    findings.push(
      finding(
        'unknown',
        'SOURCE_COMMIT_UNKNOWN',
        teamStatePath,
        'source_commit',
        '문서에서 기준 commit을 읽지 못했습니다.',
        '`source_commit`을 Git commit SHA로 확인해 주세요.',
      ),
    );
  } else {
    try {
      const freshness = await inspectSourceCommit(sourceCommit, teamStatePath);
      if (freshness.status === 'stale') {
        findings.push(
          finding(
            'stale',
            'SOURCE_COMMIT_STALE',
            teamStatePath,
            sourceCommit,
            `현재 main보다 ${freshness.commitsBehind}개 commit 뒤이며 TEAM-STATE 외 변경이 있습니다.`,
            '최신 main을 기준으로 스냅샷을 재생성해 주세요.',
          ),
        );
      } else if (freshness.status === 'unknown') {
        findings.push(
          finding(
            'unknown',
            'SOURCE_COMMIT_UNKNOWN',
            teamStatePath,
            sourceCommit,
            '기준 commit과 main의 ancestry를 확인하지 못했습니다.',
            '원격 main 이력을 fetch한 뒤 다시 실행해 주세요.',
          ),
        );
      }
    } catch {
      findings.push(
        finding(
          'unknown',
          'SOURCE_COMMIT_UNKNOWN',
          teamStatePath,
          sourceCommit,
          '기준 commit freshness 검사가 실패했습니다.',
          '원격 main 이력과 Git 실행 환경을 확인해 주세요.',
        ),
      );
    }
  }

  const parsedTeamState = parseFeatureRows(teamStateText);
  if (!parsedTeamState.headerFound) {
    findings.push(
      finding(
        'unknown',
        'TEAM_STATE_TABLE_UNKNOWN',
        teamStatePath,
        '기능 상태 표',
        '지원하는 표 header를 찾지 못했습니다.',
        'TEAM-STATE 기능 상태 표 형식을 확인해 주세요.',
      ),
    );
  }
  for (const malformedRow of parsedTeamState.malformedRows) {
    findings.push(
      finding(
        'unknown',
        'TEAM_STATE_ROW_UNKNOWN',
        teamStatePath,
        `기능 상태 표 line ${malformedRow.lineNumber}`,
        malformedRow.reason,
        '해당 행을 지원하는 TEAM-STATE 표 형식으로 확인해 주세요.',
      ),
    );
  }

  for (const row of parsedTeamState.rows) {
    let rowIssue = null;
    let issueLookupSucceeded = false;
    if (row.issue !== null) {
      try {
        rowIssue = await getIssue(row.issue);
        issueLookupSucceeded = true;
        if (rowIssue.state === 'closed' && row.state !== 'done') {
          findings.push(
            finding(
              'stale',
              'TEAM_STATE_ISSUE_CLOSED',
              teamStatePath,
              `Issue #${row.issue}`,
              `GitHub은 closed이지만 문서 상태는 ${row.state}입니다.`,
              `기능 행 “${row.feature}”을 사실에 맞게 수동 재검토해 주세요.`,
            ),
          );
        }
      } catch {
        findings.push(
          finding(
            'unknown',
            'GITHUB_ISSUE_UNKNOWN',
            teamStatePath,
            `Issue #${row.issue}`,
            'GitHub Issue 상태를 조회하지 못했습니다.',
            'GitHub 인증·권한·API 상태를 확인한 뒤 다시 실행해 주세요.',
          ),
        );
      }
    }

    let rowPull = null;
    let pullLookupSucceeded = false;
    if (row.pull !== null) {
      try {
        rowPull = await getPull(row.pull);
        pullLookupSucceeded = true;
        const actual = terminalPullState(rowPull);
        if (actual !== 'open' && row.state !== 'done') {
          findings.push(
            finding(
              'stale',
              'TEAM_STATE_PR_TERMINAL',
              teamStatePath,
              `PR #${row.pull}`,
              `GitHub은 ${actual}이지만 문서 상태는 ${row.state}입니다.`,
              `기능 행 “${row.feature}”을 사실에 맞게 수동 재검토해 주세요.`,
            ),
          );
        }
      } catch {
        findings.push(
          finding(
            'unknown',
            'GITHUB_PR_UNKNOWN',
            teamStatePath,
            `PR #${row.pull}`,
            'GitHub PR 상태를 조회하지 못했습니다.',
            'GitHub 인증·권한·API 상태를 확인한 뒤 다시 실행해 주세요.',
          ),
        );
      }
    }

    if (row.state === 'done') {
      const mismatchEvidence = [];
      if (row.issue === null) {
        mismatchEvidence.push('linked Issue가 없습니다.');
      } else if (issueLookupSucceeded && rowIssue.state !== 'closed') {
        mismatchEvidence.push(`Issue #${row.issue}이 ${rowIssue.state}입니다.`);
      }
      if (row.pull === null) {
        mismatchEvidence.push('linked PR이 없습니다.');
      } else if (pullLookupSucceeded && !rowPull.mergedAt) {
        mismatchEvidence.push(
          `PR #${row.pull}이 ${terminalPullState(rowPull)}이며 merged가 아닙니다.`,
        );
      }
      if (mismatchEvidence.length > 0) {
        findings.push(
          finding(
            'stale',
            'TEAM_STATE_DONE_MISMATCH',
            teamStatePath,
            `기능 “${row.feature}”`,
            mismatchEvidence.join(' '),
            'done 상태는 linked Issue closed와 linked PR merged를 확인한 뒤 수동 갱신해 주세요.',
          ),
        );
      }
    }

    const dependency = row.blocker.match(/#(\d+)\s+merge 후 base 전환/);
    if (dependency && row.pull !== null && rowPull) {
      try {
        const dependencyPull = await getPull(Number(dependency[1]));
        if (dependencyPull.mergedAt && rowPull.base === 'main') {
          findings.push(
            finding(
              'stale',
              'TEAM_STATE_BLOCKER_RESOLVED',
              teamStatePath,
              `PR #${row.pull}`,
              `PR #${dependency[1]}이 merged이고 현재 base가 main이어서 blocker가 이미 해소됐습니다.`,
              `기능 행 “${row.feature}”의 blocker를 수동 갱신해 주세요.`,
            ),
          );
        }
      } catch {
        findings.push(
          finding(
            'unknown',
            'GITHUB_BLOCKER_UNKNOWN',
            teamStatePath,
            `PR #${row.pull}`,
            `의존 PR #${dependency[1]} 상태를 조회하지 못했습니다.`,
            'GitHub 조회 환경을 확인한 뒤 blocker를 수동 재검토해 주세요.',
          ),
        );
      }
    }
  }

  for (const plan of activePlans) {
    const parsed = parseActivePlan(plan.text);
    if (parsed.issueReferenceMalformed) {
      findings.push(
        finding(
          'unknown',
          'EXEC_PLAN_ISSUE_REFERENCE_UNKNOWN',
          plan.path,
          'Issue reference',
          'Issue marker는 있지만 유효한 `#<number>` 참조를 읽지 못했습니다.',
          'active exec-plan의 Issue 참조 형식을 확인해 주세요.',
        ),
      );
    }
    if (parsed.branchReferenceMalformed) {
      findings.push(
        finding(
          'unknown',
          'EXEC_PLAN_BRANCH_REFERENCE_UNKNOWN',
          plan.path,
          'branch reference',
          '브랜치 marker는 있지만 backtick으로 감싼 branch 이름을 읽지 못했습니다.',
          'active exec-plan의 브랜치 참조 형식을 확인해 주세요.',
        ),
      );
    }
    if (parsed.issue !== null) {
      try {
        const issue = await getIssue(parsed.issue);
        if (issue.state === 'closed') {
          findings.push(
            finding(
              'stale',
              'EXEC_PLAN_ISSUE_CLOSED',
              plan.path,
              `Issue #${parsed.issue}`,
              `active exec-plan의 parent Issue가 closed이며 문서 상태는 ${parsed.state}입니다.`,
              'exec-plan의 상태와 미완료 항목을 수동 재검토해 주세요.',
            ),
          );
        }
      } catch {
        findings.push(
          finding(
            'unknown',
            'GITHUB_ISSUE_UNKNOWN',
            plan.path,
            `Issue #${parsed.issue}`,
            'active exec-plan의 parent Issue를 조회하지 못했습니다.',
            'GitHub 조회 환경을 확인한 뒤 다시 실행해 주세요.',
          ),
        );
      }
    }
    if (parsed.branch) {
      try {
        const pulls = await findPullsByHead(parsed.branch);
        const latestPull = pulls[0];
        if (latestPull?.mergedAt && latestPull.base === 'main') {
          findings.push(
            finding(
              'stale',
              'EXEC_PLAN_PR_MERGED',
              plan.path,
              `PR #${latestPull.number}`,
              `관련 branch의 구현 PR이 main에 merged됐지만 active exec-plan에 미완료 ${parsed.incompleteSteps}건이 남아 있습니다.`,
              'exec-plan의 완료 증거와 checklist를 수동 재검토해 주세요.',
            ),
          );
        }
      } catch {
        findings.push(
          finding(
            'unknown',
            'GITHUB_BRANCH_PRS_UNKNOWN',
            plan.path,
            parsed.branch,
            '관련 branch의 PR 상태를 조회하지 못했습니다.',
            'GitHub 조회 환경을 확인한 뒤 다시 실행해 주세요.',
          ),
        );
      }
    }
  }

  return { findings };
}

export function exitCodeFor(result) {
  if (result.findings.some(({ status }) => status === 'unknown')) {
    return 2;
  }
  return result.findings.some(({ status }) => status === 'stale') ? 1 : 0;
}

export function formatReport(result) {
  const lines = ['# TEAM-STATE drift report', ''];
  if (result.findings.length === 0) {
    lines.push('[clean] 검사한 문서와 GitHub 사실 사이의 drift가 없습니다.');
  }
  for (const item of result.findings) {
    lines.push(
      `[${item.status}] ${item.code} — ${item.subject}`,
      `  source: ${item.source}`,
      `  evidence: ${item.evidence}`,
      `  action: ${item.action}`,
    );
  }
  const stale = result.findings.filter(({ status }) => status === 'stale').length;
  const unknown = result.findings.filter(({ status }) => status === 'unknown').length;
  lines.push(
    '',
    `summary: stale=${stale}, unknown=${unknown}`,
    '이 검사는 owner·우선순위·정책·문서 변경과 exec-plan archive를 자동 수행하지 않음.',
  );
  return `${lines.join('\n')}\n`;
}

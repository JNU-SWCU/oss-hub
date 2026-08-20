const FEATURE_STATES = new Set([
  'planned',
  'active',
  'blocked',
  'review',
  'done',
]);
const THIS_PR_REF = '(이 PR)';

function issueNumber(value) {
  const match = value.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function isMarkdownHeading(line) {
  return /^#{1,6} /.test(line);
}

function parseJournalHeading(line) {
  const match = line.match(/^## (\d{4}-\d{2}-\d{2}) —\s*(.*)$/);
  if (!match) {
    return null;
  }
  return { date: match[1], title: match[2].trim() };
}

function fieldValue(lines, label) {
  const prefix = `- ${label}:`;
  let value = null;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      value = line.slice(prefix.length).trim();
    }
  }
  return value;
}

function parseHashRef(value) {
  if (value === '-') {
    return { number: null, malformed: false };
  }
  const number = issueNumber(value);
  if (number === null) {
    return { number: null, malformed: true };
  }
  return { number, malformed: false };
}

function parseIssueRef(value) {
  const parsed = parseHashRef(value);
  return { issue: parsed.number, malformed: parsed.malformed };
}

function parsePullRef(value) {
  if (value === THIS_PR_REF) {
    return { pull: null, malformed: false };
  }
  const parsed = parseHashRef(value);
  return { pull: parsed.number, malformed: parsed.malformed };
}

function nextHeadingIndex(lines, afterIndex) {
  for (let index = afterIndex + 1; index < lines.length; index += 1) {
    if (isMarkdownHeading(lines[index])) {
      return index;
    }
  }
  return lines.length;
}

function journalEntryReasons(heading, fields) {
  const reasons = [];
  if (!heading.title) {
    reasons.push('제목이 비어 있습니다.');
  }
  if (fields.state === null) {
    reasons.push('상태가 없습니다.');
  } else if (!FEATURE_STATES.has(fields.state)) {
    reasons.push(`지원하지 않는 상태입니다 (${fields.state || '비어 있음'}).`);
  }
  if (fields.issueRaw === null) {
    reasons.push('Issue 필드가 없습니다.');
  }
  if (fields.pullRaw === null) {
    reasons.push('PR 필드가 없습니다.');
  }
  if (fields.blocker === null) {
    reasons.push('blocker 필드가 없습니다.');
  }
  if (fields.issueRef.malformed) {
    reasons.push(
      `Issue 참조를 읽지 못했습니다 (${fields.issueRaw || '비어 있음'}).`,
    );
  }
  if (fields.pullRef.malformed) {
    reasons.push(
      `PR 참조를 읽지 못했습니다 (${fields.pullRaw || '비어 있음'}).`,
    );
  }
  return reasons;
}

function parseJournalEntries(journalPath, text) {
  const lines = String(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));

  const entries = [];
  const malformedRows = [];

  for (let start = 0; start < lines.length; start += 1) {
    const heading = parseJournalHeading(lines[start]);
    if (heading === null) {
      continue;
    }

    const lineNumber = start + 1;
    const bodyLines = lines.slice(start + 1, nextHeadingIndex(lines, start));
    const issueRaw = fieldValue(bodyLines, 'Issue');
    const pullRaw = fieldValue(bodyLines, 'PR');
    let issueRef = { issue: null, malformed: false };
    if (issueRaw !== null) {
      issueRef = parseIssueRef(issueRaw);
    }
    let pullRef = { pull: null, malformed: false };
    if (pullRaw !== null) {
      pullRef = parsePullRef(pullRaw);
    }
    const fields = {
      state: fieldValue(bodyLines, '상태'),
      issueRaw,
      pullRaw,
      blocker: fieldValue(bodyLines, 'blocker'),
      issueRef,
      pullRef,
    };
    const reasons = journalEntryReasons(heading, fields);

    if (reasons.length > 0) {
      malformedRows.push({
        path: journalPath,
        lineNumber,
        reason: reasons.join(' '),
      });
      continue;
    }

    entries.push({
      path: journalPath,
      lineNumber,
      date: heading.date,
      title: heading.title,
      state: fields.state,
      issue: issueRef.issue,
      pull: pullRef.pull,
      blocker: fields.blocker,
    });
  }

  return { entries, malformedRows };
}

function entryKey(entry) {
  if (entry.issue !== null) {
    return `issue:${entry.issue}`;
  }
  if (entry.pull !== null) {
    return `pr:${entry.pull}`;
  }
  return `title:${entry.title}`;
}

function compareEntries(left, right) {
  if (left.date !== right.date) {
    return left.date < right.date ? -1 : 1;
  }
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  if (left.lineNumber !== right.lineNumber) {
    return left.lineNumber < right.lineNumber ? -1 : 1;
  }
  return 0;
}

function latestEntries(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = entryKey(entry);
    const current = byKey.get(key);
    if (current === undefined || compareEntries(current, entry) < 0) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
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
  if (pull.state === 'closed') {
    return 'closed';
  }
  return 'open';
}

function cachedLoad(cache, key, load) {
  if (!cache.has(key)) {
    cache.set(key, load());
  }
  return cache.get(key);
}

function journalUpdateFinding(row, code, subject, evidence) {
  return finding(
    'stale',
    code,
    row.path,
    subject,
    evidence,
    `저널 항목 “${row.title}”에 새 항목을 붙여 주세요.`,
  );
}

async function findingsForLatestEntry(row, getIssue, getPull) {
  const findings = [];
  let rowIssue = null;
  let issueLookupSucceeded = false;

  if (row.issue !== null) {
    try {
      rowIssue = await getIssue(row.issue);
      issueLookupSucceeded = true;
      if (rowIssue.state === 'closed' && row.state !== 'done') {
        findings.push(
          journalUpdateFinding(
            row,
            'TEAM_STATE_ISSUE_CLOSED',
            `Issue #${row.issue}`,
            `GitHub은 closed이지만 문서 상태는 ${row.state}입니다.`,
          ),
        );
      }
    } catch {
      findings.push(
        finding(
          'unknown',
          'GITHUB_ISSUE_UNKNOWN',
          row.path,
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
          journalUpdateFinding(
            row,
            'TEAM_STATE_PR_TERMINAL',
            `PR #${row.pull}`,
            `GitHub은 ${actual}이지만 문서 상태는 ${row.state}입니다.`,
          ),
        );
      }
    } catch {
      findings.push(
        finding(
          'unknown',
          'GITHUB_PR_UNKNOWN',
          row.path,
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
          row.path,
          `저널 항목 “${row.title}”`,
          mismatchEvidence.join(' '),
          'done이면 Issue closed와 PR merged를 확인한 뒤 새 항목을 붙이세요.',
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
            row.path,
            `PR #${row.pull}`,
            `PR #${dependency[1]}이 merged이고 현재 base가 main이어서 blocker가 이미 해소됐습니다.`,
            `저널 항목 “${row.title}”의 blocker가 해소됐으면 새 항목을 붙이세요.`,
          ),
        );
      }
    } catch {
      findings.push(
        finding(
          'unknown',
          'GITHUB_BLOCKER_UNKNOWN',
          row.path,
          `PR #${row.pull}`,
          `의존 PR #${dependency[1]} 상태를 조회하지 못했습니다.`,
          'GitHub 조회 환경을 확인한 뒤 blocker를 수동 재검토해 주세요.',
        ),
      );
    }
  }

  return findings;
}

async function findingsForActivePlan(plan, getIssue, findPullsByHead) {
  const findings = [];
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

  return findings;
}

export async function checkTeamStateDrift({ journals, activePlans, github }) {
  const findings = [];
  const issueCache = new Map();
  const pullCache = new Map();
  const branchCache = new Map();
  const getIssue = (number) =>
    cachedLoad(issueCache, number, () => github.getIssue(number));
  const getPull = (number) =>
    cachedLoad(pullCache, number, () => github.getPull(number));
  const findPullsByHead = (branch) =>
    cachedLoad(branchCache, branch, () => github.findPullsByHead(branch));

  if (journals.length === 0) {
    findings.push(
      finding(
        'unknown',
        'TEAM_STATE_JOURNAL_UNKNOWN',
        'docs/handoff/team-state/',
        '작성자 저널',
        '검사할 저널 파일이 없습니다.',
        'docs/handoff/team-state/ 아래 작성자 저널을 확인해 주세요.',
      ),
    );
  }

  const parsedEntries = [];
  for (const journal of journals) {
    const parsed = parseJournalEntries(journal.path, journal.text);
    for (const malformedRow of parsed.malformedRows) {
      findings.push(
        finding(
          'unknown',
          'TEAM_STATE_ROW_UNKNOWN',
          journal.path,
          `저널 항목 line ${malformedRow.lineNumber}`,
          malformedRow.reason,
          '해당 항목을 지원하는 저널 형식으로 확인해 주세요.',
        ),
      );
    }
    parsedEntries.push(...parsed.entries);
  }

  for (const row of latestEntries(parsedEntries)) {
    findings.push(...(await findingsForLatestEntry(row, getIssue, getPull)));
  }
  for (const plan of activePlans) {
    findings.push(
      ...(await findingsForActivePlan(plan, getIssue, findPullsByHead)),
    );
  }

  return { findings };
}

export function exitCodeFor(result) {
  if (result.findings.some(({ status }) => status === 'unknown')) {
    return 2;
  }
  if (result.findings.some(({ status }) => status === 'stale')) {
    return 1;
  }
  return 0;
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
  const stale = result.findings.filter(
    ({ status }) => status === 'stale',
  ).length;
  const unknown = result.findings.filter(
    ({ status }) => status === 'unknown',
  ).length;
  lines.push(
    '',
    `summary: stale=${stale}, unknown=${unknown}`,
    '이 검사는 owner·우선순위·정책·문서 변경과 exec-plan archive를 자동 수행하지 않음.',
  );
  return `${lines.join('\n')}\n`;
}

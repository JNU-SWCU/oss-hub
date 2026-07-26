// merge-policy 판정 entry — GitHub metadata를 조회해 판정하고 check run으로 발행한다.
// PR head 코드는 checkout·실행하지 않는다. CODEOWNERS는 신뢰된 default-branch 체크아웃에서 읽는다.
// 사용법:
//   node scripts/merge-policy-check.mjs --pr 123             # 판정 + check run 발행 (CI)
//   node scripts/merge-policy-check.mjs --pr 123 --simulate  # 판정만 출력 (dry-run, 로컬)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  collectChangedPaths,
  EMERGENCY_POLICY_PR_NUMBER,
  EMERGENCY_PR_NUMBER,
  evaluateMergePolicy,
  formatSummary,
  hasCompletePullFiles,
} from './merge-policy-check-lib.mjs';

const CODEOWNERS_PATH = '.github/CODEOWNERS';
const COMMAND_TIMEOUT_MS = 30_000;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
  }).trim();
}

function api(endpoint, paginate = false) {
  const args = ['api', endpoint];
  if (paginate) {
    args.push('--paginate', '--slurp');
  }
  const raw = run('gh', args);
  const parsed = JSON.parse(raw);
  if (paginate) {
    if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) {
      throw new Error('GitHub pagination response was malformed');
    }
    return parsed.flat();
  }
  return parsed;
}

function repositoryName() {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  const remote = run('git', ['remote', 'get-url', 'origin']);
  const match = remote.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error('GitHub repository could not be resolved');
  }
  return match[1];
}

function parseArguments(argv) {
  const options = { pr: process.env.PR_NUMBER, simulate: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--pr') {
      options.pr = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--simulate') {
      options.simulate = true;
    }
  }
  if (!options.pr || !/^\d+$/.test(String(options.pr))) {
    throw new Error(
      'PR 번호가 필요합니다 — --pr <number> 또는 PR_NUMBER 환경변수',
    );
  }
  return options;
}

export function fetchInputs(repository, prNumber) {
  const response = api(`repos/${repository}/pulls/${prNumber}`);
  const baseRef = response?.base?.ref;
  const baseSha = api(`repos/${repository}/git/ref/heads/${baseRef}`)?.object
    ?.sha;
  if (
    !Number.isInteger(response?.number) ||
    !Number.isInteger(response?.changed_files) ||
    typeof response?.head?.sha !== 'string' ||
    typeof baseRef !== 'string' ||
    typeof baseSha !== 'string'
  ) {
    throw new Error('GitHub pull metadata was malformed');
  }
  const pull = {
    number: response.number,
    headSha: response.head.sha,
    baseRef,
    baseSha,
    changedFiles: response.changed_files,
  };
  const comments = api(
    `repos/${repository}/issues/${prNumber}/comments`,
    true,
  ).map((comment) => {
    if (
      !Number.isInteger(comment?.id) ||
      typeof comment?.user?.login !== 'string' ||
      typeof comment?.body !== 'string' ||
      typeof comment?.created_at !== 'string' ||
      typeof comment?.updated_at !== 'string'
    ) {
      throw new Error('GitHub comment metadata was malformed');
    }
    return {
      id: comment.id,
      authorLogin: comment.user.login,
      body: comment.body,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    };
  });
  const files = api(`repos/${repository}/pulls/${prNumber}/files`, true);
  if (!hasCompletePullFiles(files, pull.changedFiles)) {
    throw new Error('GitHub pull files metadata was incomplete or malformed');
  }
  const changedFiles = collectChangedPaths(files);
  let policy = null;
  if (pull.number === EMERGENCY_PR_NUMBER && EMERGENCY_POLICY_PR_NUMBER !== 0) {
    const policyPull = api(
      `repos/${repository}/pulls/${EMERGENCY_POLICY_PR_NUMBER}`,
    );
    if (
      policyPull?.number !== EMERGENCY_POLICY_PR_NUMBER ||
      typeof policyPull?.merged_at !== 'string' ||
      typeof policyPull?.merge_commit_sha !== 'string'
    ) {
      throw new Error('Emergency policy pull metadata was malformed');
    }
    const comparison = api(
      `repos/${repository}/compare/${policyPull.merge_commit_sha}...${baseSha}`,
    );
    if (typeof comparison?.status !== 'string') {
      throw new Error('Emergency policy ancestry response was malformed');
    }
    policy = {
      prNumber: policyPull.number,
      mergedAt: policyPull.merged_at,
      mergeCommitSha: policyPull.merge_commit_sha,
      mergeCommitIsAncestorOfBase: ['ahead', 'identical'].includes(
        comparison.status,
      ),
    };
  }
  return { pull, comments, files, changedFiles, policy };
}

function publishCheckRun(repository, pull, result) {
  const summary = formatSummary(result, pull);
  run('gh', [
    'api',
    `repos/${repository}/check-runs`,
    '--method',
    'POST',
    '-f',
    'name=merge-policy',
    '-f',
    `head_sha=${pull.headSha}`,
    '-f',
    'status=completed',
    '-f',
    `conclusion=${result.conclusion}`,
    '-f',
    `external_id=${process.env.GITHUB_RUN_ID ?? 'local'}`,
    '-f',
    `output[title]=merge-policy: ${result.conclusion === 'success' ? 'PASS' : 'FAIL'} (${result.risk})`,
    '-f',
    `output[summary]=${summary}`,
  ]);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const repository = repositoryName();
  const { pull, comments, files, changedFiles, policy } = fetchInputs(
    repository,
    options.pr,
  );
  const codeownersText = readFileSync(CODEOWNERS_PATH, 'utf8');

  const result = evaluateMergePolicy({
    pull,
    comments,
    changedFiles,
    files,
    policy,
    codeownersText,
  });
  const summary = formatSummary(result, pull);
  process.stdout.write(
    `merge-policy #${pull.number}: ${result.conclusion}\n${summary}`,
  );

  if (options.simulate) {
    process.exitCode = result.conclusion === 'success' ? 0 : 1;
    return;
  }
  publishCheckRun(repository, pull, result);
}

try {
  main();
} catch (error) {
  // 판정 불능은 fail-closed다 — check run을 발행하지 못하면 required check가 pending으로 남는다.
  process.stderr.write(`merge-policy 판정 실패: ${error.message}\n`);
  process.exitCode = 2;
}

// merge-policy 판정 entry — GitHub metadata를 조회해 판정하고 check run으로 발행한다.
// PR head 코드는 checkout·실행하지 않는다. CODEOWNERS는 신뢰된 default-branch 체크아웃에서 읽는다.
// 사용법:
//   node scripts/merge-policy-check.mjs --pr 123             # 판정 + check run 발행 (CI)
//   node scripts/merge-policy-check.mjs --pr 123 --simulate  # 판정만 출력 (dry-run, 로컬)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  CHECK_RUN_NAME,
  collectChangedPaths,
  evaluateMergePolicy,
  formatSummary,
  hasCompletePullFiles,
  planCheckRunPublish,
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
    typeof response?.user?.login !== 'string' ||
    typeof baseRef !== 'string' ||
    typeof baseSha !== 'string'
  ) {
    throw new Error('GitHub pull metadata was malformed');
  }
  const pull = {
    number: response.number,
    authorLogin: response.user.login,
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
  return { pull, comments, files, changedFiles };
}

function fetchExistingCheckRuns(repository, headSha) {
  const response = api(
    `repos/${repository}/commits/${headSha}/check-runs?filter=all&per_page=100`,
  );
  const runs = response?.check_runs;
  if (!Array.isArray(runs) || !Number.isInteger(response?.total_count)) {
    throw new Error('GitHub check run 목록이 malformed입니다');
  }
  // 페이지가 잘렸으면 갱신 대상을 놓칠 수 있으므로 판정을 발행하지 않는다.
  if (response.total_count > runs.length) {
    throw new Error(
      `check run이 ${response.total_count}개로 한 페이지를 넘어 갱신 대상을 확정할 수 없습니다`,
    );
  }
  return runs;
}

// 같은 head SHA를 재평가할 때 새 run을 만들지 않고 기존 run을 갱신한다.
// 한 SHA에 서로 다른 결론이 공존하면 required check 판정이 비결정적이 된다.
function publishCheckRun(repository, pull, result) {
  const summary = formatSummary(result, pull);
  const title = `${CHECK_RUN_NAME}: ${result.conclusion === 'success' ? 'PASS' : 'FAIL'} (${result.risk})`;
  const fields = [
    '-f',
    'status=completed',
    '-f',
    `conclusion=${result.conclusion}`,
    '-f',
    `external_id=${process.env.GITHUB_RUN_ID ?? 'local'}`,
    '-f',
    `output[title]=${title}`,
    '-f',
    `output[summary]=${summary}`,
  ];

  const plan = planCheckRunPublish(
    fetchExistingCheckRuns(repository, pull.headSha),
    pull.headSha,
  );

  if (plan.create) {
    run('gh', [
      'api',
      `repos/${repository}/check-runs`,
      '--method',
      'POST',
      '-f',
      `name=${CHECK_RUN_NAME}`,
      '-f',
      `head_sha=${pull.headSha}`,
      ...fields,
    ]);
    return;
  }

  for (const id of plan.updateIds) {
    run('gh', [
      'api',
      `repos/${repository}/check-runs/${id}`,
      '--method',
      'PATCH',
      ...fields,
    ]);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const repository = repositoryName();
  const { pull, comments, changedFiles } = fetchInputs(repository, options.pr);
  const codeownersText = readFileSync(CODEOWNERS_PATH, 'utf8');

  const result = evaluateMergePolicy({
    pull,
    comments,
    changedFiles,
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

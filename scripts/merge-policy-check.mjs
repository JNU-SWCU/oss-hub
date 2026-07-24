// merge-policy 판정 entry — GitHub metadata를 조회해 판정하고 check run으로 발행한다.
// PR head 코드는 checkout·실행하지 않는다. CODEOWNERS는 신뢰된 default-branch 체크아웃에서 읽는다.
// 사용법:
//   node scripts/merge-policy-check.mjs --pr 123             # 판정 + check run 발행 (CI)
//   node scripts/merge-policy-check.mjs --pr 123 --simulate  # 판정만 출력 (dry-run, 로컬)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  evaluateMergePolicy,
  formatSummary,
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
  return paginate ? parsed.flat() : parsed;
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

function fetchInputs(repository, prNumber) {
  const pullResponse = api(`repos/${repository}/pulls/${prNumber}`);
  const baseRef = pullResponse.base.ref;
  // base.sha는 조회 시점 의미가 모호하므로 base ref의 현재 tip을 직접 확인한다.
  const baseTip = api(`repos/${repository}/git/ref/heads/${baseRef}`).object
    .sha;
  const pull = {
    number: pullResponse.number,
    headSha: pullResponse.head.sha,
    baseRef,
    baseSha: baseTip,
  };
  const comments = api(
    `repos/${repository}/issues/${prNumber}/comments`,
    true,
  ).map((comment) => ({
    id: comment.id,
    authorLogin: comment.user.login,
    body: comment.body,
  }));
  const changedFiles = api(
    `repos/${repository}/pulls/${prNumber}/files`,
    true,
  ).map((file) => file.filename);
  return { pull, comments, changedFiles };
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

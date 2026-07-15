import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  checkTeamStateDrift,
  exitCodeFor,
  formatReport,
} from './team-state-check-lib.mjs';

const TEAM_STATE_PATH = 'docs/handoff/TEAM-STATE.md';
const ACTIVE_PLAN_DIRECTORY = 'docs/exec-plan/active';
const COMMAND_TIMEOUT_MS = 30_000;
const REMOTE_MAIN_REF = 'refs/remotes/origin/main';

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
  }).trim();
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

function githubClient(repository) {
  const [owner] = repository.split('/');
  const request = (endpoint) => JSON.parse(run('gh', ['api', endpoint]));
  return {
    async getIssue(number) {
      const issue = request(`repos/${repository}/issues/${number}`);
      return { state: issue.state };
    },
    async getPull(number) {
      const pull = request(`repos/${repository}/pulls/${number}`);
      return {
        number: pull.number,
        state: pull.state,
        mergedAt: pull.merged_at,
        base: pull.base.ref,
      };
    },
    async findPullsByHead(branch) {
      const head = encodeURIComponent(`${owner}:${branch}`);
      const pulls = request(
        `repos/${repository}/pulls?state=all&head=${head}&sort=created&direction=desc&per_page=100`,
      );
      return pulls.map((pull) => ({
        number: pull.number,
        state: pull.state,
        mergedAt: pull.merged_at,
        base: pull.base.ref,
      }));
    },
  };
}

async function inspectSourceCommit(sourceCommit, teamStatePath) {
  try {
    run('git', [
      'fetch',
      '--no-tags',
      'origin',
      `+refs/heads/main:${REMOTE_MAIN_REF}`,
    ]);
    run('git', ['merge-base', '--is-ancestor', sourceCommit, REMOTE_MAIN_REF]);
    const commitsBehind = Number(
      run('git', ['rev-list', '--count', `${sourceCommit}..${REMOTE_MAIN_REF}`]),
    );
    const changedFiles = run('git', [
      'diff',
      '--name-only',
      `${sourceCommit}..${REMOTE_MAIN_REF}`,
    ])
      .split('\n')
      .filter(Boolean);
    const materialChanges = changedFiles.filter(
      (filePath) => filePath !== teamStatePath,
    );
    return {
      status:
        commitsBehind > 0 && materialChanges.length > 0 ? 'stale' : 'clean',
      commitsBehind,
      changedFiles,
    };
  } catch {
    return { status: 'unknown', commitsBehind: 0, changedFiles: [] };
  }
}

function activePlans() {
  return readdirSync(ACTIVE_PLAN_DIRECTORY)
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const filePath = path.join(ACTIVE_PLAN_DIRECTORY, fileName);
      return { path: filePath, text: readFileSync(filePath, 'utf8') };
    });
}

async function main() {
  const teamStateText = readFileSync(TEAM_STATE_PATH, 'utf8');
  const result = await checkTeamStateDrift({
    teamStatePath: TEAM_STATE_PATH,
    teamStateText,
    activePlans: activePlans(),
    github: githubClient(repositoryName()),
    now: new Date(),
    inspectSourceCommit,
  });
  const report = formatReport(result);
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report, 'utf8');
  }
  process.exitCode = exitCodeFor(result);
}

main().catch(() => {
  process.stderr.write(
    '[unknown] TEAM_STATE_CHECK_FAILED — 검사기를 실행하지 못했습니다. GitHub 인증·Git 이력·문서 경로를 확인해 주세요.\n',
  );
  process.exitCode = 2;
});

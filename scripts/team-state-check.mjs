import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  checkTeamStateDrift,
  exitCodeFor,
  formatReport,
} from './team-state-check-lib.mjs';

const JOURNAL_DIRECTORY = 'docs/handoff/team-state';
const ACTIVE_PLAN_DIRECTORY = 'docs/exec-plan/active';
const COMMAND_TIMEOUT_MS = 30_000;

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

function loadMarkdownFiles(directory, sortNames) {
  const fileNames = readdirSync(directory).filter((fileName) =>
    fileName.endsWith('.md'),
  );
  if (sortNames) {
    fileNames.sort();
  }
  return fileNames.map((fileName) => {
    const filePath = path.join(directory, fileName);
    return { path: filePath, text: readFileSync(filePath, 'utf8') };
  });
}

async function main() {
  const result = await checkTeamStateDrift({
    journals: loadMarkdownFiles(JOURNAL_DIRECTORY, true),
    activePlans: loadMarkdownFiles(ACTIVE_PLAN_DIRECTORY, false),
    github: githubClient(repositoryName()),
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

#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectReleaseDeployScope } from './select-release-deploy-scope-lib.mjs';

const SHA = /^[0-9a-f]{40}$/;
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DEPLOY_JOB = 'frontend-release-deploy';
const DEPLOY_STEP = 'Vercel production 배포';

function pageItems(pages, key) {
  if (!Array.isArray(pages) || pages.length === 0)
    throw new Error('Missing API pages');
  return pages.flatMap((page) => {
    if (!Array.isArray(page?.[key])) throw new Error('Invalid API page');
    return page[key];
  });
}

export async function readSuccessfulFrontendDeployments(repository, api) {
  const deployments = [];
  let complete = true;
  let runs;
  try {
    runs = pageItems(
      await api(
        `repos/${repository}/actions/workflows/ci.yml/runs?event=release&per_page=100`,
      ),
      'workflow_runs',
    );
  } catch {
    return { deployments, complete: false };
  }
  for (const run of runs) {
    if (run.event !== 'release') continue;
    try {
      if (
        !Number.isSafeInteger(run.id) ||
        run.id <= 0 ||
        !SHA.test(run.head_sha)
      )
        throw new Error('Invalid run');
      const jobs = pageItems(
        await api(
          `repos/${repository}/actions/runs/${run.id}/jobs?filter=all&per_page=100`,
        ),
        'jobs',
      );
      for (const job of jobs) {
        if (job.name !== DEPLOY_JOB || job.conclusion === 'skipped') continue;
        if (!Array.isArray(job.steps))
          throw new Error('Missing deployment steps');
        for (const step of job.steps) {
          if (step.name !== DEPLOY_STEP || step.conclusion !== 'success')
            continue;
          if (
            job.head_sha !== run.head_sha ||
            typeof step.completed_at !== 'string' ||
            !Number.isFinite(Date.parse(step.completed_at))
          )
            throw new Error('Invalid deployment receipt');
          deployments.push({
            sha: run.head_sha,
            completedAt: step.completed_at,
          });
        }
      }
    } catch {
      complete = false;
    }
  }
  return { deployments, complete };
}

export async function isLatestFullRelease(repository, targetTag, api) {
  try {
    const pages = await api(`repos/${repository}/releases/latest`);
    const release = pages?.[0];
    if (
      !Array.isArray(pages) ||
      pages.length !== 1 ||
      release?.draft !== false ||
      release.prerelease !== false ||
      !RELEASE_TAG.test(release.tag_name)
    )
      return null;
    return release.tag_name === targetTag;
  } catch {
    return null;
  }
}

export function selectFrontendReleaseDeployScope(
  targetSha,
  history,
  git,
  isLatestRelease = null,
) {
  if (!SHA.test(targetSha)) throw new Error('Invalid release SHA');
  let uncertain = false;
  const deployments = [...history.deployments].sort(
    (left, right) =>
      Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );
  const baselineSha = deployments[0]?.sha ?? null;
  const requireDeployment = (reason) => {
    if (isLatestRelease !== true)
      throw new Error(
        '배포 이력을 확인하지 못했고 최신 정식 릴리스임을 증명할 수 없습니다. 최신 릴리스 실행을 재시도하세요.',
      );
    return { frontend: true, baselineSha, reason };
  };
  if (!history.complete)
    return requireDeployment('deployment-history-unavailable');
  if (baselineSha === targetSha)
    return { frontend: false, baselineSha, reason: 'already-deployed' };
  if (baselineSha !== null) {
    try {
      if (git.isAncestor(targetSha, baselineSha))
        return { frontend: false, baselineSha, reason: 'newer-deployment' };
    } catch {
      uncertain = true;
    }
  }

  if (uncertain) return requireDeployment('deployment-history-unavailable');
  if (baselineSha === null)
    return requireDeployment('no-successful-deployment');
  try {
    if (!git.isAncestor(baselineSha, targetSha))
      return requireDeployment('deployment-history-unrelated');
    const { frontend } = selectReleaseDeployScope(
      git.changedPaths(baselineSha, targetSha),
    );
    return {
      frontend,
      baselineSha,
      reason: frontend ? 'frontend-changed' : 'frontend-unchanged',
    };
  } catch {
    return requireDeployment('deployment-comparison-unavailable');
  }
}

function command(file, args) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

async function main(env = process.env) {
  const repository = env.GITHUB_REPOSITORY;
  const targetSha = env.RELEASE_SHA;
  const targetTag = env.RELEASE_TAG;
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !SHA.test(targetSha ?? '') ||
    !RELEASE_TAG.test(targetTag ?? '')
  )
    throw new Error('Invalid release input');
  const api = (endpoint) =>
    JSON.parse(command('gh', ['api', '--paginate', '--slurp', endpoint]));
  const history = await readSuccessfulFrontendDeployments(repository, api);
  const latest = await isLatestFullRelease(repository, targetTag, api);
  const git = {
    isAncestor: (ancestor, descendant) => {
      try {
        command('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
        return true;
      } catch (error) {
        if (error.status === 1) return false;
        throw error;
      }
    },
    changedPaths: (from, to) =>
      command('git', ['diff', '--no-renames', '--name-only', from, to]).split(
        '\n',
      ),
  };
  const result = selectFrontendReleaseDeployScope(
    targetSha,
    history,
    git,
    latest,
  );
  process.stderr.write(
    `RELEASE_SCOPE baseline=${result.baselineSha ?? 'none'} reason=${result.reason} frontend=${result.frontend}\n`,
  );
  process.stdout.write(`frontend=${result.frontend}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

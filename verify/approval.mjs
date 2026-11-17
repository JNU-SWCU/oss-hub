import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_BASELINE_PATH, VerifyError } from './tools.mjs';

const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;

function patternMatches(pattern, path) {
  const anchored = pattern.startsWith('/');
  const body = pattern.replace(/^\//, '');
  const directory = body.endsWith('/');
  const source = body
    .replace(/\/$/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '.*');
  const prefix = anchored ? '^' : '(^|/)';
  const suffix = directory ? '/' : '($|/)';
  return new RegExp(`${prefix}${source}${suffix}`).test(path);
}

export function codeOwnersFor(text, path) {
  let owners = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [pattern, ...rest] = trimmed.split(/\s+/);
    if (patternMatches(pattern, path)) owners = rest;
  }
  return owners;
}

async function github(fetchImpl, token, path) {
  const response = await fetchImpl(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new VerifyError(`GitHub API ${path} returned ${response.status}`);
  }
  return response.json();
}

async function approvedReviewers(fetchImpl, token, repository, number) {
  const latest = new Map();
  for (let page = 1; page <= 10; page += 1) {
    const reviews = await github(
      fetchImpl,
      token,
      `/repos/${repository}/pulls/${number}/reviews?per_page=100&page=${page}`,
    );
    for (const review of reviews) {
      if (review.state === 'COMMENTED' || !review.user?.login) continue;
      latest.set(review.user.login.toLowerCase(), review.state);
    }
    if (reviews.length < 100) break;
  }
  return [...latest]
    .filter(([, state]) => state === 'APPROVED')
    .map(([login]) => login);
}

export function createCiApproval({
  env = process.env,
  cwd,
  fetchImpl = fetch,
}) {
  return async (range) => {
    const token = env.GITHUB_TOKEN;
    const repository = env.GITHUB_REPOSITORY;
    if (!token || !repository || !env.GITHUB_EVENT_PATH) {
      return {
        ok: false,
        detail:
          'GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required to check CODEOWNERS approval',
      };
    }
    const owners = codeOwnersFor(
      readFileSync(join(cwd, '.github/CODEOWNERS'), 'utf8'),
      API_BASELINE_PATH,
    );
    const users = owners
      .filter((owner) => owner.startsWith('@') && !owner.includes('/'))
      .map((owner) => owner.slice(1).toLowerCase());
    if (users.length === 0) {
      return {
        ok: false,
        detail: `no individual CODEOWNERS for ${API_BASELINE_PATH} (owners: ${owners.join(' ') || 'none'})`,
      };
    }
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    let numbers;
    if (env.GITHUB_EVENT_NAME === 'push') {
      const pulls = await github(
        fetchImpl,
        token,
        `/repos/${repository}/commits/${range.head}/pulls`,
      );
      numbers = pulls
        .filter((pull) => pull.merged_at)
        .map((pull) => pull.number);
    } else {
      numbers = [event.pull_request?.number].filter(Boolean);
    }
    if (numbers.length === 0) {
      return {
        ok: false,
        detail: `no merged pull request found for ${range.head.slice(0, 9)}`,
      };
    }
    for (const number of numbers) {
      const approved = await approvedReviewers(
        fetchImpl,
        token,
        repository,
        number,
      );
      const owner = approved.find((login) => users.includes(login));
      if (owner)
        return { ok: true, detail: `#${number} approved by @${owner}` };
    }
    return {
      ok: false,
      detail: `no approval from CODEOWNERS (${owners.join(' ')}) on PR ${numbers.map((number) => `#${number}`).join(', ')}`,
    };
  };
}

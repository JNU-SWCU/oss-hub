import { readFileSync } from 'node:fs';
import { API_BASELINE_PATH, VerifyError, showAtRevision } from './tools.mjs';

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

async function githubResponse(fetchImpl, token, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new VerifyError(
      `GitHub API ${new URL(url).pathname} returned ${response.status}`,
    );
  }
  return response;
}

async function github(fetchImpl, token, path) {
  return (await githubResponse(fetchImpl, token, `${API}${path}`)).json();
}

function nextPage(link) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(link ?? '');
  if (!match) return null;
  if (!match[1].startsWith(`${API}/`)) {
    throw new VerifyError(`unexpected GitHub pagination link ${match[1]}`);
  }
  return match[1];
}

async function allReviews(fetchImpl, token, repository, number) {
  const reviews = [];
  let url = `${API}/repos/${repository}/pulls/${number}/reviews?per_page=100`;
  while (url) {
    const response = await githubResponse(fetchImpl, token, url);
    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new VerifyError(`GitHub reviews page for #${number} is not a list`);
    }
    reviews.push(...page);
    url = nextPage(response.headers.get('link'));
  }
  return reviews;
}

async function approvedReviewers(fetchImpl, token, repository, number) {
  const latest = new Map();
  const reviews = await allReviews(fetchImpl, token, repository, number);
  for (const review of reviews) {
    if (review.state === 'COMMENTED' || !review.user?.login) continue;
    const at = Date.parse(review.submitted_at);
    if (Number.isNaN(at)) {
      throw new VerifyError(
        `review by @${review.user.login} on #${number} has no submitted_at`,
      );
    }
    const login = review.user.login.toLowerCase();
    const previous = latest.get(login);
    if (!previous || at >= previous.at) {
      latest.set(login, { at, state: review.state });
    }
  }
  return [...latest]
    .map(([login, { state }]) => [login, state])
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
    const trusted = await showAtRevision(cwd, range.base, '.github/CODEOWNERS');
    if (trusted === null) {
      return {
        ok: false,
        detail: `no .github/CODEOWNERS at trusted base ${range.base.slice(0, 9)}`,
      };
    }
    const owners = codeOwnersFor(trusted, API_BASELINE_PATH);
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

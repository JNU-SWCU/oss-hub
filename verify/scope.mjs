import { readFileSync } from 'node:fs';
import {
  DEFAULT_BRANCH,
  VerifyError,
  git,
  gitOk,
  isZeroSha,
  run,
} from './tools.mjs';

const SHA = '[0-9a-f]{40}(?:[0-9a-f]{24})?';
const PRE_PUSH_LINE = new RegExp(`^(\\S+) (${SHA}) (\\S+) (${SHA})$`);
const BOTH_PATTERNS = [
  /^verify\//,
  /^\.githooks\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^compose[^/]*\.yml$/,
  /^\.github\/workflows\//,
];

const QUERY_GATE_PATTERNS = [
  /^apps\/backend\/src\/.*(?<!\.spec)\.ts$/,
  /^apps\/backend\/prisma\//,
  /^apps\/backend\/test\//,
  /^apps\/backend\/eslint-rules\//,
];

export function classifyFiles(files) {
  const both = files.some((file) =>
    BOTH_PATTERNS.some((pattern) => pattern.test(file)),
  );
  return {
    frontend: both || files.some((file) => file.startsWith('apps/frontend/')),
    backend: both || files.some((file) => file.startsWith('apps/backend/')),
    queryGates:
      both ||
      files.some((file) =>
        QUERY_GATE_PATTERNS.some((pattern) => pattern.test(file)),
      ),
    both,
    securityAlways: true,
  };
}

async function requireCommit(cwd, sha, hint) {
  if ((await gitOk(cwd, ['cat-file', '-e', `${sha}^{commit}`])) === null) {
    throw new VerifyError(
      `revision ${sha} is not available locally (${hint}); refusing to verify without a trusted base`,
    );
  }
}

async function mergeBaseOrFail(cwd, head, defaultBranch, reason) {
  const base = await gitOk(cwd, ['merge-base', head, defaultBranch]);
  if (!base) {
    throw new VerifyError(
      `${reason}: no merge-base between ${head} and ${defaultBranch}; refusing to verify without a trusted base (run: git fetch origin main)`,
    );
  }
  return base;
}

async function confirmOnRemote(cwd, remote, sha, ref) {
  if (!remote) {
    throw new VerifyError(
      `${ref} resolves to an empty range at ${sha.slice(0, 9)} and no push URL was given to confirm it; refusing to pass without verification`,
    );
  }
  const result = await run('git', ['ls-remote', '--', remote], {
    cwd,
    timeoutMs: 60_000,
  });
  if (result.code !== 0) {
    throw new VerifyError(
      `${ref} resolves to an empty range and git ls-remote ${remote} failed: ${result.stderr.trim()}; refusing to pass without verification`,
    );
  }
  const tips = result.stdout.split('\n').map((line) => line.split('\t')[0]);
  if (!tips.includes(sha)) {
    throw new VerifyError(
      `${ref} resolves to an empty range at ${sha.slice(0, 9)}, but ${remote} has no ref at that commit; refusing to pass without verification (run: git fetch ${remote})`,
    );
  }
}

async function prePushRanges(cwd, stdin, defaultBranch, remote) {
  const ranges = [];
  const lines = stdin.split('\n').filter((line) => line.trim() !== '');
  for (const [index, line] of lines.entries()) {
    const match = PRE_PUSH_LINE.exec(line.trim());
    if (!match) {
      throw new VerifyError(
        `malformed pre-push input line ${index + 1}; expected "<local ref> <local sha> <remote ref> <remote sha>"`,
      );
    }
    const [, localRef, localSha, remoteRef, remoteSha] = match;
    if (isZeroSha(localSha)) {
      continue;
    }
    await requireCommit(cwd, localSha, `pushed ${localRef}`);
    const base = isZeroSha(remoteSha)
      ? await mergeBaseOrFail(
          cwd,
          localSha,
          defaultBranch,
          `new branch ${remoteRef}`,
        )
      : remoteSha;
    await requireCommit(cwd, base, `remote ${remoteRef}; run git fetch`);
    if (base === localSha) {
      await confirmOnRemote(cwd, remote, localSha, localRef);
      continue;
    }
    ranges.push({ base, head: localSha, ref: localRef });
  }
  return ranges;
}

async function ciRanges(cwd, env) {
  const eventName = env.GITHUB_EVENT_NAME;
  if (!env.GITHUB_EVENT_PATH) {
    throw new VerifyError('GITHUB_EVENT_PATH is not set; cannot find the base');
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const head = env.GITHUB_SHA ?? (await git(cwd, ['rev-parse', 'HEAD']));
  let base;
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    base = event.pull_request?.base?.sha;
    if (!base || isZeroSha(base)) {
      throw new VerifyError('pull_request event has no base.sha');
    }
  } else if (eventName === 'push') {
    base = event.before;
    if (!base || isZeroSha(base)) {
      throw new VerifyError(
        'push event has no before SHA; refusing to verify without a trusted base',
      );
    }
  } else {
    throw new VerifyError(`unsupported GitHub event: ${eventName}`);
  }
  await requireCommit(
    cwd,
    base,
    `${eventName} base; check out with fetch-depth: 0 or git fetch the SHA`,
  );
  const resolvedHead = await git(cwd, ['rev-parse', `${head}^{commit}`]);
  if ((await git(cwd, ['rev-parse', `${base}^{commit}`])) === resolvedHead) {
    throw new VerifyError(
      `${eventName} base equals HEAD ${resolvedHead.slice(0, 9)}; refusing to verify an empty range`,
    );
  }
  return [{ base, head, ref: env.GITHUB_REF ?? eventName }];
}

async function localRanges(cwd, defaultBranch) {
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  const pushed = await gitOk(cwd, ['rev-parse', '--verify', '-q', '@{push}']);
  const base =
    pushed ?? (await mergeBaseOrFail(cwd, head, defaultBranch, 'local run'));
  if (base === head) {
    await confirmOnRemote(cwd, defaultBranch.split('/')[0], head, 'HEAD');
    return [];
  }
  return [{ base, head, ref: 'HEAD' }];
}

export async function resolveRanges({
  cwd,
  source,
  stdin = '',
  env = process.env,
  defaultBranch = DEFAULT_BRANCH,
  remote,
}) {
  if (source === 'pre-push') {
    return prePushRanges(cwd, stdin, defaultBranch, remote);
  }
  if (source === 'ci') {
    return ciRanges(cwd, env);
  }
  return localRanges(cwd, defaultBranch);
}

async function changedFiles(cwd, ranges) {
  const files = new Set();
  for (const range of ranges) {
    const output = await git(cwd, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      range.base,
      range.head,
    ]);
    for (const file of output.split('\0')) {
      if (file) files.add(file);
    }
  }
  return [...files].sort();
}

export async function fullRanges(cwd, defaultBranch = DEFAULT_BRANCH) {
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  const base = await mergeBaseOrFail(cwd, head, defaultBranch, 'full run');
  return [{ base, head, ref: 'HEAD' }];
}

export function detectSource(argv, env) {
  if (argv.includes('--pre-push')) return 'pre-push';
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME) return 'ci';
  return 'local';
}

export async function resolveScope(options) {
  const ranges = await resolveRanges(options);
  const files = await changedFiles(options.cwd, ranges);
  return { ranges, files, ...classifyFiles(files) };
}

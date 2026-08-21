import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  TASK_10_REPOSITORY_ROOT,
  TASK_10_VISUAL_DIRECTORY,
  type Task10Screenshot,
} from './legacy-member-reclassification-visual';

const RECEIPT_PATH = path.join(
  TASK_10_VISUAL_DIRECTORY,
  'browser-receipt.json',
);
const INDEX_PATH = path.join(TASK_10_VISUAL_DIRECTORY, 'index.json');
const HASH_PATH = path.join(TASK_10_VISUAL_DIRECTORY, 'SHA256SUMS');

export async function resetTask10VisualEvidence(): Promise<void> {
  await rm(TASK_10_VISUAL_DIRECTORY, { recursive: true, force: true });
  await mkdir(TASK_10_VISUAL_DIRECTORY, { recursive: true });
}

export async function writeTask10VisualEvidence(
  receipt: unknown,
  screenshots: readonly Task10Screenshot[],
): Promise<{ readonly files: number; readonly verified: true }> {
  const serializedReceipt = `${JSON.stringify(receipt, null, 2)}\n`;
  assertSanitized(serializedReceipt);
  await writeFile(RECEIPT_PATH, serializedReceipt, { mode: 0o600 });

  const evidencePaths = [
    ...screenshots.map(({ path: relativePath }) =>
      path.join(TASK_10_REPOSITORY_ROOT, relativePath),
    ),
    RECEIPT_PATH,
  ];
  const entries = await Promise.all(
    evidencePaths.map(async (absolutePath) => ({
      path: repositoryRelative(absolutePath),
      sha256: await sha256(absolutePath),
      bytes: (await stat(absolutePath)).size,
    })),
  );
  const index = {
    schemaVersion: 1,
    scope: 'jwt-auth-signup-refactor/task-10/local-synthetic-browser',
    entries: entries.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  };
  const serializedIndex = `${JSON.stringify(index, null, 2)}\n`;
  assertSanitized(serializedIndex);
  await writeFile(INDEX_PATH, serializedIndex, { mode: 0o600 });

  const hashedPaths = [...evidencePaths, INDEX_PATH];
  const hashLines = await Promise.all(
    hashedPaths
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        async (absolutePath) =>
          `${await sha256(absolutePath)}  ${repositoryRelative(absolutePath)}`,
      ),
  );
  await writeFile(HASH_PATH, `${hashLines.join('\n')}\n`, { mode: 0o600 });
  await verifyHashes(hashLines);
  return { files: hashedPaths.length, verified: true };
}

async function verifyHashes(lines: readonly string[]): Promise<void> {
  for (const line of lines) {
    const [expected, relativePath] = line.split('  ');
    if (!expected || !relativePath)
      throw new Error('Malformed SHA256SUMS line');
    const absolutePath = path.join(TASK_10_REPOSITORY_ROOT, relativePath);
    if ((await sha256(absolutePath)) !== expected) {
      throw new Error('Task 10 evidence hash verification failed');
    }
  }
  const unexpected = (await readdir(TASK_10_VISUAL_DIRECTORY)).filter(
    (name) =>
      !lines.some((line) => line.endsWith(`/visual/${name}`)) &&
      name !== path.basename(HASH_PATH),
  );
  if (unexpected.length > 0)
    throw new Error('Unindexed Task 10 visual evidence');
}

async function sha256(absolutePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(absolutePath))
    .digest('hex');
}

function repositoryRelative(absolutePath: string): string {
  return path
    .relative(TASK_10_REPOSITORY_ROOT, absolutePath)
    .split(path.sep)
    .join('/');
}

function assertSanitized(serialized: string): void {
  if (
    serialized.includes(TASK_10_REPOSITORY_ROOT) ||
    serialized.includes('/Users/') ||
    /https?:\/\//.test(serialized)
  ) {
    throw new Error(
      'Task 10 evidence must contain repository-relative data only',
    );
  }
}

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
  delete process.env[key];
}

export const ZERO = '0'.repeat(40);

export function tempRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-test-repo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Verify Test');
  git('config', 'user.email', 'verify@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const remove = (path) => rmSync(join(dir, path), { force: true });
  const commit = (message, files = {}) => {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) remove(path);
      else write(path, content);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const markRemoteMain = (sha) =>
    git('update-ref', 'refs/remotes/origin/main', sha);
  return { dir, git, write, commit, markRemoteMain };
}

export function writeExecutable(t, name, source) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-test-bin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

export function eventFile(t, payload) {
  return writeExecutable(t, 'event.json', JSON.stringify(payload));
}

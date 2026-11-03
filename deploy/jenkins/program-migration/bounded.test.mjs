import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BOUNDED = join(dirname(fileURLToPath(import.meta.url)), 'bounded.mjs');
const LONG = { timeout: 60_000 };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'program-migration-bounded-'));
  const marker = join(dir, 'descendant.pid');
  const resistant = join(dir, 'resistant.sh');
  writeFileSync(
    resistant,
    `trap '' TERM\necho $$ > '${marker}.tmp'\nmv '${marker}.tmp' '${marker}'\nexec sleep 300\n`,
  );
  t.after(() => {
    if (existsSync(marker)) {
      try {
        process.kill(Number(readFileSync(marker, 'utf8')), 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, marker, resistant };
}

function run(seconds, script) {
  const child = spawn('node', [BOUNDED, String(seconds), 'sh', '-c', script], {
    stdio: 'ignore',
  });
  return { child, exited: once(child, 'exit') };
}

function descendantStarted({ dir, marker }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error('resistant descendant did not start'));
    }, 30_000);
    const watcher = watch(dir, () => {
      if (!existsSync(marker)) return;
      clearTimeout(timer);
      watcher.close();
      resolve();
    });
  });
}

function assertDescendantGone(marker) {
  assert.ok(existsSync(marker), 'descendant never recorded its pid');
  const pid = Number(readFileSync(marker, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test(
  '시간 초과는 TERM을 무시하는 후손까지 끝낸 뒤 124로 끝난다',
  LONG,
  async (t) => {
    const paths = fixture(t);
    const { exited } = run(3, `sh '${paths.resistant}' & wait`);
    const [code] = await exited;
    assert.equal(code, 124);
    assertDescendantGone(paths.marker);
  },
);

test('전달받은 SIGTERM도 TERM을 무시하는 후손까지 끝낸다', LONG, async (t) => {
  const paths = fixture(t);
  const started = descendantStarted(paths);
  const { child, exited } = run(120, `sh '${paths.resistant}' & wait`);
  await started;
  child.kill('SIGTERM');
  const [code] = await exited;
  assert.notEqual(code, 0);
  assertDescendantGone(paths.marker);
});

test(
  '정상 종료도 남은 후손을 끝내고 원래 종료 코드를 지킨다',
  LONG,
  async (t) => {
    const paths = fixture(t);
    const { exited } = run(
      120,
      `sh '${paths.resistant}' & while [ ! -e '${paths.marker}' ]; do :; done; exit 7`,
    );
    const [code] = await exited;
    assert.equal(code, 7);
    assertDescendantGone(paths.marker);
  },
);

test('후손이 없으면 원래 종료 코드를 바로 돌려준다', LONG, async () => {
  const { exited } = run(120, 'exit 5');
  const [code] = await exited;
  assert.equal(code, 5);
});

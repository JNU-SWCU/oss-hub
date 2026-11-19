import { fileURLToPath } from 'node:url';
import { run } from './tools.mjs';

const LOCK = '/tmp/oss-hub-docker.lock';
const HELPER = fileURLToPath(new URL('./docker-lock.py', import.meta.url));
const WAIT = 'verify: waiting for another Docker-backed run';

export function runWithDockerLock(
  command,
  args,
  options,
  { lock = LOCK, log = console.log } = {},
) {
  let prefix = '';
  let checked = false;
  return run('python3', ['-I', '-B', HELPER, lock, command, ...args], {
    ...options,
    onStdout(chunk) {
      if (checked) return;
      prefix += chunk.toString('utf8', 0, WAIT.length + 1);
      checked = !`${WAIT}\n`.startsWith(prefix) || prefix.length > WAIT.length;
      if (checked && prefix.startsWith(`${WAIT}\n`)) log(WAIT);
    },
  });
}

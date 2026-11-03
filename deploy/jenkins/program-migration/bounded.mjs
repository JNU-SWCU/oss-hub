import { spawn } from 'node:child_process';

const KILL_GRACE_MS = 2000;
const [seconds, ...command] = process.argv.slice(2);
const limit = Number(seconds);

if (!Number.isInteger(limit) || limit <= 0 || command.length === 0) {
  console.error(
    'FAIL_CLOSED bounded: usage: bounded.mjs <seconds> <command...>',
  );
  process.exit(2);
}

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  detached: true,
});
let timedOut = false;

function signalGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

const deadline = setTimeout(() => {
  timedOut = true;
  signalGroup('SIGTERM');
  setTimeout(() => signalGroup('SIGKILL'), KILL_GRACE_MS).unref();
}, limit * 1000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => signalGroup(signal));
}

child.on('error', (error) => {
  console.error(`FAIL_CLOSED bounded: ${command[0]}: ${error.code}`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  clearTimeout(deadline);
  if (timedOut) process.exit(124);
  process.exit(signal ? 1 : code);
});

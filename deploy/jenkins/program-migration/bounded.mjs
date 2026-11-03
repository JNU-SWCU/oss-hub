import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const TERM_GRACE_MS = 2000;
const KILL_WAIT_MS = 2000;
const POLL_MS = 50;
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
let termination;

function signalGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function groupAlive() {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function groupGoneWithin(milliseconds) {
  const giveUpAt = Date.now() + milliseconds;
  while (groupAlive()) {
    if (Date.now() >= giveUpAt) return false;
    await delay(POLL_MS);
  }
  return true;
}

async function terminateGroup(signal) {
  signalGroup(signal);
  if (await groupGoneWithin(TERM_GRACE_MS)) return true;
  signalGroup('SIGKILL');
  return groupGoneWithin(KILL_WAIT_MS);
}

const deadline = setTimeout(() => {
  timedOut = true;
  termination ??= terminateGroup('SIGTERM');
}, limit * 1000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    termination ??= terminateGroup(signal);
  });
}

child.on('error', (error) => {
  console.error(`FAIL_CLOSED bounded: ${command[0]}: ${error.code}`);
  process.exit(127);
});

child.on('exit', async (code, signal) => {
  clearTimeout(deadline);
  termination ??= terminateGroup('SIGTERM');
  const gone = await termination;
  if (!gone) {
    console.error(`FAIL_CLOSED bounded: ${command[0]}: process group survived`);
  }
  if (timedOut) process.exit(124);
  if (!gone || signal) process.exit(1);
  process.exit(code);
});

import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { run } from './tools.mjs';

const LOCK = '/tmp/oss-hub-docker.lock';

function isAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function removeStaleOwner(lock) {
  let owners;
  try {
    owners = readdirSync(lock);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  // An empty directory may be a live shell lane using plain mkdir/rmdir.
  const owner =
    owners.length === 1 && /^owner-([1-9]\d*)-(\d+)-/.exec(owners[0]);
  if (!owner || isAlive(owner[1]) || (owner[2] !== '0' && isAlive(owner[2])))
    return;
  try {
    // Only the waiter that removes this specific owner may remove the lock.
    rmdirSync(join(lock, owners[0]));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  rmdirSync(lock);
}

export async function runWithDockerLock(
  command,
  args,
  options,
  { lock = LOCK, log = console.log } = {},
) {
  let waiting = false;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!waiting) log('verify: waiting for another Docker-backed run');
    waiting = true;
    removeStaleOwner(lock);
    await setTimeout(250);
  }

  const id = randomUUID();
  let owner = join(lock, `owner-${process.pid}-0-${id}`);
  try {
    mkdirSync(owner);
    try {
      return await run(command, args, {
        ...options,
        // The detached integration shell can still be cleaning up after verify dies.
        onSpawn(pid) {
          const activeOwner = join(lock, `owner-${process.pid}-${pid}-${id}`);
          renameSync(owner, activeOwner);
          owner = activeOwner;
        },
      });
    } finally {
      rmdirSync(owner);
    }
  } finally {
    rmdirSync(lock);
  }
}

import { availableParallelism, loadavg } from 'node:os';
import { basename } from 'node:path';
import { run } from './tools.mjs';

async function readOutput(command, args) {
  try {
    const result = await run(command, args, {
      timeoutMs: 1500,
      killGraceMs: 500,
    });
    return result.code === 0 ? result.stdout.trim().split('\n') : null;
  } catch {
    return null;
  }
}

export async function sampleHostLoad() {
  const at = new Date().toISOString();
  const loadAverage = loadavg();
  const [processes, containers] = await Promise.all([
    readOutput('ps', ['-A', '-o', 'pcpu=', '-o', 'comm=']),
    readOutput('docker', ['ps', '--format', '{{.Names}}']),
  ]);
  const ranked = processes
    ?.flatMap((line) => {
      const parts = /^\s*(\d+(?:\.\d+)?)\s+(.+)$/.exec(line);
      return parts
        ? [{ cpuPercent: Number(parts[1]), name: basename(parts[2]) }]
        : [];
    })
    .sort((left, right) => right.cpuPercent - left.cpuPercent);

  return {
    at,
    loadAverage,
    availableCpus: availableParallelism(),
    processes:
      ranked?.filter(
        (process, index) => index < 8 || process.name.startsWith('next-server'),
      ) ?? null,
    dockerContainers: containers?.filter(Boolean) ?? null,
  };
}

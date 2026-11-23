import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { hasWorkerMount } from '../src/cli';

describe('worker mount interlock', () => {
  it('matches a configured symlink to the mounted directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'worker-interlock-'));
    const mounted = path.join(root, 'run', 'lock', 'oss-hub-mail');
    const configured = path.join(root, 'var', 'lock', 'oss-hub-mail');
    mkdirSync(mounted, { recursive: true });
    mkdirSync(path.dirname(configured), { recursive: true });
    symlinkSync(path.relative(path.dirname(configured), mounted), configured);

    try {
      const mountInfo = `1 0 0:1 / ${realpathSync(mounted)} rw - tmpfs tmpfs rw`;
      expect(hasWorkerMount(configured, mountInfo)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
